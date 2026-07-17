import { useState } from "react";
import { client } from "@/api/Client";
import { useQuery } from "@tanstack/react-query";
import moment from "moment";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { Download, Calendar, Users, Clock, TrendingUp, ShieldAlert } from "lucide-react";
import PayrollExportDialog from "@/components/reports/PayrollExportDialog";
import { calculateOvertime } from "@/utils/overtimeCalculator";
import { useUserRole } from "@/hooks/useUserRole";

const COLORS = [
  "hsl(245, 58%, 51%)",
  "hsl(168, 56%, 45%)",
  "hsl(30, 80%, 55%)",
  "hsl(340, 65%, 55%)",
  "hsl(200, 70%, 50%)",
];

export default function Reports() {
  const { user, canManage } = useUserRole();
  const [period, setPeriod] = useState("month");
  const [viewMode, setViewMode] = useState("personal");
  const [showExport, setShowExport] = useState(false);

  const { data: entries = [] } = useQuery({
    queryKey: ["timeEntries"],
    queryFn: () => client.entities.TimeEntry.list("-date", 500),
  });

  const { data: companySettingsList = [] } = useQuery({
    queryKey: ["companySettings"],
    queryFn: () => client.entities.CompanySettings.list(),
  });

  if (!canManage) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        </div>
        <div className="bg-card rounded-2xl border border-border p-8 text-center max-w-md mx-auto">
          <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto mb-3">
            <ShieldAlert className="w-6 h-6 text-destructive" />
          </div>
          <p className="text-sm font-medium">Manager access required</p>
          <p className="text-xs text-muted-foreground mt-1">
            Reports are available to admins and managers only. Contact your manager if you need a report.
          </p>
        </div>
      </div>
    );
  }

  const companySettings = companySettingsList[0];
  const isAdmin = canManage;
  const filteredEntries =
    viewMode === "personal"
      ? entries.filter((e) => e.employee_email === user?.email && e.status !== "clocked_in")
      : entries.filter((e) => e.status !== "clocked_in");

  // Period range
  const now = moment();
  let rangeStart;
  if (period === "week") rangeStart = now.clone().startOf("isoWeek");
  else if (period === "month") rangeStart = now.clone().startOf("month");
  else rangeStart = now.clone().startOf("year");

  const periodEntries = filteredEntries.filter((e) => e.date >= rangeStart.format("YYYY-MM-DD"));

  // ===== Daily Hours Chart =====
  const dailyData = [];
  const daysInRange = period === "week" ? 7 : period === "month" ? now.daysInMonth() : 12;

  if (period === "year") {
    for (let i = 0; i < 12; i++) {
      const monthStart = now.clone().startOf("year").add(i, "months");
      const monthEnd = monthStart.clone().endOf("month");
      const monthEntries = periodEntries.filter(
        (e) => e.date >= monthStart.format("YYYY-MM-DD") && e.date <= monthEnd.format("YYYY-MM-DD")
      );
      const hours = monthEntries.reduce((s, e) => s + (e.total_hours || 0), 0);
      dailyData.push({ label: monthStart.format("MMM"), hours: parseFloat(hours.toFixed(1)) });
    }
  } else {
    for (let i = 0; i < daysInRange; i++) {
      const day = rangeStart.clone().add(i, "days");
      const dayStr = day.format("YYYY-MM-DD");
      const dayEntries = periodEntries.filter((e) => e.date === dayStr);
      const hours = dayEntries.reduce((s, e) => s + (e.total_hours || 0), 0);
      dailyData.push({
        label: period === "week" ? day.format("ddd") : day.format("D"),
        hours: parseFloat(hours.toFixed(1)),
      });
    }
  }

  // ===== Summary Stats =====
  const totalHours = periodEntries.reduce((s, e) => s + (e.total_hours || 0), 0);
  const totalDays = new Set(periodEntries.map((e) => e.date)).size;
  const avgPerDay = totalDays > 0 ? totalHours / totalDays : 0;
  const otStats = calculateOvertime(periodEntries, {
    overtime_threshold_hours: companySettings?.overtime_threshold_hours ?? 8,
    use_monthly_overtime_threshold: companySettings?.use_monthly_overtime_threshold ?? false,
    monthly_overtime_threshold_hours: companySettings?.monthly_overtime_threshold_hours ?? 195,
    sunday_overtime_enabled: companySettings?.sunday_overtime_enabled ?? true,
    sunday_overtime_multiplier: companySettings?.sunday_overtime_multiplier ?? 1.5,
    public_holiday_overtime_enabled: companySettings?.public_holiday_overtime_enabled ?? true,
    public_holiday_overtime_multiplier: companySettings?.public_holiday_overtime_multiplier ?? 2.0,
    public_holidays: companySettings?.public_holidays ?? [],
  });

  // ===== Day of Week Distribution =====
  const dowData = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, idx) => {
    const dayEntries = periodEntries.filter((e) => moment(e.date).isoWeekday() === idx + 1);
    return {
      day,
      hours: parseFloat(dayEntries.reduce((s, e) => s + (e.total_hours || 0), 0).toFixed(1)),
    };
  });

  // ===== Team breakdown (admin) =====
  const teamData = [];
  if (viewMode === "team") {
    const byEmployee = {};
    periodEntries.forEach((e) => {
      const name = e.employee_name || e.employee_email;
      byEmployee[name] = (byEmployee[name] || 0) + (e.total_hours || 0);
    });
    Object.entries(byEmployee)
      .sort(([, a], [, b]) => b - a)
      .forEach(([name, hours]) => {
        teamData.push({ name, hours: parseFloat(hours.toFixed(1)) });
      });
  }

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground text-sm mt-1">Analyze your attendance data</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {isAdmin && (
            <Tabs value={viewMode} onValueChange={setViewMode}>
              <TabsList className="bg-secondary">
                <TabsTrigger value="personal">My Data</TabsTrigger>
                <TabsTrigger value="team">Team</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
            </SelectContent>
          </Select>
          {isAdmin && (
            <Button onClick={() => setShowExport(true)} variant="outline" className="rounded-xl">
              <Download className="w-4 h-4 mr-2" />
              Payroll Export
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Hours", value: `${totalHours.toFixed(1)}h`, icon: Clock, color: "bg-accent text-accent-foreground" },
          { label: "Days Worked", value: totalDays, icon: Calendar, color: "bg-chart-2/10 text-chart-2" },
          { label: "Avg per Day", value: `${avgPerDay.toFixed(1)}h`, icon: TrendingUp, color: "bg-chart-3/10 text-chart-3" },
          { label: "Overtime Hours", value: `${otStats.totalOvertimeHours}h`, icon: Users, color: "bg-chart-4/10 text-chart-4" },
        ].map((stat) => (
          <div key={stat.label} className="bg-card rounded-2xl border border-border p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold mt-1">{stat.value}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Hours Chart */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <h3 className="text-base font-semibold mb-6">
          {period === "year" ? "Monthly" : "Daily"} Hours
        </h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                unit="h"
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}h`, "Hours"]} />
              <Bar dataKey="hours" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Day of Week */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <h3 className="text-base font-semibold mb-6">Hours by Day of Week</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dowData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  unit="h"
                />
                <YAxis
                  type="category"
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  width={40}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}h`, "Hours"]} />
                <Bar dataKey="hours" fill="hsl(var(--chart-2))" radius={[0, 6, 6, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Team or Trend */}
        {viewMode === "team" && teamData.length > 0 ? (
          <div className="bg-card rounded-2xl border border-border p-6">
            <h3 className="text-base font-semibold mb-6">Team Hours</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={teamData}
                    dataKey="hours"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={50}
                    paddingAngle={3}
                    label={({ name, hours }) => `${name.split(" ")[0]} (${hours}h)`}
                  >
                    {teamData.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}h`, "Hours"]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="bg-card rounded-2xl border border-border p-6">
            <h3 className="text-base font-semibold mb-6">Hours Trend</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    unit="h"
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}h`, "Hours"]} />
                  <Line
                    type="monotone"
                    dataKey="hours"
                    stroke="hsl(var(--chart-4))"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "hsl(var(--chart-4))" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
      {showExport && (
        <PayrollExportDialog
          open={showExport}
          onClose={() => setShowExport(false)}
          entries={entries}
          companySettings={companySettings}
        />
      )}
    </div>
  );
}