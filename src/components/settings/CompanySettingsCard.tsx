import { useState, useEffect } from "react";
import { client } from "@/api/Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Save, Building2 } from "lucide-react";
import { toast } from "sonner";

const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function CompanySettingsCard() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    ordinary_hours_per_day: 8,
    overtime_threshold_hours: 8,
    work_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  });

  const { data: settings = [] } = useQuery({
    queryKey: ["companySettings"],
    queryFn: () => client.entities.CompanySettings.list(),
  });

  const existing = settings[0];

  useEffect(() => {
    if (existing) {
      setForm({
        ordinary_hours_per_day: existing.ordinary_hours_per_day ?? 8,
        overtime_threshold_hours: existing.overtime_threshold_hours ?? 8,
        work_days: existing.work_days ?? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      });
    }
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: (formData) =>
      existing
        ? client.entities.CompanySettings.update(existing.id, formData)
        : client.entities.CompanySettings.create(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companySettings"] });
      toast.success("Company settings saved!");
    },
  });

  const toggleDay = (day) => {
    setForm((f) => ({
      ...f,
      work_days: f.work_days.includes(day)
        ? f.work_days.filter((d) => d !== day)
        : [...f.work_days, day],
    }));
  };

  return (
    <div className="bg-card rounded-2xl border border-border p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
          <Building2 className="w-5 h-5 text-accent-foreground" />
        </div>
        <div>
          <h2 className="font-semibold">Company Work Policy</h2>
          <p className="text-xs text-muted-foreground">Set standard hours and work days for your company</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Ordinary Hours / Day</Label>
          <Input
            className="mt-1.5"
            type="number"
            min="1"
            max="24"
            step="0.5"
            value={form.ordinary_hours_per_day}
            onChange={(e) => setForm({ ...form, ordinary_hours_per_day: parseFloat(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground mt-1">Standard paid hours per day</p>
        </div>
        <div>
          <Label>Overtime Threshold (hrs)</Label>
          <Input
            className="mt-1.5"
            type="number"
            min="1"
            max="24"
            step="0.5"
            value={form.overtime_threshold_hours}
            onChange={(e) => setForm({ ...form, overtime_threshold_hours: parseFloat(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground mt-1">Hours/day before overtime kicks in</p>
        </div>
      </div>

      <div>
        <Label className="mb-3 block">Work Days</Label>
        <div className="grid grid-cols-4 gap-2">
          {ALL_DAYS.map((day) => (
            <label
              key={day}
              className="flex items-center gap-2 cursor-pointer select-none text-sm"
            >
              <Checkbox
                checked={form.work_days.includes(day)}
                onCheckedChange={() => toggleDay(day)}
              />
              <span>{day.slice(0, 3)}</span>
            </label>
          ))}
        </div>
      </div>

      <Button
        onClick={() => saveMutation.mutate(form)}
        disabled={saveMutation.isPending}
        className="w-full rounded-xl"
      >
        <Save className="w-4 h-4 mr-2" />
        {saveMutation.isPending ? "Saving..." : "Save Company Settings"}
      </Button>
    </div>
  );
}