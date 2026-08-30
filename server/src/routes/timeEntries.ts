/**
 * Time Entry Routes
 * -----------------
 * Clock-in/out with geofence validation, manual overrides,
 * and active-session overlap prevention.
 */

import { Router } from 'express';
import prisma from '../prisma.js';
import { requireAuth, requireAdminOrManager } from '../middleware/auth.js';
import { getManagerScopeFilter, isEmployeeInManagerScope } from '../middleware/scope.js';
import { clockRateLimit } from '../middleware/rateLimit.js';
import {
  validate,
  clockInSchema,
  clockOutSchema,
  manualTimeEntrySchema,
  bulkClockInSchema,
  bulkClockOutSchema,
  updateTimeEntrySchema,
} from '../validation.js';
import { checkGeofence } from '../geofence.js';
import { logAudit, getClientIp, computeChanges } from '../audit.js';
import { broadcastScoped } from '../sse.js';
import {
  validateClockInLocation,
  validateClockOutLocation,
  type GeoPosition,
  type GeoValidationResult,
} from '../geoValidationService.js';
import { assertTenantMatch } from '../tenantContext.js';
import {
  badRequest,
  notFound,
  accessDenied,
  outsideScope,
  conflict,
  internalError,
  geofenceViolation,
  alreadyClockedIn,
  noActiveSession,
} from '../errorResponse.js';

const router = Router();

router.use(requireAuth);

function tenantWhere(authUser: { role: string; companyProfileId: string | null }) {
  return authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };
}

/** Format a Date as YYYY-MM-DD using local time (not UTC, to avoid off-by-one near midnight). */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Safely parse a YYYY-MM-DD string into a Date for PostgreSQL DATE columns.
 * Uses UTC noon to prevent timezone-induced date shifting.
 */
function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00Z');
}

/**
 * True when an insert/update failed because another active punch already
 * exists for the employee (duplicate-active race, unique-index backstop,
 * serializable write conflict or deadlock). All such outcomes map to the
 * same client-visible result: "already clocked in" — never a 500.
 */
function isActiveEntryConflict(err: any): boolean {
  return (
    err?.code === 'DUPLICATE_ACTIVE' ||
    err?.code === 'P2002' ||
    err?.code === 'P2034' ||
    err?.message?.includes('uniq_active_time_entry') ||
    err?.message?.includes('write conflict') ||
    err?.message?.includes('deadlock')
  );
}

// ── GET / (List time entries) ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const date = req.query.date as string;
    const fromDate = req.query.from as string;
    const toDate = req.query.to as string;
    const employeeEmail = req.query.employeeEmail as string;
    const status = req.query.status as string;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 500, 500);
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const where: Record<string, unknown> = { ...tenantWhere(authUser) };

    if (authUser.role === 'employee') {
      where.employeeEmail = authUser.email;
    } else if (authUser.role === 'manager') {
      // SECURITY: use the canonical guarded scope filter (direct reports OR
      // explicit same branch+dept). The previous inline implementation used
      // stale JWT claims and lacked the default-value leak guard, allowing a
      // manager on default branch/department to see every default-valued
      // employee's time entries in the tenant.
      const scopeFilter = await getManagerScopeFilter(authUser);
      const scopedEmployees = await prisma.employee.findMany({
        where: {
          companyProfileId: authUser.companyProfileId ?? undefined,
          ...scopeFilter,
        },
        select: { email: true },
      });
      const emails = [...new Set(scopedEmployees.map((e) => e.email))];
      if (emails.length > 0) where.employeeEmail = { in: emails };
      else where.employeeEmail = '__none__';
    }

    // Inclusive, timezone-safe day boundaries (UTC start-of-day → end-of-day)
    // so list results always cover exactly the same dates as the payroll
    // report endpoint, keeping the two views in balance after manual edits.
    if (date) {
      where.date = {
        gte: new Date(date + 'T00:00:00Z'),
        lte: new Date(date + 'T23:59:59.999Z'),
      };
    }
    if (fromDate && toDate) {
      where.date = {
        gte: new Date(fromDate + 'T00:00:00Z'),
        lte: new Date(toDate + 'T23:59:59.999Z'),
      };
    }
    if (employeeEmail && authUser.role !== 'employee') where.employeeEmail = employeeEmail;
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { clockIn: 'desc' },
      }),
      prisma.timeEntry.count({ where }),
    ]);

    res.json({ items, total });
  } catch (err) {
    console.error('[timeEntries] List error:', err);
    internalError(res, 'fetching time entries');
  }
});

