import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { client } from "@/api/Client";
import { toast } from "sonner";
import moment from "moment";

export default function MockDataGenerator() {
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setResult(null);
    try {
      const employees = await client.entities.Employee.filter(
        { status: "active" },
        "-created_date",
        500
      );

      if (employees.length === 0) {
        toast.error("No active employees found. Add employees first.");
        return;
      }

      const entries = [];
      const today = moment();

      for (let i = 29; i >= 0; i--) {
        const date = today.clone().subtract(i, "days");
        const dayOfWeek = date.day();

        // Skip weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;

        for (const emp of employees) {
          // 10% absenteeism
          if (Math.random() < 0.1) continue;

          const clockInHour = 7.5 + Math.random() * 1.5;
          const workDuration = 7.5 + Math.random() * 2;
          const clockOutHour = clockInHour + workDuration;

          const clockIn = date
            .clone()
            .hour(Math.floor(clockInHour))
            .minute(Math.floor((clockInHour % 1) * 60));
          const clockOut = date
            .clone()
            .hour(Math.floor(clockOutHour))
            .minute(Math.floor((clockOutHour % 1) * 60));

          entries.push({
            employee_email: emp.email,
            employee_name: emp.full_name,
            first_name: emp.first_name || "",
            surname: emp.surname || "",
            employee_code: emp.employee_number || "",
            phone: emp.phone || "",
            branch: emp.branch || "",
            department: emp.department || "",
            clock_in: clockIn.toISOString(),
            clock_out: clockOut.toISOString(),
            date: date.format("YYYY-MM-DD"),
            total_hours: parseFloat(workDuration.toFixed(1)),
            status: "completed",
            break_minutes: 30 + Math.floor(Math.random() * 30),
            is_manual_override: false,
          });
        }
      }

      // Bulk create in batches of 500
      const batchSize = 500;
      let created = 0;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        await client.entities.TimeEntry.bulkCreate(batch);
        created += batch.length;
      }

      setResult({
        employees: employees.length,
        entries: entries.length,
        days: 30,
      });
      toast.success(
        `Generated ${entries.length} time entries for ${employees.length} employees!`
      );
    } catch (err) {
      toast.error(err.message || "Failed to generate mock data");
    } finally {
      setGenerating(false);
    }
  };

  const handleClear = async () => {
    setGenerating(true);
    try {
      const thirtyDaysAgo = moment().subtract(30, "days").format("YYYY-MM-DD");
      await data.entities.TimeEntry.deleteMany({
        date: { $gte: thirtyDaysAgo },
      });
      setResult(null);
      toast.success("Mock data cleared.");
    } catch (err) {
      toast.error(err.message || "Failed to clear mock data");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          Mock Data Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Generate 30 days of realistic time entries for all active employees to
          populate reports and dashboards. Weekday-only entries with varied
          clock-in/out times and ~10% absenteeism.
        </p>

        <div className="flex flex-wrap gap-3">
          <Button onClick={handleGenerate} disabled={generating} className="rounded-xl">
            {generating ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Database className="w-4 h-4 mr-2" />
            )}
            {generating ? "Generating..." : "Generate 30 Days of Data"}
          </Button>
          {result && (
            <Button
              onClick={handleClear}
              disabled={generating}
              variant="outline"
              className="rounded-xl"
            >
              Clear Mock Data
            </Button>
          )}
        </div>

        {result && (
          <div className="flex items-start gap-3 bg-chart-2/5 border border-chart-2/20 rounded-xl p-4">
            <CheckCircle2 className="w-5 h-5 text-chart-2 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Mock data generated successfully</p>
              <p className="text-muted-foreground mt-1">
                {result.entries} time entries created for {result.employees}{" "}
                employees across {result.days} days. Check the{" "}
                <span className="font-medium">Reports</span> page to see the
                populated data.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-3 bg-chart-3/5 border border-chart-3/20 rounded-xl p-4">
          <AlertTriangle className="w-4 h-4 text-chart-3 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            This will add demo entries to your database. Use "Clear Mock Data"
            to remove entries from the last 30 days.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}