/**
 * Dashboard Routes
 * ----------------
 * KPI aggregation endpoints with tenant + role scoping.
 */

import { Router } from 'express';
import prisma from '../prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { getManagerScopeFilter } from '../middleware/scope.js';
import { internalError } from '../errorResponse.js';

const router = Router();

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── GET /summary ──
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const todayStr = toDateStr(new Date());
    const today = new Date(todayStr + 'T00:00:00');

    const tenantWhere =
      authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    // Build employee scope
    let employeeWhere: Record<string, unknown> = { ...tenantWhere, status: 'active' };
    if (authUser.role === 'manager') {
      const scopeFilter = await getManagerScopeFilter(authUser);
      employeeWhere = { ...employeeWhere, ...scopeFilter };
    } else if (authUser.role === 'employee') {
      employeeWhere = { ...employeeWhere, email: authUser.email };
    }

    const utcNoonDate = new Date(todayStr + 'T12:00:00Z');

    const [totalEmployees, activeClockIns, todayShifts, todayEntries, presentToday] = await Promise.all([
      prisma.employee.count({ where: employeeWhere }),
      prisma.timeEntry.count({
        where: { ...tenantWhere, status: 'active' },
      }),
      prisma.shift.findMany({
        where: { ...tenantWhere, date: { in: [today, utcNoonDate] } },
        select: { status: true },
      }),
      prisma.timeEntry.findMany({
        where: { ...tenantWhere, status: 'completed', date: { in: [today, utcNoonDate] } },
        select: { totalHours: true },
      }),
      // Unique employees with any time entry today (active or completed)
      prisma.timeEntry.findMany({
        where: { ...tenantWhere, date: { in: [today, utcNoonDate] } },
        select: { employeeEmail: true },
        distinct: ['employeeEmail'],
      }),
    ]);

    const shiftCounts = { scheduled: 0, active: 0, completed: 0, cancelled: 0, no_show: 0 };
    for (const s of todayShifts) {
      if (s.status in shiftCounts) shiftCounts[s.status as keyof typeof shiftCounts]++;
    }

    const totalHoursToday = todayEntries.reduce((sum, e) => sum + (e.totalHours ?? 0), 0);

    // Attendance rate: unique employees who clocked in today / active employees.
    // (Raw entry counts would exceed 100% when employees have multiple
    // completed entries in a day, e.g. from repeated clock-in/out cycles.)
    const attendanceRate =
      totalEmployees > 0
        ? Math.min(100, Math.round((presentToday.length / totalEmployees) * 100))
        : 0;

    res.json({
      totalEmployees,
      activeClockIns,
      totalHoursToday: Math.round(totalHoursToday * 100) / 100,
      attendanceRate,
      shifts: shiftCounts,
      date: todayStr,
    });
  } catch (err) {
    console.error('[dashboard] Summary error:', err);
    internalError(res, 'loading dashboard summary');
  }
});

// ── GET /hours-trend (last N days) ──
router.get('/hours-trend', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const days = Math.min(parseInt(req.query.days as string, 10) || 14, 90);

    const tenantWhere =
      authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    const emailFilter =
      authUser.role === 'employee' ? { employeeEmail: authUser.email } : {};

    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const entries = await prisma.timeEntry.findMany({
      where: { ...tenantWhere, ...emailFilter, date: { gte: since }, status: 'completed' },
      select: { date: true, totalHours: true },
    });

    // Aggregate by date
    const byDate: Record<string, number> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      byDate[toDateStr(d)] = 0;
    }
    for (const e of entries) {
      const key = toDateStr(e.date);
      if (key in byDate) byDate[key] += e.totalHours ?? 0;
    }

    const trend = Object.entries(byDate).map(([date, hours]) => ({
      date,
      hours: Math.round(hours * 100) / 100,
    }));

    res.json({ trend });
  } catch (err) {
    console.error('[dashboard] Trend error:', err);
    internalError(res, 'loading hours trend');
  }
});

