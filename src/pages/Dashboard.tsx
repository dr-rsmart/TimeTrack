import moment from "moment";
import { motion } from "framer-motion";
import DashboardKPIs from "@/components/dashboard/DashboardKPIs";
import ActiveStaffCard from "@/components/dashboard/ActiveStaffCard";
import MissingStaffCard from "@/components/dashboard/MissingStaffCard";
import AttendanceBreakdownChart from "@/components/summary/AttendanceBreakdownChart";
import SelfClockWidget from "@/components/dashboard/SelfClockWidget";
import HoursTrendChart from "@/components/dashboard/HoursTrendChart";
import LocationDistributionChart from "@/components/dashboard/LocationDistributionChart";
import { useRealtimeEntity } from "@/hooks/useRealtimeEntity";
import { useUserRole } from "@/hooks/useUserRole";

export default function Dashboard() {
  const { user, canManage } = useUserRole();

  const today = moment().format("YYYY-MM-DD");

  // Realtime subscriptions (equivalent to Firestore onSnapshot — no polling)
  const { data: entries = [] } = useRealtimeEntity("TimeEntry", { sort: "-date", limit: 1000 });
  const { data: shifts = [] } = useRealtimeEntity("Shift", { sort: "-date", limit: 500 });
  const { data: employees = [] } = useRealtimeEntity("Employee", { sort: "-created_date", limit: 500 });

  const { data: companySettingsList = [] } = useRealtimeEntity("CompanySettings", { limit: 10 });
  const overtimeThreshold = companySettingsList[0]?.overtime_threshold_hours ?? 8;

  // Today's data
  const todayEntries = entries.filter((e) => e.date === today);
  const activeEntries = todayEntries.filter((e) => e.status === "clocked_in");
  const completedToday = todayEntries.filter((e) => e.status !== "clocked_in");
  const totalHours = completedToday.reduce((s, e) => s + (e.total_hours || 0), 0);

  // Expected staff
  const todaysShifts = shifts.filter((s) => s.date === today && s.status !== "cancelled");
  const expectedEmails = new Set(todaysShifts.map((s) => s.employee_email));
  if (expectedEmails.size === 0) {
    employees.filter((e) => e.status === "active").forEach((e) => expectedEmails.add(e.email));
  }

  const clockedInEmails = new Set(todayEntries.map((e) => e.employee_email));
  const missingEmails = [...expectedEmails].filter((email) => !clockedInEmails.has(email));

  const missingStaff = missingEmails.map((email) => {
    const shift = todaysShifts.find((s) => s.employee_email === email);
    const emp = employees.find((e) => e.email === email);
    return {
      name: shift?.employee_name || emp?.full_name || email,
      position: emp?.position || "—",
      expectedTime: shift?.start_time || "—",
      email,
    };
  });

  const attendanceRate =
    expectedEmails.size > 0
      ? Math.round((clockedInEmails.size / expectedEmails.size) * 100)
      : 0;

  const stats = {
    attendanceRate,
    clockedIn: activeEntries.length,
    expected: expectedEmails.size,
    missing: missingStaff.length,
    totalHours: parseFloat(totalHours.toFixed(1)),
  };

  // Weekly chart data
  const weekStart = moment().startOf("isoWeek");
  const weekEnd = moment().endOf("isoWeek");
  const weekEntries = entries.filter(
    (e) => e.status !== "clocked_in" && e.date >= weekStart.format("YYYY-MM-DD") && e.date <= weekEnd.format("YYYY-MM-DD")
  );
  const dailyTotals = {};
  weekEntries.forEach((e) => {
    dailyTotals[e.date] = (dailyTotals[e.date] || 0) + (e.total_hours || 0);
  });
  const chartData = [];
  for (let m = weekStart.clone(); m.isSameOrBefore(weekEnd); m.add(1, "day")) {
    const dateStr = m.format("YYYY-MM-DD");
    chartData.push({
      label: m.format("ddd"),
      hours: parseFloat((dailyTotals[dateStr] || 0).toFixed(1)),
      date: dateStr,
    });
  }

  // 30-day hours trend
  const trendStart = moment().subtract(29, "days");
  const trendEntries = entries.filter(
    (e) => e.status !== "clocked_in" && e.date >= trendStart.format("YYYY-MM-DD")
  );
  const trendDailyTotals = {};
  trendEntries.forEach((e) => {
    trendDailyTotals[e.date] = (trendDailyTotals[e.date] || 0) + (e.total_hours || 0);
  });
  const trendData = [];
  for (let m = trendStart.clone(); m.isSameOrBefore(moment()); m.add(1, "day")) {
    const dateStr = m.format("YYYY-MM-DD");
    trendData.push({
      label: m.format("MMM D"),
      hours: parseFloat((trendDailyTotals[dateStr] || 0).toFixed(1)),
    });
  }

  // Location distribution
  const locationCounts = {};
  employees.forEach((e) => {
    const loc = e.branch || "Unassigned";
    locationCounts[loc] = (locationCounts[loc] || 0) + 1;
  });
  const locationData = Object.entries(locationCounts).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {moment().format("dddd, DD MMMM YYYY")}
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <SelfClockWidget user={user} />
        </div>
        {canManage && (
          <div className="lg:col-span-2">
            <DashboardKPIs stats={stats} />
          </div>
        )}
      </div>

      {canManage && (
        <div className="grid lg:grid-cols-3 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-2"
          >
            <AttendanceBreakdownChart data={chartData} overtimeThreshold={overtimeThreshold} />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <ActiveStaffCard activeEntries={activeEntries} />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-3"
          >
            <MissingStaffCard missingStaff={missingStaff} />
          </motion.div>
        </div>
      )}

      {canManage && (
        <div className="grid lg:grid-cols-3 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="lg:col-span-2"
          >
            <HoursTrendChart data={trendData} />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <LocationDistributionChart data={locationData} />
          </motion.div>
        </div>
      )}
    </div>
  );
}