/**
 * Shift Routes
 * ------------
 * Shift scheduling with overlap detection, RBAC scoping,
 * and status lifecycle management.
 */

import { Router } from 'express';
import prisma from '../prisma.js';
import { requireAuth, requireAdminOrManager } from '../middleware/auth.js';
import { getManagerScopeFilter, isEmployeeInManagerScope } from '../middleware/scope.js';
import { validate, createShiftSchema, updateShiftSchema, expandShiftDateRange } from '../validation.js';
import { logAudit, getClientIp, computeChanges } from '../audit.js';
import { broadcastScoped } from '../sse.js';
import {
  notFound,
  accessDenied,
  outsideScope,
  badRequest,
  internalError,
  shiftOverlap,
  sendError,
} from '../errorResponse.js';
import { countOverlaps, parseDate, type ShiftTimeWindow } from '../overlap.js';

const router = Router();

router.use(requireAuth);

function tenantWhere(authUser: { role: string; companyProfileId: string | null }) {
  return authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };
}

/** Detect overlapping shifts for the same employee on the same date. */
async function findOverlaps(
  employeeId: string,
  date: string,
  startTime: string | null,
  endTime: string | null,
  excludeShiftId?: string,
): Promise<number> {
  if (!startTime || !endTime) return 0;

  const shifts = await prisma.shift.findMany({
    where: {
      employeeId,
      date: parseDate(date),
      status: { in: ['scheduled', 'active'] },
      ...(excludeShiftId ? { id: { not: excludeShiftId } } : {}),
      startTime: { not: null },
      endTime: { not: null },
    },
    select: { startTime: true, endTime: true },
  });

  return countOverlaps(startTime, endTime, shifts);
}

// ── GET / (List shifts) ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const date = req.query.date as string;
    const fromDate = req.query.from as string;
    const toDate = req.query.to as string;
    const employeeId = req.query.employeeId as string;
    const status = req.query.status as string;
    const branch = req.query.branch as string;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 500, 500);
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const where: Record<string, unknown> = { ...tenantWhere(authUser) };

    // Employee sees own shifts only
    if (authUser.role === 'employee') {
      where.employeeEmail = authUser.email;
    } else if (authUser.role === 'manager') {
      const scopeFilter = await getManagerScopeFilter(authUser);
      // Scope via employee relation
      where.employee = scopeFilter;
    }

    if (date) where.date = parseDate(date);
    if (fromDate && toDate) {
      where.date = { gte: parseDate(fromDate), lte: parseDate(toDate) };
    }
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;
    if (branch) where.branch = branch;

    const [items, total] = await Promise.all([
      prisma.shift.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        include: { employee: { select: { id: true, firstName: true, surname: true, email: true } } },
      }),
      prisma.shift.count({ where }),
    ]);

    res.json({ items, total });
  } catch (err) {
    console.error('[shifts] List error:', err);
    internalError(res, 'fetching shifts');
  }
});

