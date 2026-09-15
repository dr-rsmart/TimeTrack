/**
 * Reports Routes
 * --------------
 * Payroll/overtime reporting using the Decimal-precision payroll engine.
 */

import { Router } from 'express';
import { logger } from '../logger.js';
import prisma from '../prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { getManagerScopeFilter } from '../middleware/scope.js';
import { computeOvertime, defaultSettings, type PayrollSettings } from '../payroll.js';
import { badRequest, internalError } from '../errorResponse.js';
import { employeeIdentityFilter, identityKey } from '../domain/employeeIdentity.js';
import { storedDurationHours } from '../domain/duration.js';

const router = Router();

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function getPayrollSettings(companyProfileId: string | null): Promise<PayrollSettings> {
  // Fetch system-wide holidays (Master-managed, companyProfileId = null)
  const systemSettings = await prisma.companySettings.findFirst({
    where: { companyProfileId: null },
    select: { publicHolidays: true },
  });
  const systemHolidays = systemSettings?.publicHolidays ?? [];

  if (!companyProfileId) {
    const defaults = defaultSettings();
    return { ...defaults, publicHolidays: systemHolidays };
  }

  const settings = await prisma.companySettings.findFirst({
    where: { companyProfileId },
    orderBy: { updatedAt: 'desc' },
  });
  if (!settings) {
    const defaults = defaultSettings();
    return { ...defaults, publicHolidays: systemHolidays };
  }

  // Merge system-wide + company-specific holidays (deduplicated)
  const mergedHolidays = [...new Set([...systemHolidays, ...settings.publicHolidays])];

  return {
    overtimeThresholdHours: settings.overtimeThresholdHours,
    useMonthlyOvertimeThreshold: settings.useMonthlyOvertimeThreshold,
    monthlyOvertimeThresholdHours: settings.monthlyOvertimeThresholdHours,
    sundayOvertimeEnabled: settings.sundayOvertimeEnabled,
    sundayOvertimeMultiplier: settings.sundayOvertimeMultiplier,
    publicHolidayOvertimeEnabled: settings.publicHolidayOvertimeEnabled,
    publicHolidayOvertimeMultiplier: settings.publicHolidayOvertimeMultiplier,
    publicHolidays: mergedHolidays,
  };
}

