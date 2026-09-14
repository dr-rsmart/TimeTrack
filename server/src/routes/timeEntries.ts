/**
 * Time Entry Routes
 * -----------------
 * Clock-in/out with geofence validation, manual overrides,
 * and active-session overlap prevention.
 */

import { Router } from 'express';
import prisma from '../prisma.js';
import { requireAuth, requireAdminOrManager } from '../middleware/auth.js';
import { getManagerScopeFilter } from '../middleware/scope.js';
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
import { getClientIp } from '../audit.js';
import { ATTENDANCE_STATUS, scopeIdempotencyKey } from '../domain/attendance.js';
import { employeeIdentityFilter } from '../domain/employeeIdentity.js';
import {
  AttendanceUseCaseError,
  clockIn as clockInUseCase,
  clockOut as clockOutUseCase,
  createManualTimeEntry,
  bulkClockIn as bulkClockInUseCase,
  bulkClockOut as bulkClockOutUseCase,
  adjustTimeEntry,
  deleteTimeEntry,
} from '../application/attendance.js';
import { accessDenied, internalError, sendError } from '../errorResponse.js';

const router = Router();

router.use(requireAuth);

function tenantWhere(authUser: { role: string; companyProfileId: string | null }) {
  return authUser.role === 'master'
    ? {}
    : { companyProfileId: authUser.companyProfileId ?? '__none__' };
}

function scopeIdempotencyKeyForRoute(
  action: 'clock_in' | 'clock_out',
  actorId: string,
  value: string | undefined,
): string | null {
  return scopeIdempotencyKey(action, actorId, value);
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
      const employee = await prisma.employee.findFirst({
        where: {
          ...tenantWhere(authUser),
          email: { equals: authUser.email, mode: 'insensitive' },
        },
        select: { id: true, email: true },
      });
      Object.assign(
        where,
        employee ? employeeIdentityFilter([employee]) : { employeeId: '__none__' },
      );
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
        select: { id: true, email: true },
      });
      Object.assign(where, employeeIdentityFilter(scopedEmployees));
    }

    // Inclusive, timezone-safe day boundaries (UTC start-of-day â†’ end-of-day)
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
    if (employeeEmail && authUser.role !== 'employee') {
      const employee = await prisma.employee.findFirst({
        where: {
          ...tenantWhere(authUser),
          email: { equals: employeeEmail, mode: 'insensitive' },
        },
        select: { id: true, email: true },
      });
      Object.assign(
        where,
        employee ? employeeIdentityFilter([employee]) : { employeeId: '__none__' },
      );
    }
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

    const employee = await prisma.employee.findFirst({
      where: {
        ...tenantWhere(authUser),
        email: { equals: email, mode: 'insensitive' },
      },
      select: { id: true, email: true },
    });
    const active = await prisma.timeEntry.findFirst({
      where: {
        ...tenantWhere(authUser),
        ...(employee ? employeeIdentityFilter([employee]) : { employeeId: '__none__' }),
        status: ATTENDANCE_STATUS.ACTIVE,
      },
      orderBy: { clockIn: 'desc' },
    });

    res.json({ active });
  } catch (err) {
    console.error('[timeEntries] Active error:', err);
    internalError(res, 'fetching active session');
  }
});

/** Translate an application error into the existing API error envelope. */
function sendAttendanceUseCaseError(
  res: import('express').Response,
  error: unknown,
  context: string,
): void {
  if (error instanceof AttendanceUseCaseError) {
    sendError(res, error.status, error.message, {
      code: error.code,
      details: error.details,
      suggestions: error.suggestions,
    });
    return;
  }
  console.error(`[timeEntries] ${context}:`, error);
  internalError(res, context);
}

// ── POST /clock-in ── (application use case adapter)
router.post('/clock-in', requireAuth, clockRateLimit, validate(clockInSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const body = req.body as Record<string, unknown>;
    const position =
      typeof body.latitude === 'number' && typeof body.longitude === 'number'
        ? { latitude: body.latitude, longitude: body.longitude }
        : null;
    const result = await clockInUseCase({
      actor: authUser,
      targetEmail: typeof body.employee_email === 'string' ? body.employee_email : undefined,
      position,
      justification: typeof body.justification === 'string' ? body.justification : undefined,
      idempotencyKey: scopeIdempotencyKeyForRoute(
        'clock_in',
        authUser.id,
        req.get('Idempotency-Key'),
      ),
      clientIp: getClientIp(req),
    });
    // Keep the normal TimeEntry shape while exposing replay status to native
    // background callers. A 200 response can mean either a successful retry
    // or a newly-created entry, so clients must not infer that from status alone.
    res.status(result.replayed ? 200 : 201).json({ ...result.entry, replayed: result.replayed });
  } catch (error) {
    sendAttendanceUseCaseError(res, error, 'recording clock-in');
  }
});

