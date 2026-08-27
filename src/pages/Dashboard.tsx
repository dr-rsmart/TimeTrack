/**
 * Dashboard Page
 * --------------
 * Persona-tailored dashboard:
 * - Master: Platform control center (multi-tenant overview)
 * - Employee: Personal greeting + SelfClockWidget + auto-geofence status
 * - Admin/Manager: Team KPIs, attendance metrics, shift status, charts
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  Clock,
  Timer,
  CalendarCheck,
  Activity,
  Sparkles,
  Briefcase,
  Building,
  UserCheck,
  UserX,
  LayoutGrid,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import { toast } from 'sonner';
import {
  dashboardApi,
  type DashboardSummary,
  type DepartmentPerformance,
  type AttendanceTrendPoint,
  type OvertimeAlert,
  type OvertimeForecastPoint,
  type OvertimeForecastSummary,
} from '../services/api';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatCard,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  EmptyState,
  Progress,
} from '../components/ui';
import { useSSE } from '../hooks/useSSE';
import { useAuth } from '../context/AuthContext';
import { formatTime, formatDate } from '../lib/utils';
import SelfClockWidget from '../components/dashboard/SelfClockWidget';
import MasterDashboardView from '../components/dashboard/MasterDashboardView';
import AttendanceDetailModal from '../components/dashboard/AttendanceDetailModal';

const PIE_COLORS = ['#005DEC', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export default function Dashboard() {
  const { user, isMaster, isEmployee } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trend, setTrend] = useState<{ date: string; hours: number }[]>([]);
  const [distribution, setDistribution] = useState<{ branch: string; count: number }[]>([]);
  const [departmentDistribution, setDepartmentDistribution] = useState<{ department: string; count: number }[]>([]);
  const [departmentPerformance, setDepartmentPerformance] = useState<DepartmentPerformance[]>([]);
  const [activity, setActivity] = useState<Array<Record<string, unknown>>>([]);
  const [attendanceTrend, setAttendanceTrend] = useState<AttendanceTrendPoint[]>([]);
  const [overtimeAlerts, setOvertimeAlerts] = useState<OvertimeAlert[]>([]);
  const [overtimeForecast, setOvertimeForecast] = useState<OvertimeForecastPoint[]>([]);
  const [overtimeSummary, setOvertimeSummary] = useState<OvertimeForecastSummary | null>(null);
  const [loading, setLoading] = useState(true);
  // KPI drill-down modal: shows who is clocked in vs not.
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async () => {
    if (isMaster) {
      setLoading(false);
      return;
    }
    try {
      const [s, t, d, dd, dp, a, at, oa, of] = await Promise.all([
        dashboardApi.summary(),
        dashboardApi.hoursTrend(14),
        dashboardApi.branchDistribution(),
        dashboardApi.departmentDistribution(),
        dashboardApi.departmentPerformance(),
        dashboardApi.recentActivity(10),
        dashboardApi.attendanceTrend(14),
        dashboardApi.overtimeAlerts(7),
        dashboardApi.overtimeForecast(),
      ]);
      setSummary(s);
      setTrend(t.trend);
      setDistribution(d.distribution);
      setDepartmentDistribution(dd.distribution);
      setDepartmentPerformance(dp.departments);
      setActivity(a.activity);
      setAttendanceTrend(at.trend);
      setOvertimeAlerts(oa.alerts);
      setOvertimeForecast(of.forecast);
      setOvertimeSummary(of.summary);
    } catch (err) {
      toast.error('Failed to load dashboard');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [isMaster]);

  useEffect(() => {
    load();
  }, [load]);

  // Live refresh on SSE events
  useSSE(
    useCallback(
      (event) => {
        if (event.type === 'entity_event' && ['TimeEntry', 'Shift', 'Employee'].includes(event.entity ?? '')) {
          load();
        }
      },
      [load],
    ),
  );

  // ── Master: Platform Control Center ──
  if (isMaster) {
    return <MasterDashboardView />;
  }

  // ── Employee: Personal Dashboard ──
  if (isEmployee && user) {
    const firstName = user.fullName?.split(' ')[0] || 'User';
    return (
      <div className="space-y-6">
        {/* Greeting Banner */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden bg-gradient-to-br from-card via-card to-accent/20 border border-border/40 rounded-3xl p-6 sm:p-8 shadow-card"
        >
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-brand via-brand/90 to-brand-light" />
          <div className="absolute top-0 right-0 w-64 h-64 bg-brand/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl pointer-events-none" />

          <div className="space-y-3 relative z-10">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground">
                System Active
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2">
              {getGreeting()}, <span className="text-brand">{firstName}</span>!
              <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-500 animate-pulse shrink-0" />
            </h1>

            {/* Identity chips */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
              {user.position && (
                <span className="inline-flex items-center gap-1 bg-secondary/50 px-2.5 py-1 rounded-lg border border-border/30">
                  <Briefcase className="w-3 h-3 text-brand" />
                  {user.position}
                </span>
              )}
              {user.employeeNumber && (
                <span className="inline-flex items-center gap-1 bg-secondary/50 px-2.5 py-1 rounded-lg border border-border/30">
                  <span className="text-brand font-bold text-[10px]">ID</span>
                  {user.employeeNumber}
                </span>
              )}
              {(user.department || user.branch) && (
                <span className="inline-flex items-center gap-1 bg-secondary/50 px-2.5 py-1 rounded-lg border border-border/30">
                  <Building className="w-3 h-3 text-brand" />
                  {user.department}
                  {user.branch ? ` (${user.branch})` : ''}
                </span>
              )}
            </div>
          </div>

          <p className="text-muted-foreground text-sm max-w-xl mt-4 relative z-10">
            Track your shifts, monitor your hours, and stay on top of your schedule.
          </p>
        </motion.div>

        {/* Personal Clock + Today's Activity (single consolidated widget) */}
        <div className="grid gap-6 lg:grid-cols-2">
          <SelfClockWidget userEmail={user.email} showClock showHistory />
        </div>
      </div>
    );
  }

  // ── Admin/Manager: Team Dashboard ──
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const attendanceRate = summary?.attendanceRate ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Team Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back, {user?.fullName} · {formatDate(new Date())}
        </p>
      </div>

      {/* KPI cards — Clocked In Now drills down into per-employee details */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
          <StatCard label="Total Employees" value={summary?.totalEmployees ?? 0} icon={<Users className="h-6 w-6" />} />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <StatCard
            label="Clocked In Now"
            value={summary?.activeClockIns ?? 0}
            sub={`of ${summary?.totalEmployees ?? 0} expected`}
            icon={<Clock className="h-6 w-6" />}
            onClick={() => setDetailOpen(true)}
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <StatCard label="Hours Today" value={`${(summary?.totalHoursToday ?? 0).toFixed(1)}h`} icon={<Timer className="h-6 w-6" />} />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <StatCard label="Attendance Rate" value={`${attendanceRate}%`} icon={<CalendarCheck className="h-6 w-6" />} />
        </motion.div>
      </div>

      {/* Attendance progress + shift status */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Attendance Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-emerald-600">
                <UserCheck className="w-4 h-4" /> Present
              </span>
              <span className="font-bold">{summary?.activeClockIns ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <UserX className="w-4 h-4" /> Not clocked in
              </span>
              <span className="font-bold">
                {(summary?.totalEmployees ?? 0) - (summary?.activeClockIns ?? 0)}
              </span>
            </div>
            <Progress value={attendanceRate} />
            <p className="text-xs text-muted-foreground">{attendanceRate}% of workforce has clocked in today.</p>
          </CardContent>
        </Card>

        {summary && (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Today's Shift Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <Badge variant="secondary">Scheduled: {summary.shifts.scheduled}</Badge>
                <Badge variant="success">Active: {summary.shifts.active}</Badge>
                <Badge variant="default">Completed: {summary.shifts.completed}</Badge>
                <Badge variant="warning">Cancelled: {summary.shifts.cancelled}</Badge>
                <Badge variant="destructive">No-show: {summary.shifts.no_show}</Badge>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Hours trend */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Hours Worked — Last 14 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="hours" fill="#005DEC" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Branch distribution */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Employees by Branch</CardTitle>
          </CardHeader>
          <CardContent>
            {distribution.length === 0 ? (
              <EmptyState message="No branch data available" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart margin={{ top: 24, right: 24, bottom: 8, left: 24 }}>
                  <Pie data={distribution} dataKey="count" nameKey="branch" cx="50%" cy="50%" outerRadius={85} label>
                    {distribution.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Department Performance */}
      {departmentPerformance.length > 0 && (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LayoutGrid className="h-4 h-4 text-brand" /> Department Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Employees</TableHead>
                  <TableHead>Clocked In</TableHead>
                  <TableHead>Hours Today</TableHead>
                  <TableHead>Attendance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departmentPerformance.map((dept) => (
                  <TableRow key={dept.department}>
                    <TableCell className="font-medium">{dept.department}</TableCell>
                    <TableCell>{dept.totalEmployees}</TableCell>
                    <TableCell>{dept.clockedIn}</TableCell>
                    <TableCell>{dept.hoursToday.toFixed(1)}h</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={dept.attendanceRate} className="w-16" />
                        <span className="text-xs text-muted-foreground">{dept.attendanceRate}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Department Distribution Chart */}
      {departmentDistribution.length > 0 && (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Employees by Department</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart margin={{ top: 24, right: 24, bottom: 8, left: 24 }}>
                <Pie data={departmentDistribution} dataKey="count" nameKey="department" cx="50%" cy="50%" outerRadius={85} label>
                  {departmentDistribution.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Overtime Alerts */}
      {overtimeAlerts.length > 0 && (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 h-4 text-amber-500" /> Overtime Alerts
              <Badge variant="warning">{overtimeAlerts.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {overtimeAlerts.slice(0, 5).map((alert, idx) => (
                <div
                  key={`${alert.employeeEmail}-${alert.type}-${idx}`}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    alert.severity === 'critical'
                      ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900'
                      : 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900'
                  }`}
                >
                  <AlertTriangle
                    className={`h-4 w-4 mt-0.5 shrink-0 ${
                      alert.severity === 'critical' ? 'text-red-500' : 'text-amber-500'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{alert.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {alert.department || 'General'} · {alert.branch || 'Unassigned'} ·{' '}
                      {alert.type === 'daily_overtime' ? 'Daily overtime' : 'Monthly projection'}
                    </p>
                  </div>
                  <Badge variant={alert.severity === 'critical' ? 'destructive' : 'warning'}>
                    {alert.severity}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Predictive Analytics: Attendance Trend + Overtime Forecast */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Attendance Trend */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 h-4 text-brand" /> Attendance Trend — Last 14 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attendanceTrend.length === 0 ? (
              <EmptyState message="No attendance data available" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={attendanceTrend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <YAxis domain={[0, 100]} fontSize={11} stroke="hsl(var(--muted-foreground))" unit="%" />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Line type="monotone" dataKey="attendanceRate" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Attendance %" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Overtime Forecast */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Timer className="h-4 h-4 text-brand" /> Overtime Forecast
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {overtimeSummary && (
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-secondary/50 border border-border/30 text-center">
                  <p className="text-lg font-bold">{overtimeSummary.avgDailyOvertime}h</p>
                  <p className="text-xs text-muted-foreground">Avg Daily OT</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/50 border border-border/30 text-center">
                  <p className="text-lg font-bold">{overtimeSummary.projectedWeeklyOvertime}h</p>
                  <p className="text-xs text-muted-foreground">Projected Weekly</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/50 border border-border/30 text-center">
                  <p className="text-lg font-bold">{overtimeSummary.dailyThreshold}h</p>
                  <p className="text-xs text-muted-foreground">Daily Threshold</p>
                </div>
              </div>
            )}
            {overtimeForecast.length === 0 ? (
              <EmptyState message="No overtime data available" />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={overtimeForecast}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={10} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={10} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="overtimeHours" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Overtime Hours" />
                </BarChart>
              </ResponsiveContainer>
            )}
            <p className="text-xs text-muted-foreground">
              Solid bars show actual overtime; projected values are based on the 7-day average.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 h-4 text-brand" /> Recent Clock Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <EmptyState message="No recent activity" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((a) => (
                  <TableRow key={a.id as string}>
                    <TableCell className="font-medium">{(a.employeeName as string) || (a.employeeEmail as string)}</TableCell>
                    <TableCell>{(a.branch as string) || '—'}</TableCell>
                    <TableCell>{formatDate(a.clockIn as string)}</TableCell>
                    <TableCell>{formatTime(a.clockIn as string)}</TableCell>
                    <TableCell>{a.clockOut ? formatTime(a.clockOut as string) : '—'}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === 'active' ? 'success' : 'secondary'}>{a.status as string}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* KPI drill-down modal */}
      <AttendanceDetailModal open={detailOpen} onClose={() => setDetailOpen(false)} />
    </div>
  );
}