// ── GET /active (Current active session for a user) ──
router.get('/active', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const email = (req.query.employeeEmail as string) || authUser.email;

    // Employees can only query themselves
    if (authUser.role === 'employee' && email !== authUser.email) {
      return accessDenied(res, 'You can only view your own active session.');
    }

    const active = await prisma.timeEntry.findFirst({
      where: { employeeEmail: email, status: 'active' },
      orderBy: { clockIn: 'desc' },
    });

    res.json({ active });
  } catch (err) {
    console.error('[timeEntries] Active error:', err);
    internalError(res, 'fetching active session');
  }
});

// ── POST /clock-in ──
// Handles both self-service clock-in (employees) and manual override (admin/manager).
// Self-service: validates geofence boundary before creating time entry.
// Manual override: bypasses geofence but requires justification and audit logging.
router.post('/clock-in', requireAuth, clockRateLimit, validate(clockInSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const { latitude, longitude, employee_email: targetEmail, justification } = req.body as Record<string, unknown>;

    const geoPos: GeoPosition | null =
      latitude != null && longitude != null
        ? { latitude: latitude as number, longitude: longitude as number }
        : null;

    // ── Determine request type: self-service vs manual override ──
    // A proxy action is when an admin/manager/master clocks ANOTHER employee
    // in (e.g. the employee lost or forgot their phone). Self clock-ins by
    // admins/managers still go through normal geofence validation.
    const canProxy = authUser.role === 'admin' || authUser.role === 'master' || authUser.role === 'manager';
    const authUserEmailLower = authUser.email.toLowerCase().trim();
    const targetEmailLower = (typeof targetEmail === 'string' ? targetEmail : authUser.email).toLowerCase().trim();
    const isManualOverride = canProxy && targetEmailLower !== authUserEmailLower;

    // Resolve target employee record case-insensitively
    let employee = await prisma.employee.findFirst({
      where: {
        email: { equals: targetEmailLower, mode: 'insensitive' },
        companyProfileId: authUser.companyProfileId ?? undefined,
      },
      include: { geofence: true },
    });

    // Fallback: if employee record exists with null companyProfileId or case difference, auto-heal companyProfileId
    if (!employee && authUser.companyProfileId) {
      const orphanEmployee = await prisma.employee.findFirst({
        where: { email: { equals: targetEmailLower, mode: 'insensitive' } },
        include: { geofence: true },
      });
      if (orphanEmployee) {
        if (!orphanEmployee.companyProfileId) {
          await prisma.employee.update({
            where: { id: orphanEmployee.id },
            data: { companyProfileId: authUser.companyProfileId },
          });
          orphanEmployee.companyProfileId = authUser.companyProfileId;
        }
        employee = orphanEmployee;
      }
    }

    if (!employee) return notFound(res, 'Employee record');

    // Manager scope check for manual overrides
    // (case-insensitive self comparison — a manager clocking THEMSELVES in,
    // e.g. via auto-geofence passing their own email, must not be treated as
    // a proxy punch subject to scope rules)
    if (authUser.role === 'manager' && targetEmailLower !== authUserEmailLower) {
      const inScope = await isEmployeeInManagerScope(authUser, targetEmailLower);
      if (!inScope) return outsideScope(res, 'This employee');
    }

    // NOTE: Duplicate-active prevention is handled atomically below inside a
    // serializable transaction (check-then-insert), with the partial unique
    // index `uniq_active_time_entry_employee` as the final backstop.
    // ── Geofence Validation ──
    let geoResult: GeoValidationResult;
    let geofenceData: Record<string, unknown> = {};

    if (isManualOverride) {
      // Proxy clock-in on behalf of staff: bypass geofence but log it.
      // Manager scope was already enforced above.
      geoResult = await validateClockInLocation(targetEmailLower, geoPos, {
        isManualOverride: true,
        requesterRole: authUser.role,
      });
    } else {
      // Self-service: strict geofence validation (applies to all roles,
      // including admins/managers clocking themselves in)
      geoResult = await validateClockInLocation(targetEmailLower, geoPos, {
        requesterRole: authUser.role,
        isManualOverride: false,
      });
    }

    if (!geoResult.passed) {
      return geofenceViolation(res, {
        distanceMetres: geoResult.distanceMetres,
        geofenceName: geoResult.geofenceName,
        radiusMetres: geoResult.radiusMetres,
        suggestions: geoResult.suggestions,
      });
    }

    // Populate geofence metadata if available
    if (geoResult.geofenceName) {
      geofenceData = {
        geofenceName: geoResult.geofenceName,
        geofenceAddress: geoResult.geofenceAddress,
        geofenceLatitude: geoResult.geofenceLatitude,
        geofenceLongitude: geoResult.geofenceLongitude,
        geofenceRadius: geoResult.radiusMetres,
        isAutoGeofence: !isManualOverride,
      };
    }

    const now = new Date();
    let entry;
    try {
      // ATOMIC check-then-insert inside a serializable transaction.
      // This closes the race window where two concurrent requests could both
      // pass a non-transactional duplicate check and both insert active rows.
      // The partial unique index remains the ultimate backstop.
      entry = await prisma.$transaction(
        async (tx) => {
          const existingActive = await tx.timeEntry.findFirst({
            where: { employeeEmail: targetEmailLower, status: 'active' },
            select: { id: true },
          });
          if (existingActive) {
            const err = new Error('DUPLICATE_ACTIVE_ENTRY');
            (err as any).code = 'DUPLICATE_ACTIVE';
            throw err;
          }
          return tx.timeEntry.create({
            data: {
              employeeId: employee.id,
              employeeEmail: targetEmailLower,
              employeeName: `${employee.firstName} ${employee.surname}`,
              branch: employee.branch,
              department: employee.department,
              clockIn: now,
              date: parseDate(toDateStr(now)),
              status: 'active',
              isManualOverride,
              clockedById: isManualOverride ? authUser.id : null,
              clockedByName: isManualOverride ? authUser.fullName : null,
              companyProfileId: employee.companyProfileId,
              createdBy: authUser.id,
              updatedBy: authUser.id,
              ...geofenceData,
            },
          });
        },
      );
    } catch (createErr: any) {
      if (isActiveEntryConflict(createErr)) {
        return alreadyClockedIn(res);
      }
      throw createErr;
    }

    // ── Audit Logging ──
    const clientIp = getClientIp(req);
    if (isManualOverride) {
      // Log manual override with justification and full before/after state
      const just = typeof justification === 'string' && justification.trim().length > 0
        ? justification.trim().slice(0, 500)
        : `Manual clock-in for ${employee.firstName} ${employee.surname}`;

      // Enhanced audit: capture full context of the override
      const overrideChanges = {
        employee_email: { before: null, after: entry.employeeEmail },
        employee_name: { before: null, after: entry.employeeName },
        clock_in: { before: null, after: entry.clockIn.toISOString() },
        is_manual_override: { before: false, after: true },
        clocked_by: { before: null, after: `${authUser.fullName} (${authUser.email})` },
        geofence_bypassed: { before: null, after: isManualOverride },
        geo_validation_passed: { before: null, after: geoResult.passed },
        distance_from_geofence: { before: null, after: geoResult.distanceMetres ?? null },
      };

      logAudit({
        entity: 'TimeEntry',
        entityId: entry.id,
        action: 'override',
        actorId: authUser.id,
        actorEmail: authUser.email,
        actorRole: authUser.role,
        justification: just,
        ipAddress: clientIp,
        branch: entry.branch,
        department: entry.department,
        changes: overrideChanges as any,
      });
    } else {
      // Self-service clock-in — audit write is awaited (durability): audit
      // rows must not be silently dropped under load.
      await logAudit({
        entity: 'TimeEntry',
        entityId: entry.id,
        action: 'clock_in',
        actorId: authUser.id,
        actorEmail: authUser.email,
        actorRole: authUser.role,
        ipAddress: clientIp,
        branch: entry.branch,
        department: entry.department,
      });
    }

    broadcastScoped(
      'timeEntry',
      'clockIn',
      entry,
      {
        companyProfileId: entry.companyProfileId,
        branch: entry.branch,
        department: entry.department,
      }
    );

    res.status(201).json(entry);
  } catch (err) {
    console.error('[timeEntries] Clock-in error:', err);
    internalError(res, 'recording clock-in');
  }
});

