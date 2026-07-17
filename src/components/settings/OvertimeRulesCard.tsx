import { useState, useEffect } from "react";
import { client } from "@/api/Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save, Clock } from "lucide-react";
import { toast } from "sonner";
import PublicHolidaysManager from "@/components/settings/PublicHolidaysManager";

export default function OvertimeRulesCard() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    use_monthly_overtime_threshold: false,
    monthly_overtime_threshold_hours: 195,
    sunday_overtime_enabled: true,
    sunday_overtime_multiplier: 1.5,
    public_holiday_overtime_enabled: true,
    public_holiday_overtime_multiplier: 2.0,
    public_holidays: [],
  });

  const { data: settings = [] } = useQuery({
    queryKey: ["companySettings"],
    queryFn: () => client.entities.CompanySettings.list(),
  });

  const existing = settings[0];

  useEffect(() => {
    if (existing) {
      setForm({
        use_monthly_overtime_threshold: existing.use_monthly_overtime_threshold ?? false,
        monthly_overtime_threshold_hours: existing.monthly_overtime_threshold_hours ?? 195,
        sunday_overtime_enabled: existing.sunday_overtime_enabled ?? true,
        sunday_overtime_multiplier: existing.sunday_overtime_multiplier ?? 1.5,
        public_holiday_overtime_enabled: existing.public_holiday_overtime_enabled ?? true,
        public_holiday_overtime_multiplier: existing.public_holiday_overtime_multiplier ?? 2.0,
        public_holidays: existing.public_holidays ?? [],
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
      toast.success("Overtime rules saved!");
    },
  });

  return (
    <div className="bg-card rounded-2xl border border-border p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
          <Clock className="w-5 h-5 text-accent-foreground" />
        </div>
        <div>
          <h2 className="font-semibold">Overtime Rules</h2>
          <p className="text-xs text-muted-foreground">
            Configure when overtime applies and how it's calculated
          </p>
        </div>
      </div>

      {/* Monthly Threshold */}
      <div className="flex items-center justify-between py-2 border-t border-border">
        <div>
          <p className="text-sm font-medium">Monthly Overtime Threshold</p>
          <p className="text-xs text-muted-foreground">
            Overtime only after this many ordinary hours/month
          </p>
        </div>
        <Switch
          checked={form.use_monthly_overtime_threshold}
          onCheckedChange={(v) =>
            setForm({ ...form, use_monthly_overtime_threshold: v })
          }
        />
      </div>

      {form.use_monthly_overtime_threshold && (
        <div>
          <Label>Monthly Ordinary Hours Threshold</Label>
          <Input
            className="mt-1.5"
            type="number"
            min="1"
            step="0.5"
            value={form.monthly_overtime_threshold_hours}
            onChange={(e) =>
              setForm({
                ...form,
                monthly_overtime_threshold_hours: parseFloat(e.target.value),
              })
            }
          />
          <p className="text-xs text-muted-foreground mt-1">
            Hours per month before overtime kicks in (e.g. 195)
          </p>
        </div>
      )}

      {/* Sunday Overtime */}
      <div className="flex items-center justify-between py-2 border-t border-border">
        <div>
          <p className="text-sm font-medium">Sunday Overtime</p>
          <p className="text-xs text-muted-foreground">
            All Sunday hours counted as overtime
          </p>
        </div>
        <Switch
          checked={form.sunday_overtime_enabled}
          onCheckedChange={(v) => setForm({ ...form, sunday_overtime_enabled: v })}
        />
      </div>

      {form.sunday_overtime_enabled && (
        <div>
          <Label>Sunday Overtime Multiplier</Label>
          <Input
            className="mt-1.5"
            type="number"
            min="1"
            step="0.1"
            value={form.sunday_overtime_multiplier}
            onChange={(e) =>
              setForm({
                ...form,
                sunday_overtime_multiplier: parseFloat(e.target.value),
              })
            }
          />
          <p className="text-xs text-muted-foreground mt-1">
            Pay multiplier for Sunday hours (e.g. 1.5 = time-and-a-half)
          </p>
        </div>
      )}

      {/* Public Holiday Overtime */}
      <div className="flex items-center justify-between py-2 border-t border-border">
        <div>
          <p className="text-sm font-medium">Public Holiday Overtime</p>
          <p className="text-xs text-muted-foreground">
            All public holiday hours counted as overtime
          </p>
        </div>
        <Switch
          checked={form.public_holiday_overtime_enabled}
          onCheckedChange={(v) =>
            setForm({ ...form, public_holiday_overtime_enabled: v })
          }
        />
      </div>

      {form.public_holiday_overtime_enabled && (
        <>
          <div>
            <Label>Public Holiday Overtime Multiplier</Label>
            <Input
              className="mt-1.5"
              type="number"
              min="1"
              step="0.1"
              value={form.public_holiday_overtime_multiplier}
              onChange={(e) =>
                setForm({
                  ...form,
                  public_holiday_overtime_multiplier: parseFloat(e.target.value),
                })
              }
            />
            <p className="text-xs text-muted-foreground mt-1">
              Pay multiplier for public holiday hours (e.g. 2.0 = double time)
            </p>
          </div>
          <PublicHolidaysManager
            holidays={form.public_holidays}
            onChange={(holidays) => setForm({ ...form, public_holidays: holidays })}
          />
        </>
      )}

      <Button
        onClick={() => saveMutation.mutate(form)}
        disabled={saveMutation.isPending}
        className="w-full rounded-xl"
      >
        <Save className="w-4 h-4 mr-2" />
        {saveMutation.isPending ? "Saving..." : "Save Overtime Rules"}
      </Button>
    </div>
  );
}