// ── POST / (Create shift) ──
router.post('/', requireAdminOrManager, validate(createShiftSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const data = { ...req.body };

    // Resolve employee and check scope
    let employee = null;
    if (data.employeeId) {
      employee = await prisma.employee.findUnique({ where: { id: data.employeeId } });
      if (!employee) return notFound(res, 'Employee');

      if (authUser.role === 'manager') {
        const inScope = await isEmployeeInManagerScope(authUser, employee.email);
        if (!inScope) return outsideScope(res, 'Employee');
      }
      if (authUser.role !== 'master' && employee.companyProfileId !== authUser.companyProfileId) {
        return accessDenied(res, 'Employee belongs to a different company.');
      }
    }

    // Overlap detection
    if (data.employeeId && data.startTime && data.endTime) {
      const overlaps = await findOverlaps(data.employeeId, data.date, data.startTime, data.endTime);
      if (overlaps > 0) {
        return shiftOverlap(res, { date: data.date, startTime: data.startTime, endTime: data.endTime });
      }
    }

    const companyProfileId = authUser.role === 'master' ? employee?.companyProfileId : authUser.companyProfileId;

    const shift = await prisma.shift.create({
      data: {
        date: parseDate(data.date),
        startTime: data.startTime ?? null,
        endTime: data.endTime ?? null,
        shiftType: data.shiftType ?? 'full_day',
        employeeId: data.employeeId ?? null,
        location: data.location ?? null,
        notes: data.notes ?? null,
        branch: employee?.branch ?? data.branch ?? null,
        department: employee?.department ?? null,
        employeeEmail: employee?.email ?? null,
        employeeName: employee ? `${employee.firstName} ${employee.surname}` : null,
        companyProfileId,
        createdBy: authUser.id,
        updatedBy: authUser.id,
      },
    });

    logAudit({
      entity: 'Shift',
      entityId: shift.id,
      action: 'create',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      ipAddress: getClientIp(req),
      branch: shift.branch,
      department: shift.department,
    });

    broadcastScoped('shift', 'create', shift, {
      companyProfileId,
      branch: shift.branch,
      department: shift.department,
    });

    res.status(201).json(shift);
  } catch (err) {
    console.error('[shifts] Create error:', err);
    internalError(res, 'creating the shift');
  }
});

// ── PUT /:id (Update shift) ──
router.put('/:id', requireAdminOrManager, validate(updateShiftSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;
    const data = { ...req.body } as Record<string, unknown>;

    const existing = await prisma.shift.findUnique({ where: { id } });
    if (!existing) return notFound(res, 'Shift');

    if (authUser.role !== 'master' && existing.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res, 'Shift belongs to a different company.');
    }
    if (authUser.role === 'manager' && existing.employeeEmail) {
      const inScope = await isEmployeeInManagerScope(authUser, existing.employeeEmail);
      if (!inScope) return outsideScope(res, 'Employee');
    }

    // Terminal statuses require a reason note
    const newStatus = data.status as string | undefined;
    if (newStatus && ['cancelled', 'no_show'].includes(newStatus) && !data.notes && !existing.notes) {
      return badRequest(res, 'A reason note is required when marking a shift as cancelled or no-show.', {
        field: 'notes',
        requirement: 'Provide a notes field explaining the reason.',
      });
    }

    // Overlap detection on reschedule
    if (data.date || data.startTime || data.endTime) {
      const dateStr = (data.date as string) ?? existing.date.toISOString().slice(0, 10);
      // Note: existing.date.toISOString() is safe here because dates are stored as UTC noon
      const startTime = (data.startTime as string) ?? existing.startTime;
      const endTime = (data.endTime as string) ?? existing.endTime;
      if (existing.employeeId && startTime && endTime) {
        const overlaps = await findOverlaps(existing.employeeId, dateStr, startTime, endTime, id);
        if (overlaps > 0) {
          return shiftOverlap(res, { date: dateStr, startTime: startTime ?? undefined, endTime: endTime ?? undefined });
        }
      }
      if (data.date) data.date = parseDate(dateStr);
    }

    const updated = await prisma.shift.update({
      where: { id },
      data: { ...data, updatedBy: authUser.id },
    });

    const changes = computeChanges(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
    logAudit({
      entity: 'Shift',
      entityId: id,
      action: 'update',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      changes,
      ipAddress: getClientIp(req),
      branch: updated.branch,
      department: updated.department,
    });

    broadcastScoped('shift', 'update', updated, {
      companyProfileId: updated.companyProfileId,
      branch: updated.branch,
      department: updated.department,
    });

    res.json(updated);
  } catch (err) {
    console.error('[shifts] Update error:', err);
    internalError(res, 'updating the shift');
  }
});