// ── POST /clock-out ──
// Handles self-service clock-out with geofence validation.
// Admin/Manager can force clock-out for employees (manual override).
router.post('/clock-out', requireAuth, clockRateLimit, validate(clockOutSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const body = req.body as Record<string, unknown>;
    const breakMinutes = typeof body.breakMinutes === 'number' ? body.breakMinutes : 0;
    const targetEmail = body.employee_email as string | undefined;
    const latitude = body.latitude as number | undefined;
    const longitude = body.longitude as number | undefined;

    const geoPos: GeoPosition | null =
      latitude != null && longitude != null
        ? { latitude, longitude }
        : null;

    // Determine target email.
    // A force clock-out is when an admin/manager/master clocks ANOTHER employee
    // out on their behalf. Passing one's own email is treated as self-service
    // so that personal geofence validation still applies.
    const authUserEmailLower = authUser.email.toLowerCase().trim();
    const isForceClockOut =
      authUser.role !== 'employee' &&
      typeof targetEmail === 'string' &&
      targetEmail.toLowerCase().trim() !== authUserEmailLower;
    const targetEmailLower = isForceClockOut ? (targetEmail as string).toLowerCase().trim() : authUserEmailLower;

    const active = await prisma.timeEntry.findFirst({
      where: {
        employeeEmail: { equals: targetEmailLower, mode: 'insensitive' },
        status: 'active',
      },
      orderBy: { clockIn: 'desc' },
    });
    if (!active) return noActiveSession(res);

    // Access control: employees can only clock out themselves
    if (authUser.role === 'employee' && active.employeeEmail.toLowerCase().trim() !== authUserEmailLower) {
      return accessDenied(res, 'You can only clock out yourself.');
    }

    // Manager scope check for force clock-out
    if (isForceClockOut) {
      const inScope = await isEmployeeInManagerScope(authUser, targetEmailLower);
      if (!inScope) return outsideScope(res, 'This employee');
    }

    // Geofence validation for self-service clock-out
    if (!isForceClockOut) {
      const geoResult = await validateClockOutLocation(targetEmailLower, geoPos, {
        requesterRole: authUser.role,
        isManualOverride: false,
      });
      if (!geoResult.passed) {
        return geofenceViolation(res, {
          distanceMetres: geoResult.distanceMetres,
          geofenceName: geoResult.geofenceName,
          radiusMetres: geoResult.radiusMetres,
          suggestions: geoResult.suggestions,
        });
      }
    }

    const now = new Date();
    const rawHours = (now.getTime() - active.clockIn.getTime()) / 3_600_000;
    const breakHrs = (breakMinutes ?? 0) / 60;
    const totalHours = Math.max(0, Math.round((rawHours - breakHrs) * 100) / 100);

    const entry = await prisma.timeEntry.update({
      where: { id: active.id },
      data: {
        clockOut: now,
        status: 'completed',
        breakMinutes: breakMinutes ?? 0,
        totalHours,
        updatedBy: authUser.id,
      },
    });

    // Enhanced audit for force clock-out with before/after state
    const forceClockOutChanges = isForceClockOut
      ? {
          clock_out: { before: null, after: entry.clockOut?.toISOString() },
          status: { before: 'active', after: 'completed' },
          total_hours: { before: null, after: entry.totalHours },
          forced_by: { before: null, after: `${authUser.fullName} (${authUser.email})` },
        }
      : undefined;

    // Await the audit write for clock-out (durability: this is the final
    // state transition of a work session and must not be silently lost).
    await logAudit({
      entity: 'TimeEntry',
      entityId: entry.id,
      action: isForceClockOut ? 'force_clock_out' : 'clock_out',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: isForceClockOut ? `Force clock-out for ${active.employeeEmail}` : undefined,
      ipAddress: getClientIp(req),
      branch: entry.branch,
      department: entry.department,
      changes: forceClockOutChanges as any,
    });

    broadcastScoped(
      'timeEntry',
      'clockOut',
      entry,
      {
        companyProfileId: entry.companyProfileId,
        branch: entry.branch,
        department: entry.department,
      }
    );

    res.json(entry);
  } catch (err) {
    console.error('[timeEntries] Clock-out error:', err);
    internalError(res, 'recording clock-out');
  }
});

