import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "12px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
};

export default function LocationDistributionChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border p-6 flex items-center justify-center h-48 text-muted-foreground text-sm">
        No location data available
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-6 h-full">
      <h3 className="text-base font-semibold mb-1">Staff by Location</h3>
      <p className="text-xs text-muted-foreground mb-5">Employee distribution across branches</p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name) => [`${v} staff`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}