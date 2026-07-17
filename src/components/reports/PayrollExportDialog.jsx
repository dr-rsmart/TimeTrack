import { useState } from "react";
import * as XLSX from "xlsx";
import moment from "moment";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { calculateOvertime } from "@/utils/overtimeCalculator";

const PAYROLL_FORMATS = [
  { value: "standard", label: "Standard (All Systems)" },
  { value: "sage", label: "Sage Business Cloud Payroll" },
  { value: "deal", label: "Deal Payroll" },
  { value: "simplypay", label: "SimplePay / Local Payroll" },
];

function buildPayrollRows(entries, settings, periodLabel) {
  const byEmployee = {};
  entries.forEach((e) => {
    const key = e.employee_email;
    if (!byEmployee[key]) {
      byEmployee[key] = {
        name: e.employee_name || e.employee_email,
        email: e.employee_email,
        entries: [],
      };
    }
    byEmployee[key].entries.push(e);
  });

  const rows = [];
  Object.values(byEmployee).forEach((emp, idx) => {
    const ot = calculateOvertime(emp.entries, settings);

    const daySet = {};
    emp.entries.forEach((e) => {
      daySet[e.date] = true;
    });

    rows.push({
      "Employee Number": String(idx + 1).padStart(4, "0"),
      "Employee Name": emp.name,
      "Employee Email": emp.email,
      Period: periodLabel,
      "Days Worked": Object.keys(daySet).length,
      "Ordinary Hours": ot.ordinaryHours,
      "Daily Overtime": parseFloat((ot.dailyOvertimeHours + ot.monthlyOvertimeHours).toFixed(2)),
      "Sunday OT (1.5x)": ot.sundayOvertimeHours,
      "Holiday OT (2.0x)": ot.holidayOvertimeHours,
      "Total Overtime": ot.totalOvertimeHours,
      "Total Hours": ot.totalHours,
      "Weighted Overtime": ot.totalWeightedOvertime,
    });
  });

  return rows;
}

function buildSageRows(rows) {
  return rows.flatMap((r) => {
    const result = [];
    if (r["Ordinary Hours"] > 0) {
      result.push({
        "Employee Number": r["Employee Number"],
        "Employee Name": r["Employee Name"],
        "Pay Period": r.Period,
        "Pay Type": "Ordinary Time",
        Hours: r["Ordinary Hours"],
        Days: r["Days Worked"],
      });
    }
    if (r["Daily Overtime"] > 0) {
      result.push({
        "Employee Number": r["Employee Number"],
        "Employee Name": r["Employee Name"],
        "Pay Period": r.Period,
        "Pay Type": "Overtime 1.0x",
        Hours: r["Daily Overtime"],
        Days: "",
      });
    }
    if (r["Sunday OT (1.5x)"] > 0) {
      result.push({
        "Employee Number": r["Employee Number"],
        "Employee Name": r["Employee Name"],
        "Pay Period": r.Period,
        "Pay Type": "Sunday Overtime 1.5x",
        Hours: r["Sunday OT (1.5x)"],
        Days: "",
      });
    }
    if (r["Holiday OT (2.0x)"] > 0) {
      result.push({
        "Employee Number": r["Employee Number"],
        "Employee Name": r["Employee Name"],
        "Pay Period": r.Period,
        "Pay Type": "Public Holiday Overtime 2.0x",
        Hours: r["Holiday OT (2.0x)"],
        Days: "",
      });
    }
    return result;
  });
}

function buildDealRows(rows) {
  return rows.map((r) => ({
    "Emp No": r["Employee Number"],
    Name: r["Employee Name"],
    Period: r.Period,
    "Ord Hrs": r["Ordinary Hours"],
    "OT Hrs": r["Daily Overtime"],
    "Sun OT (1.5x)": r["Sunday OT (1.5x)"],
    "Hol OT (2.0x)": r["Holiday OT (2.0x)"],
    "Total OT": r["Total Overtime"],
    "Total Hrs": r["Total Hours"],
    Days: r["Days Worked"],
  }));
}