// ── GET /branch-distribution ──
router.get('/branch-distribution', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    if (authUser.role === 'employee') {
      return res.json({ distribution: [] });
    }

    const tenantWhere =
      authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    const employees = await prisma.employee.groupBy({
      by: ['branch'],
      where: { ...tenantWhere, status: 'active' },
      _count: { id: true },
    });

    res.json({
      distribution: employees.map((e) => ({ branch: e.branch, count: e._count.id })),
    });
  } catch (err) {
    console.error('[dashboard] Branch distribution error:', err);
    internalError(res, 'loading branch distribution');
  }
});

// ── GET /department-distribution ──
router.get('/department-distribution', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    if (authUser.role === 'employee') {
      return res.json({ distribution: [] });
    }

    const tenantWhere =
      authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    // Apply manager scope filter for department distribution
    let employeeWhere: Record<string, unknown> = { ...tenantWhere, status: 'active' };
    if (authUser.role === 'manager') {
      const scopeFilter = await getManagerScopeFilter(authUser);
      employeeWhere = { ...employeeWhere, ...scopeFilter };
    }

    const employees = await prisma.employee.groupBy({
      by: ['department'],
      where: employeeWhere,
      _count: { id: true },
    });

    res.json({
      distribution: employees.map((e) => ({ department: e.department, count: e._count.id })),
    });
  } catch (err) {
    console.error('[dashboard] Department distribution error:', err);
    internalError(res, 'loading department distribution');
  }
});

// ── GET /department-performance ──
router.get('/department-performance', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    if (authUser.role === 'employee') {
      return res.json({ departments: [] });
    }

    const todayStr = toDateStr(new Date());
    const today = new Date(todayStr + 'T00:00:00');

    const tenantWhere =
      authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    // Apply manager scope filter
    let employeeWhere: Record<string, unknown> = { ...tenantWhere, status: 'active' };
    if (authUser.role === 'manager') {
      const scopeFilter = await getManagerScopeFilter(authUser);
      employeeWhere = { ...employeeWhere, ...scopeFilter };
    }

    // Get employees grouped by department
    const employees = await prisma.employee.groupBy({
      by: ['department'],
      where: employeeWhere,
      _count: { id: true },
    });

    // Get today's time entries with department info
    const todayEntries = await prisma.timeEntry.findMany({
      where: { ...tenantWhere, date: today },
      select: { department: true, status: true, totalHours: true, employeeEmail: true },
    });

    // Get today's shifts with department info
    const todayShifts = await prisma.shift.findMany({
      where: { ...tenantWhere, date: today },
      select: { department: true, status: true },
    });

    // Build department performance metrics
    const departmentMap: Record<string, {
      department: string;
      totalEmployees: number;
      clockedIn: number;
      hoursToday: number;
      shiftsScheduled: number;
      shiftsCompleted: number;
      attendanceRate: number;
    }> = {};

    // Initialize with employee counts
    for (const emp of employees) {
      departmentMap[emp.department] = {
        department: emp.department,
        totalEmployees: emp._count.id,
        clockedIn: 0,
        hoursToday: 0,
        shiftsScheduled: 0,
        shiftsCompleted: 0,
        attendanceRate: 0,
      };
    }

    // Aggregate time entries by department
    const clockedInByDept: Record<string, Set<string>> = {};
    for (const entry of todayEntries) {
      const dept = entry.department || 'General';
      if (!departmentMap[dept]) {
        departmentMap[dept] = {
          department: dept,
          totalEmployees: 0,
          clockedIn: 0,
          hoursToday: 0,
          shiftsScheduled: 0,
          shiftsCompleted: 0,
          attendanceRate: 0,
        };
      }
      departmentMap[dept].hoursToday += entry.totalHours ?? 0;
      
      // Track unique employees who clocked in
      if (!clockedInByDept[dept]) clockedInByDept[dept] = new Set();
      clockedInByDept[dept].add(entry.employeeEmail);
    }

    // Set clocked in counts
    for (const [dept, emails] of Object.entries(clockedInByDept)) {
      if (departmentMap[dept]) {
        departmentMap[dept].clockedIn = emails.size;
      }
    }

    // Aggregate shifts by department
    for (const shift of todayShifts) {
      const dept = shift.department || 'General';
      if (!departmentMap[dept]) continue;
      if (shift.status === 'scheduled' || shift.status === 'active') {
        departmentMap[dept].shiftsScheduled++;
      } else if (shift.status === 'completed') {
        departmentMap[dept].shiftsCompleted++;
      }
    }

    // Calculate attendance rates
    for (const dept of Object.values(departmentMap)) {
      dept.hoursToday = Math.round(dept.hoursToday * 100) / 100;
      dept.attendanceRate = dept.totalEmployees > 0
        ? Math.round((dept.clockedIn / dept.totalEmployees) * 100)
        : 0;
    }

    res.json({ departments: Object.values(departmentMap) });
  } catch (err) {
    console.error('[dashboard] Department performance error:', err);
    internalError(res, 'loading department performance');
  }
});