// ── POST /manual (Manager/Admin manual entry) ──
router.post('/manual', requireAdminOrManager, validate(manualTimeEntrySchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const { employeeId, date, clockIn, clockOut, breakMinutes, notes } = req.body;

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return notFound(res, 'Employee');

    if (authUser.role === 'manager') {
      const inScope = await isEmployeeInManagerScope(authUser, employee.email);
      if (!inScope) return outsideScope(res, 'Employee');
    }
    if (authUser.role !== 'master' && employee.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res);
    }

    const clockInDate = new Date(`${date}T${clockIn}:00`);
    const clockOutDate = new Date(`${date}T${clockOut}:00`);
    if (clockOutDate <= clockInDate) {
      return badRequest(res, 'Clock-out must be after clock-in.');
    }

    const rawHours = (clockOutDate.getTime() - clockInDate.getTime()) / 3_600_000;
    const breakHrs = (breakMinutes ?? 0) / 60;
    const totalHours = Math.max(0, Math.round((rawHours - breakHrs) * 100) / 100);

    const entry = await prisma.timeEntry.create({
      data: {
        employeeId: employee.id,
        employeeEmail: employee.email,
        employeeName: `${employee.firstName} ${employee.surname}`,
        branch: employee.branch,
        department: employee.department,
        clockIn: clockInDate,
        clockOut: clockOutDate,
        date: parseDate(date),
        totalHours,
        status: 'completed',
        breakMinutes: breakMinutes ?? 0,
        isManualOverride: true,
        clockedById: authUser.id,
        clockedByName: authUser.fullName,
        companyProfileId: employee.companyProfileId,
        createdBy: authUser.id,
        updatedBy: authUser.id,
      },
    });

    // Enhanced audit for manual time entry with full before/after state
    const manualEntryChanges = {
      employee_email: { before: null, after: entry.employeeEmail },
      employee_name: { before: null, after: entry.employeeName },
      date: { before: null, after: date },
      clock_in: { before: null, after: entry.clockIn.toISOString() },
      clock_out: { before: null, after: entry.clockOut?.toISOString() },
      total_hours: { before: null, after: entry.totalHours },
      break_minutes: { before: null, after: entry.breakMinutes },
      is_manual_override: { before: false, after: true },
      created_by: { before: null, after: `${authUser.fullName} (${authUser.email})` },
    };

    const trimmedNotes = typeof notes === 'string' ? notes.trim().slice(0, 2000) : '';
    logAudit({
      entity: 'TimeEntry',
      entityId: entry.id,
      action: 'manual_create',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: trimmedNotes
        ? `Manual time entry for ${employee.firstName} ${employee.surname} on ${date}: ${trimmedNotes}`
        : `Manual time entry for ${employee.firstName} ${employee.surname} on ${date}`,
      ipAddress: getClientIp(req),
      branch: entry.branch,
      department: entry.department,
      changes: manualEntryChanges as any,
    });

    broadcastScoped('timeEntry', 'create', entry, {
      companyProfileId: entry.companyProfileId,
      branch: entry.branch,
      department: entry.department,
    });

    res.status(201).json(entry);
  } catch (err) {
    console.error('[timeEntries] Manual error:', err);
    internalError(res, 'creating manual time entry');
  }
});

