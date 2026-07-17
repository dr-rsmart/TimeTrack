import moment from "moment";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function WeeklyChart({ entries }) {
  const startOfWeek = moment().startOf("isoWeek");
  const days = [];

  for (let i = 0; i < 7; i++) {
    const day = startOfWeek.clone().add(i, "days");
    const dayStr = day.format("YYYY-MM-DD");
    const dayEntries = (entries || []).filter((e) => e.date === dayStr && e.status !== "clocked_in");
    const totalHours = dayEntries.reduce((sum, e) => sum + (e.total_hours || 0), 0);

    days.push({
      day: day.format("ddd"),
      hours: parseFloat(totalHours.toFixed(1)),
      isToday: day.isSame(moment(), "day"),
    });
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <h3 className="text-base font-semibold mb-6">This Week</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={days} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="day"
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
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "12px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
              }}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
              formatter={(value) => [`${value}h`, "Hours"]}
            />
            <Bar
              dataKey="hours"
              fill="hsl(var(--primary))"
              radius={[6, 6, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}