/**
 * Reports Routes
 * --------------
 * Payroll/overtime reporting using the Decimal-precision payroll engine.
 */

import { Router } from 'express';
import prisma from '../prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { getManagerScopeFilter } from '../middleware/scope.js';
import { computeOvertime, defaultSettings, type PayrollSettings } from '../payroll.js';
import { badRequest, internalError } from '../errorResponse.js';

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
    const from = (req.query.from as string) || toDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const to = (req.query.to as string) || toDateStr(new Date());
    const branch = req.query.branch as string;
    const department = req.query.department as string;

    const tenantWhere =
      authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };

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

    const fromDate = new Date(from + 'T00:00:00');
    const toDate = new Date(to + 'T00:00:00');

    // Fetch all completed time entries in range for these employees
    const emails = employees.map((e) => e.email);
    const entries = await prisma.timeEntry.findMany({
      where: {
        ...tenantWhere,
        employeeEmail: { in: emails },
        date: { gte: fromDate, lte: toDate },
        status: 'completed',
      },
      select: { employeeEmail: true, date: true, totalHours: true },
    });

    // Fetch shifts in range for leave-type exclusion
    const shifts = await prisma.shift.findMany({
      where: {
        ...tenantWhere,
        employeeEmail: { in: emails },
        date: { gte: fromDate, lte: toDate },
      },
      select: { employeeEmail: true, date: true, shiftType: true },
    });

    const settings = await getPayrollSettings(authUser.companyProfileId);

    // Group entries by employee+date
    const hoursByEmailDate: Record<string, Record<string, number>> = {};
    for (const e of entries) {
      const key = e.employeeEmail;
      const dateKey = toDateStr(e.date);
      if (!hoursByEmailDate[key]) hoursByEmailDate[key] = {};
      hoursByEmailDate[key][dateKey] = (hoursByEmailDate[key][dateKey] ?? 0) + (e.totalHours ?? 0);
    }

    const shiftTypeByEmailDate: Record<string, Record<string, string>> = {};
    for (const s of shifts) {
      if (!s.employeeEmail) continue;
      const key = s.employeeEmail;
      const dateKey = toDateStr(s.date);
      if (!shiftTypeByEmailDate[key]) shiftTypeByEmailDate[key] = {};
      shiftTypeByEmailDate[key][dateKey] = s.shiftType;
    }

    const rows = employees.map((emp) => {
      const byDate = hoursByEmailDate[emp.email] ?? {};
      const shiftTypes = shiftTypeByEmailDate[emp.email] ?? {};
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
    console.error('[reports] Payroll error:', err);
    internalError(res, 'generating payroll report');
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
      authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    const emailFilter = authUser.role === 'employee' ? { employeeEmail: authUser.email } : {};

    const entries = await prisma.timeEntry.findMany({
      where: {
        ...tenantWhere,
        ...emailFilter,
        date: { gte: new Date(from + 'T00:00:00'), lte: new Date(to + 'T00:00:00') },
      },
      orderBy: { clockIn: 'desc' },
      include: { employee: { select: { firstName: true, surname: true } } },
    });

    res.json({ entries });
  } catch (err) {
    console.error('[reports] Attendance error:', err);
    internalError(res, 'generating attendance report');
  }
});

export default router;