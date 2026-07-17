import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export default function AttendanceBreakdownChart({ data, overtimeThreshold }) {
  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
  };

  if (!data || data.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border p-6 flex items-center justify-center h-48 text-muted-foreground text-sm">
        No data for this period
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <h3 className="text-base font-semibold mb-1">Daily Hours Overview</h3>
      <p className="text-xs text-muted-foreground mb-5">
        Dashed line shows the {overtimeThreshold}h overtime threshold
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              unit="h"
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v) => [`${v}h`, "Total Hours"]}
              labelFormatter={(l) => `Date: ${l}`}
            />
            <ReferenceLine
              y={overtimeThreshold}
              stroke="hsl(var(--chart-3))"
              strokeDasharray="5 4"
              strokeWidth={1.5}
            />
            <Bar
              dataKey="hours"
              fill="hsl(var(--primary))"
              radius={[5, 5, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}