// ── GET /payroll — per-employee payroll summary for a date range ──
router.get('/payroll', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const from =
      (req.query.from as string) ||
      toDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const to = (req.query.to as string) || toDateStr(new Date());
    const branch = req.query.branch as string;
    const department = req.query.department as string;
    const employeeEmail = req.query.employeeEmail as string;
    const employeeId = req.query.employeeId as string;

    const tenantWhere =
      authUser.role === 'master'
        ? {}
        : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    // Determine which employees to report on
    let employeeWhere: Record<string, unknown> = { ...tenantWhere };
    if (authUser.role === 'employee') {
      employeeWhere.email = authUser.email;
    } else if (authUser.role === 'manager') {
      const scopeFilter = await getManagerScopeFilter(authUser);
      employeeWhere = { ...employeeWhere, ...scopeFilter };
    }
    if (branch) employeeWhere.branch = branch;
    if (department) employeeWhere.department = department;
    if (employeeEmail) employeeWhere.email = { equals: employeeEmail, mode: 'insensitive' };
    if (employeeId) employeeWhere.id = employeeId;

    const employees = await prisma.employee.findMany({
      where: employeeWhere,
      select: {
        id: true,
        firstName: true,
        surname: true,
        email: true,
        branch: true,
        department: true,
        position: true,
        employeeNumber: true,
      },
      orderBy: [{ branch: 'asc' }, { surname: 'asc' }],
    });

    // Inclusive, timezone-safe range boundaries (UTC start-of-day → end-of-day)
    // so the payroll window always covers exactly the same dates as the
    // Time Entries list endpoint. Local-midnight boundaries previously shifted
    // the window by the server's UTC offset, dropping the "to" date entirely on
    // UTC+ servers and making the two tabs disagree after manual edits.
    const fromDate = new Date(from + 'T00:00:00Z');
    const toDate = new Date(to + 'T23:59:59.999Z');

    // Fetch all completed time entries in range for these employees
    const identityFilter = employeeIdentityFilter(employees);
    const entries = await prisma.timeEntry.findMany({
      where: {
        ...tenantWhere,
        ...identityFilter,
        date: { gte: fromDate, lte: toDate },
        status: 'completed',
      },
      select: {
        employeeId: true,
        employeeEmail: true,
        date: true,
        totalMinutes: true,
        totalHours: true,
      },
    });

    // Fetch shifts in range for leave-type exclusion
    const shifts = await prisma.shift.findMany({
      where: {
        ...tenantWhere,
        ...identityFilter,
        date: { gte: fromDate, lte: toDate },
      },
      select: { employeeId: true, employeeEmail: true, date: true, shiftType: true },
    });

    const settings = await getPayrollSettings(authUser.companyProfileId);

    // Group entries by employee+date
    const hoursByEmailDate: Record<string, Record<string, number>> = {};
    for (const e of entries) {
      const key = identityKey(e.employeeId, e.employeeEmail);
      const dateKey = toDateStr(e.date);
      if (!hoursByEmailDate[key]) hoursByEmailDate[key] = {};
      hoursByEmailDate[key][dateKey] =
        (hoursByEmailDate[key][dateKey] ?? 0) + storedDurationHours(e.totalMinutes, e.totalHours);
    }

    const shiftTypeByEmailDate: Record<string, Record<string, string>> = {};
    for (const s of shifts) {
      if (!s.employeeEmail) continue;
      const key = identityKey(s.employeeId, s.employeeEmail ?? '');
      const dateKey = toDateStr(s.date);
      if (!shiftTypeByEmailDate[key]) shiftTypeByEmailDate[key] = {};
      shiftTypeByEmailDate[key][dateKey] = s.shiftType;
    }

    const rows = employees.map((emp) => {
      const employeeKey = identityKey(emp.id, emp.email);
      const byDate = hoursByEmailDate[employeeKey] ?? {};
      const shiftTypes = shiftTypeByEmailDate[employeeKey] ?? {};
      const overtime = computeOvertime(byDate, shiftTypes, settings);
      const daysWorked = Object.keys(byDate).filter((d) => byDate[d] > 0).length;
      return {
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.surname}`,
        email: emp.email,
        branch: emp.branch,
        department: emp.department,
        position: emp.position,
        employeeNumber: emp.employeeNumber,
        daysWorked,
        ...overtime,
      };
    });

    res.json({ from, to, rows, settings });
  } catch (err) {
    logger.error('[reports] Payroll error:', err);
    internalError(res, 'generating payroll report');
  }
});

// ── POST /payroll/snapshot — persist an immutable payroll calculation ──
router.post('/payroll/snapshot', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    if (!authUser.companyProfileId || !['admin', 'manager', 'master'].includes(authUser.role)) {
      return res.status(403).json({ error: 'Payroll snapshots require an administrator context.' });
    }
    const from = String(req.body?.from ?? '');
    const to = String(req.body?.to ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return badRequest(res, 'Snapshot from and to dates must use YYYY-MM-DD.');
    }

    const settings = await getPayrollSettings(authUser.companyProfileId);
    const employees = await prisma.employee.findMany({
      where: { companyProfileId: authUser.companyProfileId ?? '__none__' },
      select: { id: true, email: true },
    });
    const results = await Promise.all(
      employees.map(async (employee) => {
        const entries = await prisma.timeEntry.findMany({
          where: {
            companyProfileId: authUser.companyProfileId ?? '__none__',
            ...employeeIdentityFilter([employee]),
            date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59.999Z`) },
            status: 'completed',
          },
          select: { date: true, totalMinutes: true, totalHours: true },
        });
        const byDate: Record<string, number> = {};
        for (const entry of entries) {
          const date = toDateStr(entry.date);
          byDate[date] =
            (byDate[date] ?? 0) + storedDurationHours(entry.totalMinutes, entry.totalHours);
        }
        return { employee, result: computeOvertime(byDate, undefined, settings) };
      }),
    );
    await prisma.$transaction(
      results.map(({ employee, result }) =>
        prisma.payrollPeriodSnapshot.upsert({
          where: {
            companyProfileId_periodFrom_periodTo_employeeId: {
              companyProfileId: authUser.companyProfileId!,
              periodFrom: new Date(`${from}T00:00:00Z`),
              periodTo: new Date(`${to}T00:00:00Z`),
              employeeId: employee.id,
            },
          },
          create: {
            companyProfileId: authUser.companyProfileId!,
            periodFrom: new Date(`${from}T00:00:00Z`),
            periodTo: new Date(`${to}T00:00:00Z`),
            employeeId: employee.id,
            employeeEmail: employee.email,
            settings: settings as object,
            result: result as object,
            createdBy: authUser.id,
          },
          update: {
            settings: settings as object,
            result: result as object,
            createdBy: authUser.id,
          },
        }),
      ),
    );
    res.status(201).json({ success: true, snapshots: results.length, from, to });
  } catch (err) {
    logger.error('[reports] Payroll snapshot error:', err);
    internalError(res, 'creating payroll snapshot');
  }
});