// ── GET /recent-activity ──
router.get('/recent-activity', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);

    const tenantWhere =
      authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    const entries = await prisma.timeEntry.findMany({
      where: { ...tenantWhere },
      take: limit,
      orderBy: { clockIn: 'desc' },
      select: {
        id: true,
        employeeName: true,
        employeeEmail: true,
        clockIn: true,
        clockOut: true,
        status: true,
        branch: true,
        department: true,
      },
    });

    res.json({ activity: entries });
  } catch (err) {
    console.error('[dashboard] Recent activity error:', err);
    internalError(res, 'loading recent activity');
  }
});

// ── GET /attendance-trend (historical attendance rate for trend analysis) ──
router.get('/attendance-trend', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    if (authUser.role === 'employee') {
      return res.json({ trend: [] });
    }

    const days = Math.min(parseInt(req.query.days as string, 10) || 14, 90);

    const tenantWhere =
      authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    // Apply manager scope filter via employee emails
    let emailFilter: Record<string, unknown> = {};
    if (authUser.role === 'manager') {
      const scopeFilter = await getManagerScopeFilter(authUser);
      const scopedEmployees = await prisma.employee.findMany({
        where: { ...tenantWhere, status: 'active', ...scopeFilter },
        select: { email: true },
      });
      const emails = scopedEmployees.map((e) => e.email);
      emailFilter = emails.length > 0 ? { employeeEmail: { in: emails } } : { employeeEmail: '__none__' };
    }

    // Active employee count (assumed constant over the period for rate calculation)
    let employeeWhere: Record<string, unknown> = { ...tenantWhere, status: 'active' };
    if (authUser.role === 'manager') {
      const scopeFilter = await getManagerScopeFilter(authUser);
      employeeWhere = { ...employeeWhere, ...scopeFilter };
    }
    const totalEmployees = await prisma.employee.count({ where: employeeWhere });

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    const entries = await prisma.timeEntry.findMany({
      where: { ...tenantWhere, ...emailFilter, date: { gte: since } },
      select: { date: true, employeeEmail: true },
    });

    // Aggregate unique employees per date
    const byDate: Record<string, Set<string>> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      byDate[toDateStr(d)] = new Set();
    }
    for (const e of entries) {
      const key = toDateStr(e.date);
      if (key in byDate) byDate[key].add(e.employeeEmail);
    }

    const trend = Object.entries(byDate).map(([date, emails]) => ({
      date,
      attendanceRate: totalEmployees > 0 ? Math.round((emails.size / totalEmployees) * 100) : 0,
      presentCount: emails.size,
    }));

    res.json({ trend, totalEmployees });
  } catch (err) {
    console.error('[dashboard] Attendance trend error:', err);
    internalError(res, 'loading attendance trend');
  }
});