// ── POST /bulk-clock-in (Manager/Admin bulk proxy clock-in) ──
// One request clocks in many staff (e.g. a whole shift that forgot to punch).
// Each created entry is flagged as a manual override and audit-logged.
router.post('/bulk-clock-in', requireAdminOrManager, clockRateLimit, validate(bulkClockInSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const { employeeEmails, justification } = req.body as {
      employeeEmails: string[];
      justification?: string;
    };

    const now = new Date();
    const clientIp = getClientIp(req);
    const clockedIn: Array<{ email: string; id: string; employeeName: string | null }> = [];
    const skipped: Array<{ email: string; reason: string }> = [];
    // Audit writes are collected and awaited before responding — manual
    // override records are compliance-critical and must be durable.
    const auditWrites: Array<Promise<void>> = [];

    for (const email of employeeEmails) {
      const employee = await prisma.employee.findFirst({
        where: { email, companyProfileId: authUser.companyProfileId ?? undefined },
      });
      if (!employee) {
        skipped.push({ email, reason: 'Employee not found in your company' });
        continue;
      }

      if (authUser.role === 'manager') {
        const inScope = await isEmployeeInManagerScope(authUser, email);
        if (!inScope) {
          skipped.push({ email, reason: 'Outside your management scope' });
          continue;
        }
      }

      // ATOMIC check-then-insert inside a serializable transaction — the same
      // race-safe pattern as self clock-in. A concurrent self-punch can no
      // longer slip past a non-transactional duplicate check, and unique-index
      // violations (partial index backstop) map to a clean "Already clocked
      // in" skip instead of a 500.
      let entry;
      try {
        entry = await prisma.$transaction(async (tx) => {
          const existingActive = await tx.timeEntry.findFirst({
            where: { employeeEmail: email, status: 'active' },
            select: { id: true },
          });
          if (existingActive) {
            const err = new Error('DUPLICATE_ACTIVE_ENTRY');
            (err as any).code = 'DUPLICATE_ACTIVE';
            throw err;
          }
          return tx.timeEntry.create({
            data: {
              employeeId: employee.id,
              employeeEmail: email,
              employeeName: `${employee.firstName} ${employee.surname}`,
              branch: employee.branch,
              department: employee.department,
              clockIn: now,
              date: parseDate(toDateStr(now)),
              status: 'active',
              isManualOverride: true,
              clockedById: authUser.id,
              clockedByName: authUser.fullName,
              companyProfileId: employee.companyProfileId,
              createdBy: authUser.id,
              updatedBy: authUser.id,
            },
          });
        });
      } catch (createErr: any) {
        if (isActiveEntryConflict(createErr)) {
          skipped.push({ email, reason: 'Already clocked in' });
          continue;
        }
        throw createErr;
      }
      clockedIn.push({ email, id: entry.id, employeeName: entry.employeeName });

      auditWrites.push(logAudit({
        entity: 'TimeEntry',
        entityId: entry.id,
        action: 'bulk_clock_in',
        actorId: authUser.id,
        actorEmail: authUser.email,
        actorRole: authUser.role,
        justification:
          (typeof justification === 'string' && justification.trim().length > 0
            ? justification.trim().slice(0, 500)
            : `Bulk proxy clock-in for ${employee.firstName} ${employee.surname}`),
        ipAddress: clientIp,
        branch: entry.branch,
        department: entry.department,
        changes: {
          employee_email: { before: null, after: email },
          employee_name: { before: null, after: entry.employeeName },
          clock_in: { before: null, after: entry.clockIn.toISOString() },
          is_manual_override: { before: false, after: true },
          clocked_by: { before: null, after: `${authUser.fullName} (${authUser.email})` },
        } as any,
      }));

      broadcastScoped('timeEntry', 'clockIn', entry, {
        companyProfileId: entry.companyProfileId,
        branch: entry.branch,
        department: entry.department,
      });
    }

    // Durability: wait for every bulk-override audit row before responding.
    await Promise.all(auditWrites);

    res.status(201).json({ success: true, clockedIn, skipped });
  } catch (err) {
    console.error('[timeEntries] Bulk clock-in error:', err);
    internalError(res, 'bulk clock-in');
  }
});

