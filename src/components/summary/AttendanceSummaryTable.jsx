import { useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const COLS = [
  { key: "name", label: "Employee" },
  { key: "daysWorked", label: "Days" },
  { key: "absentDays", label: "Absent" },
  { key: "lateDays", label: "Late" },
  { key: "ordinaryHours", label: "Ordinary" },
  { key: "overtimeHours", label: "OT Hrs" },
  { key: "sundayOvertimeHours", label: "Sun OT" },
  { key: "holidayOvertimeHours", label: "Hol OT" },
  { key: "totalHours", label: "Total" },
  { key: "attendanceRate", label: "Attend %" },
];

export default function AttendanceSummaryTable({ employeeStats, viewMode }) {
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = [...employeeStats].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const cols = viewMode === "personal" ? COLS.filter((c) => c.key !== "name") : COLS;

  if (employeeStats.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border p-6 text-center text-muted-foreground text-sm">
        No attendance records found for this period.
      </div>
    );
  }

  const renderCell = (emp, col) => {
    const val = emp[col.key];
    const className = "px-4 py-3 whitespace-nowrap";

    if (col.key === "name") {
      return (
        <td key={col.key} className={className}>
          <div className="font-medium text-foreground">{emp.name}</div>
          <div className="text-xs text-muted-foreground">{emp.email}</div>
        </td>
      );
    }
    if (col.key === "attendanceRate") {
      const pct = parseFloat(val);
      const color = pct >= 90 ? "text-chart-2" : pct >= 70 ? "text-chart-3" : "text-destructive";
      return (
        <td key={col.key} className={cn(className, color, "font-semibold")}>
          {pct}%
        </td>
      );
    }
    if (["overtimeHours", "sundayOvertimeHours", "holidayOvertimeHours"].includes(col.key)) {
      return (
        <td
          key={col.key}
          className={cn(
            className,
            val > 0 ? "text-chart-3 font-medium" : "text-muted-foreground"
          )}
        >
          {val > 0 ? `${val}h` : "—"}
        </td>
      );
    }
    if (col.key === "absentDays") {
      return (
        <td
          key={col.key}
          className={cn(
            className,
            val > 0 ? "text-destructive font-medium" : "text-muted-foreground"
          )}
        >
          {val > 0 ? val : "—"}
        </td>
      );
    }
    if (col.key === "lateDays") {
      return (
        <td
          key={col.key}
          className={cn(
            className,
            val > 0 ? "text-chart-4 font-medium" : "text-muted-foreground"
          )}
        >
          {val > 0 ? val : "—"}
        </td>
      );
    }
    if (["ordinaryHours", "totalHours"].includes(col.key)) {
      return (
        <td key={col.key} className={className}>
          {val}h
        </td>
      );
    }
    return (
      <td key={col.key} className={className}>
        {val}
      </td>
    );
  };

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="p-5 pb-0">
        <h3 className="text-base font-semibold">
          {viewMode === "team" ? "Employee Breakdown" : "My Attendance Detail"}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5 mb-4">
          {employeeStats.length} {employeeStats.length === 1 ? "employee" : "employees"}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-border bg-muted/40">
              {cols.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    <ArrowUpDown
                      className={cn("w-3 h-3", sortKey === col.key ? "text-primary" : "opacity-30")}
                    />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((emp, i) => (
              <tr
                key={emp.email}
                className={cn(
                  "border-t border-border hover:bg-muted/30 transition-colors",
                  i % 2 === 0 ? "" : "bg-muted/10"
                )}
              >
                {cols.map((col) => renderCell(emp, col))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}