// ── GET /overtime-alerts (employees exceeding overtime thresholds) ──
router.get('/overtime-alerts', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    if (authUser.role === 'employee') {
      return res.json({ alerts: [] });
    }

    const days = Math.min(parseInt(req.query.days as string, 10) || 7, 30);

    const tenantWhere =
      authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    // Get company overtime settings
    const settings = await prisma.companySettings.findFirst({
      where: tenantWhere,
    });
    const dailyThreshold = settings?.overtimeThresholdHours ?? 8;
    const monthlyThreshold = settings?.monthlyOvertimeThresholdHours ?? 195;
    const useMonthly = settings?.useMonthlyOvertimeThreshold ?? false;

    // Apply manager scope filter via employee emails
    let emailFilter: Record<string, unknown> = {};
    if (authUser.role === 'manager') {
      const scopeFilter = await getManagerScopeFilter(authUser);
      const scopedEmployees = await prisma.employee.findMany({
        where: { ...tenantWhere, status: 'active', ...scopeFilter },
        select: { email: true },
      });
      const emails = scopedEmployees.map((e) => e.email);
      emailFilter = emails.length > 0 ? { employeeEmail: { in: emails } } : { employeeEmail: '__none__' };
    }

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    const entries = await prisma.timeEntry.findMany({
      where: { ...tenantWhere, ...emailFilter, date: { gte: since }, status: 'completed' },
      select: {
        employeeEmail: true,
        employeeName: true,
        branch: true,
        department: true,
        date: true,
        totalHours: true,
      },
    });

    // Aggregate hours per employee per day and total
    interface EmployeeAgg {
      employeeEmail: string;
      employeeName: string | null;
      branch: string | null;
      department: string | null;
      totalHours: number;
      dailyOvertimeHours: number;
      daysWorked: number;
      overtimeDays: number;
    }
    const aggMap: Record<string, EmployeeAgg> = {};
    for (const e of entries) {
      const hours = e.totalHours ?? 0;
      if (!aggMap[e.employeeEmail]) {
        aggMap[e.employeeEmail] = {
          employeeEmail: e.employeeEmail,
          employeeName: e.employeeName,
          branch: e.branch,
          department: e.department,
          totalHours: 0,
          dailyOvertimeHours: 0,
          daysWorked: 0,
          overtimeDays: 0,
        };
      }
      const agg = aggMap[e.employeeEmail];
      agg.totalHours += hours;
      agg.daysWorked++;
      if (hours > dailyThreshold) {
        agg.dailyOvertimeHours += hours - dailyThreshold;
        agg.overtimeDays++;
      }
    }

    // Build alerts for employees exceeding thresholds
    const alerts: Array<{
      employeeEmail: string;
      employeeName: string | null;
      branch: string | null;
      department: string | null;
      type: 'daily_overtime' | 'monthly_projection';
      severity: 'warning' | 'critical';
      totalHours: number;
      overtimeHours: number;
      threshold: number;
      message: string;
    }> = [];

    for (const agg of Object.values(aggMap)) {
      agg.totalHours = Math.round(agg.totalHours * 100) / 100;
      agg.dailyOvertimeHours = Math.round(agg.dailyOvertimeHours * 100) / 100;

      // Daily overtime alert: employee had multiple overtime days in the period
      if (agg.overtimeDays >= 2) {
        alerts.push({
          employeeEmail: agg.employeeEmail,
          employeeName: agg.employeeName,
          branch: agg.branch,
          department: agg.department,
          type: 'daily_overtime',
          severity: agg.overtimeDays >= 4 ? 'critical' : 'warning',
          totalHours: agg.totalHours,
          overtimeHours: agg.dailyOvertimeHours,
          threshold: dailyThreshold,
          message: `${agg.employeeName || agg.employeeEmail} exceeded ${dailyThreshold}h on ${agg.overtimeDays} day(s) in the last ${days} days (${agg.dailyOvertimeHours}h overtime).`,
        });
      }

      // Monthly projection alert: extrapolate current pace to monthly total
      if (useMonthly && agg.daysWorked > 0) {
        const avgHoursPerDay = agg.totalHours / agg.daysWorked;
        // Assume ~21.67 working days per month
        const projectedMonthly = avgHoursPerDay * 21.67;
        if (projectedMonthly > monthlyThreshold) {
          alerts.push({
            employeeEmail: agg.employeeEmail,
            employeeName: agg.employeeName,
            branch: agg.branch,
            department: agg.department,
            type: 'monthly_projection',
            severity: projectedMonthly > monthlyThreshold * 1.15 ? 'critical' : 'warning',
            totalHours: agg.totalHours,
            overtimeHours: Math.round((projectedMonthly - monthlyThreshold) * 100) / 100,
            threshold: monthlyThreshold,
            message: `${agg.employeeName || agg.employeeEmail} is projected to reach ${projectedMonthly.toFixed(1)}h this month (threshold: ${monthlyThreshold}h).`,
          });
        }
      }
    }

    // Sort by severity (critical first), then overtime hours desc
    alerts.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return b.overtimeHours - a.overtimeHours;
    });

    res.json({
      alerts: alerts.slice(0, 50),
      thresholds: { daily: dailyThreshold, monthly: monthlyThreshold, useMonthly },
      periodDays: days,
    });
  } catch (err) {
    console.error('[dashboard] Overtime alerts error:', err);
    internalError(res, 'loading overtime alerts');
  }
});