export default function PayrollExportDialog({ open, onClose, entries, companySettings }) {
  const [format, setFormat] = useState("standard");
  const [periodType, setPeriodType] = useState("month");
  const [customStart, setCustomStart] = useState(
    moment().startOf("month").format("YYYY-MM-DD")
  );
  const [customEnd, setCustomEnd] = useState(moment().endOf("month").format("YYYY-MM-DD"));

  const overtimeThreshold = companySettings?.overtime_threshold_hours ?? 8;
  const sundayMultiplier = companySettings?.sunday_overtime_multiplier ?? 1.5;
  const holidayMultiplier = companySettings?.public_holiday_overtime_multiplier ?? 2.0;

  const otSettings = {
    overtime_threshold_hours: overtimeThreshold,
    use_monthly_overtime_threshold: companySettings?.use_monthly_overtime_threshold ?? false,
    monthly_overtime_threshold_hours: companySettings?.monthly_overtime_threshold_hours ?? 195,
    sunday_overtime_enabled: companySettings?.sunday_overtime_enabled ?? true,
    sunday_overtime_multiplier: sundayMultiplier,
    public_holiday_overtime_enabled: companySettings?.public_holiday_overtime_enabled ?? true,
    public_holiday_overtime_multiplier: holidayMultiplier,
    public_holidays: companySettings?.public_holidays ?? [],
  };

  const getPeriodRange = () => {
    if (periodType === "week") {
      return {
        start: moment().startOf("isoWeek").format("YYYY-MM-DD"),
        end: moment().endOf("isoWeek").format("YYYY-MM-DD"),
        label: `Week of ${moment().startOf("isoWeek").format("DD MMM YYYY")}`,
      };
    }
    if (periodType === "month") {
      return {
        start: moment().startOf("month").format("YYYY-MM-DD"),
        end: moment().endOf("month").format("YYYY-MM-DD"),
        label: moment().format("MMMM YYYY"),
      };
    }
    if (periodType === "lastmonth") {
      const lm = moment().subtract(1, "month");
      return {
        start: lm.startOf("month").format("YYYY-MM-DD"),
        end: lm.endOf("month").format("YYYY-MM-DD"),
        label: lm.format("MMMM YYYY"),
      };
    }
    return {
      start: customStart,
      end: customEnd,
      label: `${moment(customStart).format("DD MMM")} – ${moment(customEnd).format("DD MMM YYYY")}`,
    };
  };

  const handleExport = () => {
    const { start, end, label } = getPeriodRange();

    const periodEntries = entries.filter(
      (e) => e.status !== "clocked_in" && e.date >= start && e.date <= end
    );

    if (periodEntries.length === 0) {
      toast.error("No completed entries found for the selected period.");
      return;
    }

    const baseRows = buildPayrollRows(periodEntries, otSettings, label);

    let sheetData;
    let fileName;

    if (format === "sage") {
      sheetData = buildSageRows(baseRows);
      fileName = `Sage_Payroll_Export_${label.replace(/\s/g, "_")}.xlsx`;
    } else if (format === "deal") {
      sheetData = buildDealRows(baseRows);
      fileName = `Deal_Payroll_Export_${label.replace(/\s/g, "_")}.xlsx`;
    } else {
      sheetData = baseRows;
      fileName = `Payroll_Export_${label.replace(/\s/g, "_")}.xlsx`;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetData);

    ws["!cols"] = Object.keys(sheetData[0] || {}).map((key) => ({
      wch: Math.max(key.length + 2, 14),
    }));

    XLSX.utils.book_append_sheet(wb, ws, "Payroll");

    if (format === "standard" && baseRows.length > 0) {
      const summaryData = [
        { "Export Date": moment().format("DD/MM/YYYY HH:mm") },
        { "Pay Period": label },
        { "Total Employees": baseRows.length },
        { "Total Ordinary Hours": parseFloat(baseRows.reduce((s, r) => s + r["Ordinary Hours"], 0).toFixed(2)) },
        { "Total Daily Overtime": parseFloat(baseRows.reduce((s, r) => s + r["Daily Overtime"], 0).toFixed(2)) },
        { "Total Sunday OT (1.5x)": parseFloat(baseRows.reduce((s, r) => s + r["Sunday OT (1.5x)"], 0).toFixed(2)) },
        { "Total Holiday OT (2.0x)": parseFloat(baseRows.reduce((s, r) => s + r["Holiday OT (2.0x)"], 0).toFixed(2)) },
        { "Total Overtime Hours": parseFloat(baseRows.reduce((s, r) => s + r["Total Overtime"], 0).toFixed(2)) },
        { "Total Hours": parseFloat(baseRows.reduce((s, r) => s + r["Total Hours"], 0).toFixed(2)) },
      ];
      const wsSummary = XLSX.utils.json_to_sheet(summaryData);
      wsSummary["!cols"] = [{ wch: 28 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
    }

    XLSX.writeFile(wb, fileName);
    toast.success(`Exported ${fileName}`);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-2xl max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-accent-foreground" />
            </div>
            <div>
              <DialogTitle>Payroll Export</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Export hours data for your payroll system
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Payroll System</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger className="mt-1.5 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYROLL_FORMATS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Pay Period</Label>
            <Select value={periodType} onValueChange={setPeriodType}>
              <SelectTrigger className="mt-1.5 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">
                  This Month ({moment().format("MMMM YYYY")})
                </SelectItem>
                <SelectItem value="lastmonth">
                  Last Month ({moment().subtract(1, "month").format("MMMM YYYY")})
                </SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {periodType === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>From</Label>
                <Input
                  type="date"
                  className="mt-1.5 rounded-xl"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
              </div>
              <div>
                <Label>To</Label>
                <Input
                  type="date"
                  className="mt-1.5 rounded-xl"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="bg-accent/50 rounded-xl p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Export includes:</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>Employee number & name</li>
              <li>Ordinary hours (up to {overtimeThreshold}h/day)</li>
              <li>Daily overtime (above {overtimeThreshold}h/day)</li>
              <li>Sunday overtime (@ {sundayMultiplier}x)</li>
              <li>Public holiday overtime (@ {holidayMultiplier}x)</li>
              <li>Total hours & days worked</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">
            Cancel
          </Button>
          <Button onClick={handleExport} className="rounded-xl">
            <Download className="w-4 h-4 mr-2" />
            Export Excel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}