// ── DELETE /:id ──
router.delete('/:id', requireAdminOrManager, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;

    const existing = await prisma.shift.findUnique({ where: { id } });
    if (!existing) return notFound(res, 'Shift');

    if (authUser.role !== 'master' && existing.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res, 'Shift belongs to a different company.');
    }
    if (authUser.role === 'manager' && existing.employeeEmail) {
      const inScope = await isEmployeeInManagerScope(authUser, existing.employeeEmail);
      if (!inScope) return outsideScope(res, 'Employee');
    }

    await prisma.shift.delete({ where: { id } });

    logAudit({
      entity: 'Shift',
      entityId: id,
      action: 'delete',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      ipAddress: getClientIp(req),
      branch: existing.branch,
      department: existing.department,
    });

    broadcastScoped('shift', 'delete', { id }, {
      companyProfileId: existing.companyProfileId,
      branch: existing.branch,
      department: existing.department,
    });

    res.json({ success: true, deleted: id });
  } catch (err) {
    console.error('[shifts] Delete error:', err);
    internalError(res, 'deleting the shift');
  }
});

// ── POST /bulk (Bulk shift assignment) ──
// Assign the same shift template to multiple employees at once. When `endDate`
// is provided, the template is applied to EVERY day in [date, endDate] —
// one shift per employee per day (bulk schedule generation).
// Body: { employeeIds: string[], date: string, endDate?: string, startTime?: string,
//         endTime?: string, shiftType?: string, location?: string, notes?: string, skipOverlaps?: boolean }
router.post('/bulk', requireAdminOrManager, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const {
      employeeIds,
      date,
      endDate,
      startTime,
      endTime,
      shiftType,
      location,
      notes,
      skipOverlaps,
    } = req.body as {
      employeeIds?: string[];
      date?: string;
      endDate?: string;
      startTime?: string;
      endTime?: string;
      shiftType?: string;
      location?: string;
      notes?: string;
      skipOverlaps?: boolean;
    };

    // Validate required fields
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return badRequest(res, 'At least one employee ID is required for bulk assignment.', { field: 'employeeIds' });
    }
    if (employeeIds.length > 100) {
      return badRequest(res, 'Bulk assignment is limited to 100 employees at a time.', { field: 'employeeIds', max: 100 });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return badRequest(res, 'A valid date (YYYY-MM-DD) is required.', { field: 'date' });
    }
    if (endDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return badRequest(res, 'A valid end date (YYYY-MM-DD) is required.', { field: 'endDate' });
    }

    // Expand the date range (single day when endDate is omitted)
    const range = expandShiftDateRange(date, endDate ?? undefined);
    if (!range.ok) {
      return badRequest(res, range.error, { field: range.field });
    }
    const dates = range.days;

    // Fetch and validate employees
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
    });

    const foundIds = new Set(employees.map((e) => e.id));
    const missingIds = employeeIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      return notFound(res, `Employee(s) with ID(s): ${missingIds.join(', ')}`);
    }

    // Scope and tenant checks per employee
    for (const employee of employees) {
      if (authUser.role === 'manager') {
        const inScope = await isEmployeeInManagerScope(authUser, employee.email);
        if (!inScope) return outsideScope(res, `Employee ${employee.firstName} ${employee.surname}`);
      }
      if (authUser.role !== 'master' && employee.companyProfileId !== authUser.companyProfileId) {
        return accessDenied(res, `Employee ${employee.firstName} ${employee.surname} belongs to a different company.`);
      }
    }

    // Overlap detection per employee × day (unless skipOverlaps is true).
    // All conflicting shifts across the whole range are fetched in ONE query
    // and indexed by "employeeId|YYYY-MM-DD" for fast lookups.
    const skipped: Array<{ employeeId: string; employeeName: string; date?: string; reason: string }> = [];
    let overlapWindows: Map<string, ShiftTimeWindow[]> | null = null;
    if (!skipOverlaps && startTime && endTime) {
      overlapWindows = new Map();
      const existing = await prisma.shift.findMany({
        where: {
          employeeId: { in: employees.map((e) => e.id) },
          date: { gte: parseDate(dates[0]), lte: parseDate(dates[dates.length - 1]) },
          status: { in: ['scheduled', 'active'] },
          startTime: { not: null },
          endTime: { not: null },
        },
        select: { employeeId: true, date: true, startTime: true, endTime: true },
      });
      for (const s of existing) {
        // Dates are stored at UTC noon, so slice(0,10) is timezone-safe.
        const key = `${s.employeeId}|${s.date.toISOString().slice(0, 10)}`;
        const list = overlapWindows.get(key) ?? [];
        list.push({ startTime: s.startTime, endTime: s.endTime });
        overlapWindows.set(key, list);
      }
    }

    const toCreate: Array<{ employee: (typeof employees)[number]; date: string }> = [];
    for (const day of dates) {
      for (const employee of employees) {
        if (overlapWindows && startTime && endTime) {
          const windows = overlapWindows.get(`${employee.id}|${day}`) ?? [];
          if (countOverlaps(startTime, endTime, windows) > 0) {
            skipped.push({
              employeeId: employee.id,
              employeeName: `${employee.firstName} ${employee.surname}`,
              date: day,
              reason: 'Shift overlaps with an existing shift',
            });
            continue;
          }
        }
        toCreate.push({ employee, date: day });
      }
    }

    if (toCreate.length === 0) {
      return sendError(
        res,
        409,
        'No shifts were created. All employees had scheduling conflicts.',
        {
          code: 'BULK_ALL_SKIPPED',
          details: { skipped },
        },
      );
    }

    // Create shifts (employees × days) in a transaction
    const created = await prisma.$transaction(
      toCreate.map(({ employee, date: day }) =>
        prisma.shift.create({
          data: {
            date: parseDate(day),
            startTime: startTime ?? null,
            endTime: endTime ?? null,
            shiftType: (shiftType as 'full_day' | 'half_day' | 'Holiday' | 'Leave' | 'Sick' | 'PTO' | 'Unpaid') ?? 'full_day',
            employeeId: employee.id,
            location: location ?? null,
            notes: notes ?? null,
            branch: employee.branch,
            department: employee.department,
            employeeEmail: employee.email,
            employeeName: `${employee.firstName} ${employee.surname}`,
            companyProfileId: employee.companyProfileId,
            createdBy: authUser.id,
            updatedBy: authUser.id,
          },
        }),
      ),
    );

    // Audit log for bulk operation
    const rangeLabel = dates.length > 1 ? `${dates[0]} to ${dates[dates.length - 1]}` : dates[0];
    logAudit({
      entity: 'Shift',
      entityId: created[0]?.id ?? 'bulk',
      action: 'bulk_create',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: `Bulk assigned ${created.length} shift(s) for ${rangeLabel}${skipped.length > 0 ? ` (${skipped.length} skipped due to conflicts)` : ''}`,
      ipAddress: getClientIp(req),
      changes: {
        date: { before: null, after: dates[0] },
        endDate: { before: null, after: dates.length > 1 ? dates[dates.length - 1] : null },
        days: { before: null, after: dates.length },
        employees_assigned: { before: null, after: created.length },
        employees_skipped: { before: null, after: skipped.length },
        shift_type: { before: null, after: shiftType ?? 'full_day' },
      } as any,
    });

    // Broadcast SSE event
    broadcastScoped('shift', 'bulkCreate', { count: created.length, date: dates[0], endDate: dates[dates.length - 1] }, {
      companyProfileId: authUser.companyProfileId,
    });

    res.status(201).json({
      success: true,
      created: created.length,
      skipped: skipped.length,
      skippedDetails: skipped,
      shiftIds: created.map((s) => s.id),
      days: dates.length,
    });
  } catch (err) {
    console.error('[shifts] Bulk create error:', err);
    internalError(res, 'creating bulk shifts');
  }
});

export default router;