// ── GET /overtime-forecast (projected overtime for current period) ──
router.get('/overtime-forecast', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    if (authUser.role === 'employee') {
      return res.json({ forecast: [] });
    }

    const tenantWhere =
      authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    const settings = await prisma.companySettings.findFirst({
      where: tenantWhere,
    });
    const dailyThreshold = settings?.overtimeThresholdHours ?? 8;

    // Apply manager scope filter via employee emails
    let emailFilter: Record<string, unknown> = {};
    if (authUser.role === 'manager') {
      const scopeFilter = await getManagerScopeFilter(authUser);
      const scopedEmployees = await prisma.employee.findMany({
        where: { ...tenantWhere, status: 'active', ...scopeFilter },
        select: { email: true },
      });
      const emails = scopedEmployees.map((e) => e.email);
      emailFilter = emails.length > 0 ? { employeeEmail: { in: emails } } : { employeeEmail: '__none__' };
    }

    // Last 7 days of data for forecasting
    const since = new Date();
    since.setDate(since.getDate() - 6);
    since.setHours(0, 0, 0, 0);

    const entries = await prisma.timeEntry.findMany({
      where: { ...tenantWhere, ...emailFilter, date: { gte: since }, status: 'completed' },
      select: { date: true, totalHours: true, employeeEmail: true },
    });

    // Daily totals and overtime
    const byDate: Record<string, { totalHours: number; overtimeHours: number; employees: Set<string> }> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      byDate[toDateStr(d)] = { totalHours: 0, overtimeHours: 0, employees: new Set() };
    }

    // Track per-employee per-day hours for overtime calculation
    const perEmployeeDay: Record<string, Record<string, number>> = {};
    for (const e of entries) {
      const key = toDateStr(e.date);
      if (!(key in byDate)) continue;
      byDate[key].totalHours += e.totalHours ?? 0;
      byDate[key].employees.add(e.employeeEmail);
      if (!perEmployeeDay[key]) perEmployeeDay[key] = {};
      perEmployeeDay[key][e.employeeEmail] = (perEmployeeDay[key][e.employeeEmail] ?? 0) + (e.totalHours ?? 0);
    }

    // Calculate overtime per day
    for (const [date, data] of Object.entries(byDate)) {
      const dayEmployees = perEmployeeDay[date] ?? {};
      for (const hours of Object.values(dayEmployees)) {
        if (hours > dailyThreshold) {
          data.overtimeHours += hours - dailyThreshold;
        }
      }
    }

    // Simple linear forecast: average of last 7 days projected forward
    const daysWithData = Object.values(byDate).filter((d) => d.employees.size > 0);
    const avgOvertime = daysWithData.length > 0
      ? daysWithData.reduce((s, d) => s + d.overtimeHours, 0) / daysWithData.length
      : 0;
    const avgTotalHours = daysWithData.length > 0
      ? daysWithData.reduce((s, d) => s + d.totalHours, 0) / daysWithData.length
      : 0;

    const forecast = Object.entries(byDate).map(([date, data]) => ({
      date,
      totalHours: Math.round(data.totalHours * 100) / 100,
      overtimeHours: Math.round(data.overtimeHours * 100) / 100,
      employeeCount: data.employees.size,
      isProjected: false,
    }));

    // Add 7-day projection
    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      forecast.push({
        date: toDateStr(d),
        totalHours: Math.round(avgTotalHours * 100) / 100,
        overtimeHours: Math.round(avgOvertime * 100) / 100,
        employeeCount: 0,
        isProjected: true,
      });
    }

    res.json({
      forecast,
      summary: {
        avgDailyOvertime: Math.round(avgOvertime * 100) / 100,
        avgDailyHours: Math.round(avgTotalHours * 100) / 100,
        projectedWeeklyOvertime: Math.round(avgOvertime * 7 * 100) / 100,
        dailyThreshold,
      },
    });
  } catch (err) {
    console.error('[dashboard] Overtime forecast error:', err);
    internalError(res, 'loading overtime forecast');
  }
});

export default router;