router.get('/payroll/snapshots', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    if (!authUser.companyProfileId || !['admin', 'manager', 'master'].includes(authUser.role)) {
      return res.status(403).json({ error: 'Payroll snapshots require an administrator context.' });
    }
    const from =
      typeof req.query.from === 'string' ? new Date(`${req.query.from}T00:00:00Z`) : undefined;
    const to = typeof req.query.to === 'string' ? new Date(`${req.query.to}T00:00:00Z`) : undefined;
    const snapshots = await prisma.payrollPeriodSnapshot.findMany({
      where: {
        companyProfileId: authUser.companyProfileId,
        ...(from && !Number.isNaN(from.getTime()) ? { periodFrom: from } : {}),
        ...(to && !Number.isNaN(to.getTime()) ? { periodTo: to } : {}),
      },
      orderBy: [{ periodFrom: 'desc' }, { employeeEmail: 'asc' }],
    });
    res.json({ snapshots });
  } catch (err) {
    logger.error('[reports] Payroll snapshot read error:', err);
    internalError(res, 'fetching payroll snapshots');
  }
});

// ── GET /attendance — attendance summary for a date range ──
router.get('/attendance', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!from || !to) {
      return badRequest(res, 'Query params "from" and "to" (YYYY-MM-DD) are required.');
    }

    const tenantWhere =
      authUser.role === 'master'
        ? {}
        : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    let identityFilter: Record<string, unknown> = {};
    if (authUser.role === 'employee') {
      const employee = await prisma.employee.findFirst({
        where: {
          companyProfileId: authUser.companyProfileId ?? undefined,
          email: { equals: authUser.email, mode: 'insensitive' },
        },
        select: { id: true, email: true },
      });
      identityFilter = employee ? employeeIdentityFilter([employee]) : { employeeId: '__none__' };
    }

    const entries = await prisma.timeEntry.findMany({
      where: {
        ...tenantWhere,
        ...identityFilter,
        date: { gte: new Date(from + 'T00:00:00Z'), lte: new Date(to + 'T23:59:59.999Z') },
      },
      orderBy: { clockIn: 'desc' },
      include: { employee: { select: { firstName: true, surname: true } } },
    });

    res.json({ entries });
  } catch (err) {
    logger.error('[reports] Attendance error:', err);
    internalError(res, 'generating attendance report');
  }
});

export default router;
