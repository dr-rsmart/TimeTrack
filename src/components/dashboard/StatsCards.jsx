import { Clock, CalendarDays, TrendingUp, Timer } from "lucide-react";
import { motion } from "framer-motion";

function StatCard({ title, value, subtitle, icon: Icon, color, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="bg-card rounded-2xl border border-border p-5 hover:shadow-lg hover:shadow-primary/5 transition-shadow duration-300"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <p className="text-2xl font-bold mt-1 tracking-tight">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </motion.div>
  );
}

export default function StatsCards({ todayHours, weekHours, monthHours, avgDaily }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Today"
        value={`${todayHours.toFixed(1)}h`}
        subtitle="Hours worked"
        icon={Clock}
        color="bg-accent text-accent-foreground"
        delay={0}
      />
      <StatCard
        title="This Week"
        value={`${weekHours.toFixed(1)}h`}
        subtitle="Hours worked"
        icon={CalendarDays}
        color="bg-chart-2/10 text-chart-2"
        delay={0.05}
      />
      <StatCard
        title="This Month"
        value={`${monthHours.toFixed(1)}h`}
        subtitle="Hours worked"
        icon={TrendingUp}
        color="bg-chart-3/10 text-chart-3"
        delay={0.1}
      />
      <StatCard
        title="Daily Avg"
        value={`${avgDaily.toFixed(1)}h`}
        subtitle="This month"
        icon={Timer}
        color="bg-chart-4/10 text-chart-4"
        delay={0.15}
      />
    </div>
  );
}