// ── POST /bulk-clock-out (Manager/Admin bulk force clock-out) ──
// One request closes the active sessions of many staff members.
router.post('/bulk-clock-out', requireAdminOrManager, clockRateLimit, validate(bulkClockOutSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const { employeeEmails, breakMinutes } = req.body as {
      employeeEmails: string[];
      breakMinutes?: number | null;
    };
    const breakMins = breakMinutes ?? 0;

    const now = new Date();
    const clientIp = getClientIp(req);
    const clockedOut: Array<{ email: string; id: string; employeeName: string | null; totalHours: number | null }> = [];
    const skipped: Array<{ email: string; reason: string }> = [];
    // Audit writes are collected and awaited before responding (durability).
    const auditWrites: Array<Promise<void>> = [];

    for (const email of employeeEmails) {
      if (authUser.role === 'manager') {
        const inScope = await isEmployeeInManagerScope(authUser, email);
        if (!inScope) {
          skipped.push({ email, reason: 'Outside your management scope' });
          continue;
        }
      }

      const active = await prisma.timeEntry.findFirst({
        where: {
          employeeEmail: email,
          status: 'active',
          ...(authUser.role !== 'master'
            ? { companyProfileId: authUser.companyProfileId ?? '__none__' }
            : {}),
        },
        orderBy: { clockIn: 'desc' },
      });
      if (!active) {
        skipped.push({ email, reason: 'No active session' });
        continue;
      }

      const rawHours = (now.getTime() - active.clockIn.getTime()) / 3_600_000;
      const breakHrs = breakMins / 60;
      const totalHours = Math.max(0, Math.round((rawHours - breakHrs) * 100) / 100);

      const entry = await prisma.timeEntry.update({
        where: { id: active.id },
        data: {
          clockOut: now,
          status: 'completed',
          breakMinutes: breakMins,
          totalHours,
          updatedBy: authUser.id,
        },
      });
      clockedOut.push({ email, id: entry.id, employeeName: entry.employeeName, totalHours });

      auditWrites.push(logAudit({
        entity: 'TimeEntry',
        entityId: entry.id,
        action: 'bulk_clock_out',
        actorId: authUser.id,
        actorEmail: authUser.email,
        actorRole: authUser.role,
        justification: `Bulk force clock-out for ${email}`,
        ipAddress: clientIp,
        branch: entry.branch,
        department: entry.department,
        changes: {
          clock_out: { before: null, after: entry.clockOut?.toISOString() },
          status: { before: 'active', after: 'completed' },
          total_hours: { before: null, after: entry.totalHours },
          forced_by: { before: null, after: `${authUser.fullName} (${authUser.email})` },
        } as any,
      }));

      broadcastScoped('timeEntry', 'clockOut', entry, {
        companyProfileId: entry.companyProfileId,
        branch: entry.branch,
        department: entry.department,
      });
    }

    // Durability: wait for every bulk clock-out audit row before responding.
    await Promise.all(auditWrites);

    res.json({ success: true, clockedOut, skipped });
  } catch (err) {
    console.error('[timeEntries] Bulk clock-out error:', err);
    internalError(res, 'bulk clock-out');
  }
});

