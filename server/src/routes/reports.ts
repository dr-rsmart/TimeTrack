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
import {
  computeAttendanceCost,
  computeRandLost,
  minutesToHours,
} from '../domain/attendanceCost.js';
import { getBusinessTimezone, businessNow, timeStrToMinutes } from '../timezone.js';

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
    saturdayOvertimeEnabled: settings.saturdayOvertimeEnabled,
    saturdayOvertimeMultiplier: settings.saturdayOvertimeMultiplier,
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
        hourlyRate: true,
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
        hourlyRate: emp.hourlyRate !== null ? Number(emp.hourlyRate) : null,
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

// ── GET /attendance-cost — Cost of Late Coming (hours + Rand lost) ──
// For every completed entry in range, compares the actual clock-in/out against
// the scheduled shift and quantifies minutes lost to lateness/early-leave,
// converting to Rand via each employee's hourly rate. Feature #9.
router.get('/attendance-cost', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const from = req.query.from as string;
    const to = req.query.to as string;
    const branch = req.query.branch as string;
    const department = req.query.department as string;
    const employeeEmail = req.query.employeeEmail as string;

    if (!from || !to) {
      return badRequest(res, 'Query params "from" and "to" (YYYY-MM-DD) are required.');
    }

    const tz = getBusinessTimezone();
    const tenantWhere =
      authUser.role === 'master'
        ? {}
        : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    let employeeWhere: Record<string, unknown> = { ...tenantWhere };
    if (authUser.role === 'employee') {
      employeeWhere.email = { equals: authUser.email, mode: 'insensitive' };
    } else if (authUser.role === 'manager') {
      employeeWhere = { ...employeeWhere, ...(await getManagerScopeFilter(authUser)) };
    }
    if (branch) employeeWhere.branch = branch;
    if (department) employeeWhere.department = department;
    if (employeeEmail) employeeWhere.email = { equals: employeeEmail, mode: 'insensitive' };

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
        hourlyRate: true,
      },
      orderBy: [{ surname: 'asc' }, { firstName: 'asc' }],
    });

    const fromDate = new Date(from + 'T00:00:00Z');
    const toDate = new Date(to + 'T23:59:59.999Z');
    const identityFilter = employeeIdentityFilter(employees);

    const [entries, shifts] = await Promise.all([
      prisma.timeEntry.findMany({
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
          clockIn: true,
          clockOut: true,
        },
      }),
      prisma.shift.findMany({
        where: { ...tenantWhere, ...identityFilter, date: { gte: fromDate, lte: toDate } },
        select: {
          employeeId: true,
          employeeEmail: true,
          date: true,
          startTime: true,
          endTime: true,
          shiftType: true,
        },
      }),
    ]);

    // Index shifts by identity+date for O(1) lookup against each entry.
    const shiftByKeyDate = new Map<string, (typeof shifts)[number]>();
    for (const s of shifts) {
      if (!s.employeeEmail) continue;
      shiftByKeyDate.set(`${identityKey(s.employeeId, s.employeeEmail)}|${toDateStr(s.date)}`, s);
    }
    const employeeByKey = new Map(employees.map((x) => [identityKey(x.id, x.email), x]));
    interface DayDetail {
      date: string;
      lateMinutes: number;
      earlyMinutes: number;
      randLost: number;
    }
    const perEmployee = new Map<
      string,
      { emp: (typeof employees)[number]; late: number; early: number; days: DayDetail[] }
    >();

    for (const e of entries) {
      const key = identityKey(e.employeeId, e.employeeEmail);
      const emp = employeeByKey.get(key);
      if (!emp) continue;
      const dateKey = toDateStr(e.date);
      const shift = shiftByKeyDate.get(`${key}|${dateKey}`);
      const rate = emp.hourlyRate !== null ? Number(emp.hourlyRate) : null;

      const clockInBiz = businessNow(tz, e.clockIn);
      const clockOutBiz = e.clockOut ? businessNow(tz, e.clockOut) : null;
      const startMin = timeStrToMinutes(shift?.startTime ?? null);
      const endMin = timeStrToMinutes(shift?.endTime ?? null);
      const crossesMidnight = startMin !== null && endMin !== null && endMin <= startMin;
      // A clock-out whose business date is after the entry date rolled past midnight.
      const clockOutNextDay = clockOutBiz !== null && clockOutBiz.dateStr > dateKey;

      const cost = computeAttendanceCost({
        shiftStart: shift?.startTime ?? null,
        shiftEnd: shift?.endTime ?? null,
        shiftType: shift?.shiftType,
        crossesMidnight,
        clockInMinutesOfDay: clockInBiz.minutesOfDay,
        clockOutMinutesOfDay: clockOutBiz ? clockOutBiz.minutesOfDay : null,
        clockOutNextDay,
      });

      let agg = perEmployee.get(key);
      if (!agg) {
        agg = { emp, late: 0, early: 0, days: [] };
        perEmployee.set(key, agg);
      }
      agg.late += cost.lateMinutes;
      agg.early += cost.earlyMinutes;
      if (cost.totalLostMinutes > 0) {
        agg.days.push({
          date: dateKey,
          lateMinutes: cost.lateMinutes,
          earlyMinutes: cost.earlyMinutes,
          randLost: computeRandLost(cost.totalLostMinutes, rate),
        });
      }
    }

    const rows = [...perEmployee.values()].map(({ emp, late, early, days }) => {
      const totalLostMinutes = late + early;
      const rate = emp.hourlyRate !== null ? Number(emp.hourlyRate) : null;
      return {
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.surname}`,
        email: emp.email,
        branch: emp.branch,
        department: emp.department,
        position: emp.position,
        employeeNumber: emp.employeeNumber,
        hourlyRate: rate,
        lateMinutes: late,
        earlyMinutes: early,
        totalLostMinutes,
        hoursLost: minutesToHours(totalLostMinutes),
        randLost: computeRandLost(totalLostMinutes, rate),
        days: days.sort((a, b) => a.date.localeCompare(b.date)),
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({
        lateMinutes: acc.lateMinutes + r.lateMinutes,
        earlyMinutes: acc.earlyMinutes + r.earlyMinutes,
        hoursLost: parseFloat((acc.hoursLost + r.hoursLost).toFixed(2)),
        randLost: parseFloat((acc.randLost + r.randLost).toFixed(2)),
      }),
      { lateMinutes: 0, earlyMinutes: 0, hoursLost: 0, randLost: 0 },
    );

    res.json({ from, to, currency: 'ZAR', rows, totals });
  } catch (err) {
    logger.error('[reports] Attendance cost error:', err);
    internalError(res, 'generating attendance cost report');
  }
});

// ── GET /attendance-alerts — in-app Notification Centre feed (managers) ──
// Derives actionable alerts (late clock-in, early clock-out, no-show, absence)
// for the manager dashboard notification centre. Feature #3. Read-only, computed
// on demand from shifts + entries; no separate notification service required.
router.get('/attendance-alerts', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    if (!['admin', 'manager', 'master'].includes(authUser.role)) {
      return res.status(403).json({ error: 'Attendance alerts require a manager context.' });
    }
    const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 1, 1), 31);
    const graceMinutes = Math.min(Math.max(parseInt(req.query.grace as string, 10) || 5, 0), 120);

    const tz = getBusinessTimezone();
    const tenantWhere =
      authUser.role === 'master'
        ? {}
        : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    let scopeFilter: Record<string, unknown> = {};
    if (authUser.role === 'manager') scopeFilter = await getManagerScopeFilter(authUser);

    const todayBiz = businessNow(tz).dateStr;
    const fromDate = new Date(todayBiz + 'T00:00:00Z');
    fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
    const toDate = new Date(todayBiz + 'T23:59:59.999Z');

    const employees = await prisma.employee.findMany({
      where: { ...tenantWhere, ...scopeFilter, status: 'active' },
      select: {
        id: true,
        firstName: true,
        surname: true,
        email: true,
        branch: true,
        department: true,
      },
    });
    const identityFilter = employeeIdentityFilter(employees);

    const [shifts, entries] = await Promise.all([
      prisma.shift.findMany({
        where: { ...tenantWhere, ...identityFilter, date: { gte: fromDate, lte: toDate } },
        select: {
          id: true,
          employeeId: true,
          employeeEmail: true,
          employeeName: true,
          date: true,
          startTime: true,
          endTime: true,
          shiftType: true,
          status: true,
        },
      }),
      prisma.timeEntry.findMany({
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
          clockIn: true,
          clockOut: true,
        },
      }),
    ]);

    const entriesByKeyDate = new Map<string, (typeof entries)[number]>();
    for (const e of entries) {
      entriesByKeyDate.set(`${identityKey(e.employeeId, e.employeeEmail)}|${toDateStr(e.date)}`, e);
    }
    interface Alert {
      id: string;
      type: 'late_clock_in' | 'early_clock_out' | 'no_show' | 'absence';
      severity: 'info' | 'warning' | 'critical';
      employeeEmail: string;
      employeeName: string;
      branch: string | null;
      department: string | null;
      date: string;
      message: string;
      minutes?: number;
    }
    const alerts: Alert[] = [];
    const findEmp = (email: string) =>
      employees.find((x) => x.email.toLowerCase() === email.toLowerCase());

    for (const s of shifts) {
      if (!s.employeeEmail) continue;
      const dateKey = toDateStr(s.date);
      const key = `${identityKey(s.employeeId, s.employeeEmail)}|${dateKey}`;
      const entry = entriesByKeyDate.get(key);
      const emp = findEmp(s.employeeEmail);
      const name = emp ? `${emp.firstName} ${emp.surname}` : s.employeeName || s.employeeEmail;
      const scope = { branch: emp?.branch ?? null, department: emp?.department ?? null };
      const isLeave = s.shiftType && !['full_day', 'half_day'].includes(s.shiftType);

      // Explicit no-show status set by the cron grace-deadline job.
      if (s.status === 'no_show') {
        alerts.push({
          id: `no_show:${s.id}`,
          type: 'no_show',
          severity: 'critical',
          employeeEmail: s.employeeEmail,
          employeeName: name,
          ...scope,
          date: dateKey,
          message: `${name} was marked a no-show for the ${dateKey} shift.`,
        });
        continue;
      }
      if (isLeave || s.status === 'cancelled') continue; // approved leave — nothing to alert

      const startMin = timeStrToMinutes(s.startTime);
      const endMin = timeStrToMinutes(s.endTime);

      if (!entry) {
        // Scheduled to work, not on leave, and no completed entry — absence.
        alerts.push({
          id: `absence:${s.id}`,
          type: 'absence',
          severity: 'warning',
          employeeEmail: s.employeeEmail,
          employeeName: name,
          ...scope,
          date: dateKey,
          message: `${name} has no recorded clock-in for the ${dateKey} shift.`,
        });
        continue;
      }

      const clockInBiz = businessNow(tz, entry.clockIn);
      if (startMin !== null && clockInBiz.minutesOfDay > startMin + graceMinutes) {
        const mins = clockInBiz.minutesOfDay - startMin;
        alerts.push({
          id: `late:${s.id}`,
          type: 'late_clock_in',
          severity: mins >= 30 ? 'warning' : 'info',
          employeeEmail: s.employeeEmail,
          employeeName: name,
          ...scope,
          date: dateKey,
          minutes: mins,
          message: `${name} clocked in ${mins} min late on ${dateKey}.`,
        });
      }
      if (endMin !== null && entry.clockOut) {
        const clockOutBiz = businessNow(tz, entry.clockOut);
        const crossesMidnight = startMin !== null && endMin <= startMin;
        const outAxis =
          clockOutBiz.dateStr > dateKey
            ? clockOutBiz.minutesOfDay + 1440
            : clockOutBiz.minutesOfDay;
        const endAxis = crossesMidnight ? endMin + 1440 : endMin;
        if (outAxis < endAxis - graceMinutes) {
          const mins = endAxis - outAxis;
          alerts.push({
            id: `early:${s.id}`,
            type: 'early_clock_out',
            severity: mins >= 30 ? 'warning' : 'info',
            employeeEmail: s.employeeEmail,
            employeeName: name,
            ...scope,
            date: dateKey,
            minutes: mins,
            message: `${name} clocked out ${mins} min early on ${dateKey}.`,
          });
        }
      }
    }

    // Newest first, capped to keep the feed bounded.
    alerts.sort((a, b) => b.date.localeCompare(a.date));
    res.json({
      days,
      graceMinutes,
      today: todayBiz,
      count: alerts.length,
      alerts: alerts.slice(0, 200),
    });
  } catch (err) {
    logger.error('[reports] Attendance alerts error:', err);
    internalError(res, 'generating attendance alerts');
  }
});

export default router;