// ── POST /clock-out ── (application use case adapter)
router.post(
  '/clock-out',
  requireAuth,
  clockRateLimit,
  validate(clockOutSchema),
  async (req, res) => {
    try {
      const authUser = req.authUser!;
      const body = req.body as Record<string, unknown>;
      const position =
        typeof body.latitude === 'number' && typeof body.longitude === 'number'
          ? { latitude: body.latitude, longitude: body.longitude }
          : null;
      const result = await clockOutUseCase({
        actor: authUser,
        targetEmail: typeof body.employee_email === 'string' ? body.employee_email : undefined,
        position,
        breakMinutes: typeof body.breakMinutes === 'number' ? body.breakMinutes : 0,
        idempotencyKey: scopeIdempotencyKeyForRoute(
          'clock_out',
          authUser.id,
          req.get('Idempotency-Key'),
        ),
        clientIp: getClientIp(req),
      });
      res.status(200).json({ ...result.entry, replayed: result.replayed });
    } catch (error) {
      sendAttendanceUseCaseError(res, error, 'recording clock-out');
    }
  },
);

// ── POST /manual (Manager/Admin manual entry) ──
router.post('/manual', requireAdminOrManager, validate(manualTimeEntrySchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const body = req.body as {
      employeeId: string;
      date: string;
      clockIn: string;
      clockOut: string;
      breakMinutes?: number | null;
      notes?: string | null;
    };
    const entry = await createManualTimeEntry({
      actor: authUser,
      employeeId: body.employeeId,
      date: body.date,
      clockIn: body.clockIn,
      clockOut: body.clockOut,
      breakMinutes: body.breakMinutes ?? 0,
      notes: body.notes ?? undefined,
      clientIp: getClientIp(req),
    });
    res.status(201).json(entry);
  } catch (error) {
    sendAttendanceUseCaseError(res, error, 'creating manual time entry');
  }
});

// ── POST /bulk-clock-in (Manager/Admin bulk proxy clock-in) ──
router.post(
  '/bulk-clock-in',
  requireAdminOrManager,
  clockRateLimit,
  validate(bulkClockInSchema),
  async (req, res) => {
    try {
      const authUser = req.authUser!;
      const body = req.body as { employeeEmails: string[]; justification?: string };
      const result = await bulkClockInUseCase({
        actor: authUser,
        employeeEmails: body.employeeEmails,
        justification: body.justification,
        clientIp: getClientIp(req),
      });
      res.status(201).json({ success: true, ...result });
    } catch (error) {
      sendAttendanceUseCaseError(res, error, 'bulk clock-in');
    }
  },
);

// ── POST /bulk-clock-out (Manager/Admin bulk force clock-out) ──
router.post(
  '/bulk-clock-out',
  requireAdminOrManager,
  clockRateLimit,
  validate(bulkClockOutSchema),
  async (req, res) => {
    try {
      const authUser = req.authUser!;
      const body = req.body as { employeeEmails: string[]; breakMinutes?: number | null };
      const result = await bulkClockOutUseCase({
        actor: authUser,
        employeeEmails: body.employeeEmails,
        breakMinutes: body.breakMinutes ?? 0,
        clientIp: getClientIp(req),
      });
      res.json({ success: true, ...result });
    } catch (error) {
      sendAttendanceUseCaseError(res, error, 'bulk clock-out');
    }
  },
);

// ── PUT /:id (Admin/Manager edit existing time entry) ──
router.put('/:id', requireAdminOrManager, validate(updateTimeEntrySchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const body = req.body as {
      date?: string;
      clockIn?: string;
      clockOut?: string;
      breakMinutes?: number | null;
      reason: string;
    };
    const entry = await adjustTimeEntry({
      actor: authUser,
      id: String(req.params.id),
      date: body.date,
      clockIn: body.clockIn,
      clockOut: body.clockOut,
      breakMinutes: body.breakMinutes,
      reason: body.reason,
      clientIp: getClientIp(req),
    });
    res.json(entry);
  } catch (error) {
    sendAttendanceUseCaseError(res, error, 'updating time entry');
  }
});

// ── DELETE /:id ──
router.delete('/:id', requireAdminOrManager, async (req, res) => {
  try {
    const result = await deleteTimeEntry({
      actor: req.authUser!,
      id: String(req.params.id),
      clientIp: getClientIp(req),
    });
    res.json({ success: true, deleted: result.id });
  } catch (error) {
    sendAttendanceUseCaseError(res, error, 'deleting time entry');
  }
});

export default router;