// ── PUT /:id (Admin/Manager edit existing time entry) ──
// Allows admins/managers to correct clock-in/out times, break minutes, or the
// date of an existing entry (e.g. forgotten clock-out, incorrect auto-clock-out,
// business-rule corrections). Every adjustment is flagged and audit-logged.
router.put('/:id', requireAdminOrManager, validate(updateTimeEntrySchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;
    const { date, clockIn, clockOut, breakMinutes, reason } = req.body as {
      date?: string;
      clockIn?: string;
      clockOut?: string;
      breakMinutes?: number | null;
      reason: string;
    };

    const existing = await prisma.timeEntry.findUnique({ where: { id } });
    if (!existing) return notFound(res, 'Time entry');

    assertTenantMatch(existing);

    if (authUser.role !== 'master' && existing.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res);
    }
    if (authUser.role === 'manager' && existing.employeeEmail) {
      const inScope = await isEmployeeInManagerScope(authUser, existing.employeeEmail);
      if (!inScope) return outsideScope(res, 'Employee');
    }

    // ── Resolve effective values (merge existing with supplied changes) ──
    const entryDateStr = date ?? toDateStr(existing.date);
    const existingClockInStr = `${String(existing.clockIn.getHours()).padStart(2, '0')}:${String(existing.clockIn.getMinutes()).padStart(2, '0')}`;
    const existingClockOutStr = existing.clockOut
      ? `${String(existing.clockOut.getHours()).padStart(2, '0')}:${String(existing.clockOut.getMinutes()).padStart(2, '0')}`
      : null;

    const effectiveClockInStr = clockIn ?? existingClockInStr;
    const effectiveClockOutStr = clockOut ?? existingClockOutStr;
    const effectiveBreakMinutes = breakMinutes !== undefined ? (breakMinutes ?? 0) : (existing.breakMinutes ?? 0);

    const clockInDate = new Date(`${entryDateStr}T${effectiveClockInStr}:00`);
    // If no clock-out is available (entry still active), keep it null
    const clockOutDate = effectiveClockOutStr ? new Date(`${entryDateStr}T${effectiveClockOutStr}:00`) : null;

    if (clockOutDate && clockOutDate <= clockInDate) {
      return badRequest(res, 'Clock-out must be after clock-in.');
    }

    // Recalculate total hours when clock-out exists
    let totalHours = existing.totalHours;
    let newStatus = existing.status;
    if (clockOutDate) {
      const rawHours = (clockOutDate.getTime() - clockInDate.getTime()) / 3_600_000;
      const breakHrs = effectiveBreakMinutes / 60;
      totalHours = Math.max(0, Math.round((rawHours - breakHrs) * 100) / 100);
      newStatus = 'completed';
    }

    const trimmedReason = reason.trim().slice(0, 2000);

    const entry = await prisma.timeEntry.update({
      where: { id },
      data: {
        date: parseDate(entryDateStr),
        clockIn: clockInDate,
        clockOut: clockOutDate,
        breakMinutes: effectiveBreakMinutes,
        totalHours,
        status: newStatus,
        isManuallyAdjusted: true,
        adjustedById: authUser.id,
        adjustedByName: authUser.fullName,
        adjustmentReason: trimmedReason,
        updatedBy: authUser.id,
      },
    });

    // ── Audit logging with full before/after state ──
    const changes = {
      date: { before: toDateStr(existing.date), after: entryDateStr },
      clock_in: { before: existing.clockIn.toISOString(), after: entry.clockIn.toISOString() },
      clock_out: { before: existing.clockOut?.toISOString() ?? null, after: entry.clockOut?.toISOString() ?? null },
      break_minutes: { before: existing.breakMinutes, after: entry.breakMinutes },
      total_hours: { before: existing.totalHours, after: entry.totalHours },
      status: { before: existing.status, after: entry.status },
      is_manually_adjusted: { before: existing.isManuallyAdjusted, after: true },
      adjusted_by: { before: null, after: `${authUser.fullName} (${authUser.email})` },
    };

    await logAudit({
      entity: 'TimeEntry',
      entityId: entry.id,
      action: 'manual_adjust',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: `Manual adjustment for ${existing.employeeName ?? existing.employeeEmail}: ${trimmedReason}`,
      ipAddress: getClientIp(req),
      branch: entry.branch,
      department: entry.department,
      changes: changes as any,
    });

    broadcastScoped('timeEntry', 'update', entry, {
      companyProfileId: entry.companyProfileId,
      branch: entry.branch,
      department: entry.department,
    });

    res.json(entry);
  } catch (err) {
    console.error('[timeEntries] Update error:', err);
    internalError(res, 'updating time entry');
  }
});

