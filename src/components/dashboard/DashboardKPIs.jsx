import SummaryKPICard from "@/components/summary/SummaryKPICard";
import { UserCheck, Users, UserX, Clock } from "lucide-react";

export default function DashboardKPIs({ stats }) {
  const kpis = [
    {
      label: "Attendance Rate",
      value: `${stats.attendanceRate}%`,
      sub: `${stats.clockedIn} of ${stats.expected} expected`,
      icon: UserCheck,
      color: "bg-chart-2/10 text-chart-2",
    },
    {
      label: "Active Now",
      value: stats.clockedIn,
      sub: "Currently clocked in",
      icon: Users,
      color: "bg-accent text-accent-foreground",
    },
    {
      label: "Missing Staff",
      value: stats.missing,
      sub: "Expected but not in",
      icon: UserX,
      color: stats.missing > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
    },
    {
      label: "Hours Today",
      value: `${stats.totalHours}h`,
      sub: "Completed shifts",
      icon: Clock,
      color: "bg-chart-3/10 text-chart-3",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi) => (
        <SummaryKPICard key={kpi.label} {...kpi} />
      ))}
    </div>
  );
}