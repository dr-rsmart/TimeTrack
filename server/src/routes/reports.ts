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
  resolveLatePenaltyRate,
  resolveExpectedWindow,
  collapseDayPunches,
} from '../domain/attendanceCost.js';
import {
  getBusinessTimezone,
  businessNow,
  timeStrToMinutes,
  isAbsenceAlertDue,
} from '../timezone.js';
import payrollExportRouter from './payrollExports.js';
import { parseWorkingHoursSchedules, type WorkingHoursSchedule } from '../workingHoursSchedules.js';

const router = Router();

// Spec §4 export audit trail. Its routes declare their own auth middleware
// (this router has no blanket requireAuth), so mounting order is irrelevant.
router.use(payrollExportRouter);

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
        latePenaltyRate: true,
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
          companyProfileId: true,
          geofence: { select: { workingHoursSchedules: true } },
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

    // Company default working hours (fallback when neither a shift nor the
    // clock-in location defines the expected window).
    const companyIds = [
      ...new Set(entries.map((e) => e.companyProfileId).filter((x): x is string => !!x)),
    ];
    const companySettingsRows = companyIds.length
      ? await prisma.companySettings.findMany({
          where: { companyProfileId: { in: companyIds } },
          select: {
            companyProfileId: true,
            defaultWorkingHoursSchedules: true,
            lateGraceMinutes: true,
          },
          orderBy: { updatedAt: 'desc' },
        })
      : [];
    const companySchedulesById = new Map<string, WorkingHoursSchedule[]>();
    const graceByCompany = new Map<string, number>();
    for (const row of companySettingsRows) {
      if (row.companyProfileId && !companySchedulesById.has(row.companyProfileId)) {
        companySchedulesById.set(
          row.companyProfileId,
          parseWorkingHoursSchedules(row.defaultWorkingHoursSchedules),
        );
        graceByCompany.set(row.companyProfileId, row.lateGraceMinutes);
      }
    }

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

    // Group punches per employee+day: lateness is measured on the FIRST
    // clock-in and early-leave on the LAST clock-out, so breaks are never
    // charged as early-out + late-in.
    const entriesByDay = new Map<string, (typeof entries)[number][]>();
    for (const e of entries) {
      const dayKey = `${identityKey(e.employeeId, e.employeeEmail)}|${toDateStr(e.date)}`;
      const list = entriesByDay.get(dayKey);
      if (list) list.push(e);
      else entriesByDay.set(dayKey, [e]);
    }

    for (const [dayKey, dayEntries] of entriesByDay) {
      const span = collapseDayPunches(dayEntries);
      if (!span) continue;
      const e = span.first;
      const key = identityKey(e.employeeId, e.employeeEmail);
      const emp = employeeByKey.get(key);
      if (!emp) continue;
      const dateKey = dayKey.slice(dayKey.lastIndexOf('|') + 1);
      const shift = shiftByKeyDate.get(`${key}|${dateKey}`);
      const penaltyRate = resolveLatePenaltyRate(emp.hourlyRate, emp.latePenaltyRate);

      // Expected window: shift → clock-in location hours → company default.
      const window = resolveExpectedWindow({
        dateStr: dateKey,
        shift: shift
          ? { startTime: shift.startTime, endTime: shift.endTime, shiftType: shift.shiftType }
          : null,
        locationSchedules: parseWorkingHoursSchedules(e.geofence?.workingHoursSchedules),
        companySchedules: e.companyProfileId
          ? (companySchedulesById.get(e.companyProfileId) ?? [])
          : [],
      });

      const clockInBiz = businessNow(tz, span.clockIn);
      const clockOutBiz = span.clockOut ? businessNow(tz, span.clockOut) : null;
      const startMin = timeStrToMinutes(window.start);
      const endMin = timeStrToMinutes(window.end);
      const crossesMidnight = startMin !== null && endMin !== null && endMin <= startMin;
      // A clock-out whose business date is after the entry date rolled past midnight.
      const clockOutNextDay = clockOutBiz !== null && clockOutBiz.dateStr > dateKey;

      const cost = computeAttendanceCost({
        shiftStart: window.start,
        shiftEnd: window.end,
        shiftType: window.shiftType,
        crossesMidnight,
        clockInMinutesOfDay: clockInBiz.minutesOfDay,
        clockOutMinutesOfDay: clockOutBiz ? clockOutBiz.minutesOfDay : null,
        clockOutNextDay,
        graceMinutes: e.companyProfileId ? (graceByCompany.get(e.companyProfileId) ?? 0) : 0,
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
          randLost: computeRandLost(cost.totalLostMinutes, penaltyRate),
        });
      }
    }

    const rows = [...perEmployee.values()].map(({ emp, late, early, days }) => {
      const totalLostMinutes = late + early;
      const regularRate = emp.hourlyRate !== null ? Number(emp.hourlyRate) : null;
      const penaltyRate = resolveLatePenaltyRate(emp.hourlyRate, emp.latePenaltyRate);
      return {
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.surname}`,
        email: emp.email,
        branch: emp.branch,
        department: emp.department,
        position: emp.position,
        employeeNumber: emp.employeeNumber,
        hourlyRate: regularRate,
        latePenaltyRate: penaltyRate,
        lateMinutes: late,
        earlyMinutes: early,
        totalLostMinutes,
        hoursLost: minutesToHours(totalLostMinutes),
        randLost: computeRandLost(totalLostMinutes, penaltyRate),
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
    // Late/early grace comes from the company setting shared with the
    // Cost-of-Late report (CompanySettings.lateGraceMinutes) so the alert feed
    // and the report always agree. The legacy ?grace= query is ignored.
    const graceSettings = authUser.companyProfileId
      ? await prisma.companySettings.findFirst({
          where: { companyProfileId: authUser.companyProfileId },
          orderBy: { updatedAt: 'desc' },
          select: { lateGraceMinutes: true },
        })
      : null;
    const graceMinutes = graceSettings?.lateGraceMinutes ?? 0;
    // No-show alert grace (spec §3: "no clock-in within 10 minutes of shift
    // start"). Distinct from `grace` (late/early tolerance). Clamped 1..120.
    const noShowGrace = Math.min(
      Math.max(parseInt(req.query.noShowGrace as string, 10) || 10, 1),
      120,
    );

    const tz = getBusinessTimezone();
    const tenantWhere =
      authUser.role === 'master'
        ? {}
        : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    let scopeFilter: Record<string, unknown> = {};
    if (authUser.role === 'manager') scopeFilter = await getManagerScopeFilter(authUser);

    const biz = businessNow(tz);
    const todayBiz = biz.dateStr;
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
          // Active entries included so a late arrival alerts immediately
          // (not only after clock-out); early-leave still needs a clock-out.
          status: { in: ['completed', 'active'] },
        },
        select: {
          employeeId: true,
          employeeEmail: true,
          date: true,
          clockIn: true,
          clockOut: true,
          status: true,
          companyProfileId: true,
          geofence: { select: { workingHoursSchedules: true } },
        },
      }),
    ]);

    // Company default schedules — same fallback chain as the Cost-of-Late
    // report (shift → clock-in location hours → company default) so the
    // alert feed and the report can never disagree on the expected window.
    const alertCompanyIds = [
      ...new Set(entries.map((e) => e.companyProfileId).filter((x): x is string => !!x)),
    ];
    const alertCompanySettings = alertCompanyIds.length
      ? await prisma.companySettings.findMany({
          where: { companyProfileId: { in: alertCompanyIds } },
          select: { companyProfileId: true, defaultWorkingHoursSchedules: true },
          orderBy: { updatedAt: 'desc' },
        })
      : [];
    const alertCompanySchedules = new Map<string, WorkingHoursSchedule[]>();
    for (const row of alertCompanySettings) {
      if (row.companyProfileId && !alertCompanySchedules.has(row.companyProfileId)) {
        alertCompanySchedules.set(
          row.companyProfileId,
          parseWorkingHoursSchedules(row.defaultWorkingHoursSchedules),
        );
      }
    }

    // Same day-collapse as the Cost-of-Late report: first clock-in, last
    // clock-out (early-leave only once no session is still open that day).
    const groupedByKeyDate = new Map<string, (typeof entries)[number][]>();
    for (const e of entries) {
      const k = `${identityKey(e.employeeId, e.employeeEmail)}|${toDateStr(e.date)}`;
      const list = groupedByKeyDate.get(k);
      if (list) list.push(e);
      else groupedByKeyDate.set(k, [e]);
    }
    const entriesByKeyDate = new Map<
      string,
      {
        clockIn: Date;
        clockOut: Date | null;
        employeeEmail: string;
        locationSchedules: WorkingHoursSchedule[];
        companySchedules: WorkingHoursSchedule[];
      }
    >();
    for (const [k, list] of groupedByKeyDate) {
      const span = collapseDayPunches(list);
      if (!span) continue;
      const stillOpen = list.some((e) => e.status === 'active');
      entriesByKeyDate.set(k, {
        clockIn: span.clockIn,
        clockOut: stillOpen ? null : span.clockOut,
        employeeEmail: span.first.employeeEmail,
        locationSchedules: parseWorkingHoursSchedules(span.first.geofence?.workingHoursSchedules),
        companySchedules: span.first.companyProfileId
          ? (alertCompanySchedules.get(span.first.companyProfileId) ?? [])
          : [],
      });
    }
    interface Alert {
      id: string;
      type: 'late_clock_in' | 'early_clock_out' | 'no_show' | 'absence' | 'duplicate';
      severity: 'info' | 'warning' | 'critical';
      employeeEmail: string;
      employeeName: string;
      branch: string | null;
      department: string | null;
      date: string;
      message: string;
      minutes?: number;
      /** Set for `duplicate` alerts so the UI can deep-link to the entry. */
      timeEntryId?: string;
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

      if (!entry) {
        // Scheduled to work, not on leave, and no completed entry. Only alert
        // once the no-show grace deadline has passed (audit F4/F5): a shift
        // later today must not surface as an "absence" before it has started.
        const overdue = isAbsenceAlertDue({
          nowDateStr: todayBiz,
          shiftDateStr: dateKey,
          shiftStartMinutes: startMin,
          graceMinutes: noShowGrace,
          nowMinutesOfDay: biz.minutesOfDay,
        });
        if (!overdue) continue;
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
      // Late/early for days WITH an entry are handled in the entry loop below.
    }

    // ── Late clock-in / early clock-out (entry-driven) ──
    // Every worked day is evaluated against the SAME expected window as the
    // Cost-of-Late report: shift → clock-in location hours → company default.
    // Previously this only ran for shift rows and compared against the raw
    // shift.startTime, so an unscheduled day never alerted while a stray/stale
    // shift row (e.g. a 06:00 bulk-created default) produced "180 min late"
    // alerts that the report did not agree with. The message now names the
    // reference used so managers can see WHY an alert fired.
    const shiftByKeyDate = new Map<string, (typeof shifts)[number]>();
    for (const s of shifts) {
      if (!s.employeeEmail || s.status === 'cancelled') continue;
      shiftByKeyDate.set(`${identityKey(s.employeeId, s.employeeEmail)}|${toDateStr(s.date)}`, s);
    }
    const sourceLabel = (src: string, start: string | null): string =>
      src === 'shift'
        ? `scheduled shift ${start}`
        : src === 'location'
          ? `location hours ${start}`
          : `company working hours ${start}`;

    for (const [k, entry] of entriesByKeyDate) {
      const dateKey = k.slice(k.lastIndexOf('|') + 1);
      const shift = shiftByKeyDate.get(k);
      if (shift?.status === 'no_show') continue;
      const window = resolveExpectedWindow({
        dateStr: dateKey,
        shift: shift
          ? { startTime: shift.startTime, endTime: shift.endTime, shiftType: shift.shiftType }
          : null,
        locationSchedules: entry.locationSchedules,
        companySchedules: entry.companySchedules,
      });
      if (window.source === 'none' || !window.start) continue;
      const startMin = timeStrToMinutes(window.start);
      const endMin = timeStrToMinutes(window.end);
      const crossesMidnight = startMin !== null && endMin !== null && endMin <= startMin;
      const clockInBiz = businessNow(tz, entry.clockIn);
      const clockOutBiz = entry.clockOut ? businessNow(tz, entry.clockOut) : null;
      const cost = computeAttendanceCost({
        shiftStart: window.start,
        shiftEnd: window.end,
        shiftType: window.shiftType,
        crossesMidnight,
        clockInMinutesOfDay: clockInBiz.minutesOfDay,
        clockOutMinutesOfDay: clockOutBiz ? clockOutBiz.minutesOfDay : null,
        clockOutNextDay: clockOutBiz !== null && clockOutBiz.dateStr > dateKey,
        graceMinutes,
      });
      const emp = findEmp(entry.employeeEmail);
      const name = emp ? `${emp.firstName} ${emp.surname}` : entry.employeeEmail;
      const scope = { branch: emp?.branch ?? null, department: emp?.department ?? null };
      const idBase = shift?.id ?? `${entry.employeeEmail.toLowerCase()}:${dateKey}`;

      if (cost.lateMinutes > 0) {
        alerts.push({
          id: `late:${idBase}`,
          type: 'late_clock_in',
          severity: cost.lateMinutes >= 30 ? 'warning' : 'info',
          employeeEmail: entry.employeeEmail,
          employeeName: name,
          ...scope,
          date: dateKey,
          minutes: cost.lateMinutes,
          message: `${name} clocked in ${cost.lateMinutes} min late on ${dateKey} (vs ${sourceLabel(window.source, window.start)}).`,
        });
      }
      if (cost.earlyMinutes > 0) {
        alerts.push({
          id: `early:${idBase}`,
          type: 'early_clock_out',
          severity: cost.earlyMinutes >= 30 ? 'warning' : 'info',
          employeeEmail: entry.employeeEmail,
          employeeName: name,
          ...scope,
          date: dateKey,
          minutes: cost.earlyMinutes,
          message: `${name} clocked out ${cost.earlyMinutes} min early on ${dateKey} (vs ${sourceLabel(window.source, window.end)}).`,
        });
      }
    }

    // ── Duplicate punch alerts (spec §3 "Duplicate alert type") ──
    // Driven by ENTRIES, not shifts: a double punch can happen on an unscheduled
    // day, so it must not depend on the shift loop above. Uses the
    // [companyProfileId, isFlaggedDuplicate] index added by migration 23.
    // Includes open (status='active') rows — a duplicated clock-in is exactly
    // the case where the session may still be open.
    const duplicates = await prisma.timeEntry.findMany({
      where: {
        ...tenantWhere,
        ...identityFilter,
        date: { gte: fromDate, lte: toDate },
        isFlaggedDuplicate: true,
      },
      select: {
        id: true,
        employeeId: true,
        employeeEmail: true,
        employeeName: true,
        date: true,
        clockIn: true,
      },
      orderBy: { date: 'desc' },
      take: 100,
    });

    for (const d of duplicates) {
      const emp = findEmp(d.employeeEmail);
      const name = emp ? `${emp.firstName} ${emp.surname}` : d.employeeName || d.employeeEmail;
      alerts.push({
        id: `duplicate:${d.id}`,
        type: 'duplicate',
        severity: 'warning',
        employeeEmail: d.employeeEmail,
        employeeName: name,
        branch: emp?.branch ?? null,
        department: emp?.department ?? null,
        date: toDateStr(d.date),
        timeEntryId: d.id,
        message: `${name} has a possible duplicate punch on ${toDateStr(d.date)} that needs review.`,
      });
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