// ── DELETE /:id ──
router.delete('/:id', requireAdminOrManager, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;

    const existing = await prisma.timeEntry.findUnique({ where: { id } });
    if (!existing) return notFound(res, 'Time entry');

    // Defense-in-depth: verify the fetched record belongs to the request's
    // tenant context (blocks any future query that forgets its tenant filter).
    assertTenantMatch(existing);

    if (authUser.role !== 'master' && existing.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res);
    }
    if (authUser.role === 'manager' && existing.employeeEmail) {
      const inScope = await isEmployeeInManagerScope(authUser, existing.employeeEmail);
      if (!inScope) return outsideScope(res, 'Employee');
    }

    await prisma.timeEntry.delete({ where: { id } });

    // Enhanced audit for time entry deletion with full before state
    const deleteChanges = {
      employee_email: { before: existing.employeeEmail, after: null },
      employee_name: { before: existing.employeeName, after: null },
      date: { before: existing.date.toISOString().slice(0, 10), after: null },
      clock_in: { before: existing.clockIn.toISOString(), after: null },
      clock_out: { before: existing.clockOut?.toISOString() ?? null, after: null },
      total_hours: { before: existing.totalHours, after: null },
      status: { before: existing.status, after: null },
      is_manual_override: { before: existing.isManualOverride, after: null },
    };

    logAudit({
      entity: 'TimeEntry',
      entityId: id,
      action: 'delete',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: `Deleted time entry for ${existing.employeeEmail}`,
      ipAddress: getClientIp(req),
      branch: existing.branch,
      department: existing.department,
      changes: deleteChanges as any,
    });

    broadcastScoped('timeEntry', 'delete', { id }, {
      companyProfileId: existing.companyProfileId,
      branch: existing.branch,
      department: existing.department,
    });

    res.json({ success: true, deleted: id });
  } catch (err) {
    console.error('[timeEntries] Delete error:', err);
    internalError(res, 'deleting time entry');
  }
});

export default router;