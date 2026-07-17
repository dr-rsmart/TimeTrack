import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar, X, Plus, Flag } from "lucide-react";
import moment from "moment";

const SA_HOLIDAYS_2026 = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-03-21", name: "Human Rights Day" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-06", name: "Family Day" },
  { date: "2026-04-27", name: "Freedom Day" },
  { date: "2026-05-01", name: "Workers' Day" },
  { date: "2026-06-16", name: "Youth Day" },
  { date: "2026-08-09", name: "National Women's Day" },
  { date: "2026-08-10", name: "National Women's Day (observed)" },
  { date: "2026-09-24", name: "Heritage Day" },
  { date: "2026-11-04", name: "Local Government Elections" },
  { date: "2026-12-16", name: "Day of Reconciliation" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-26", name: "Day of Goodwill" },
];

export default function PublicHolidaysManager({ holidays = [], onChange }) {
  const [newDate, setNewDate] = useState("");

  const loadSAHolidays = () => {
    const existing = new Set(holidays);
    const toAdd = SA_HOLIDAYS_2026.map((h) => h.date).filter((d) => !existing.has(d));
    onChange([...holidays, ...toAdd].sort());
  };

  const addHoliday = () => {
    if (!newDate || holidays.includes(newDate)) {
      setNewDate("");
      return;
    }
    onChange([...holidays, newDate].sort());
    setNewDate("");
  };

  const removeHoliday = (date) => {
    onChange(holidays.filter((d) => d !== date));
  };

  const sorted = [...holidays].sort();

  return (
    <div className="space-y-3">
      <Label>Public Holidays</Label>
      <div className="flex gap-2">
        <Input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className="rounded-xl"
        />
        <Button
          type="button"
          variant="outline"
          onClick={addHoliday}
          disabled={!newDate}
          className="rounded-xl shrink-0"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={loadSAHolidays}
        className="w-full rounded-xl border-dashed"
      >
        <Flag className="w-4 h-4 mr-2" />
        Load South African Public Holidays (2026)
      </Button>

      {sorted.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {sorted.map((date) => (
            <span
              key={date}
              className="inline-flex items-center gap-1.5 bg-accent text-accent-foreground text-xs font-medium px-2.5 py-1.5 rounded-lg"
            >
              <Calendar className="w-3 h-3" />
              {moment(date).format("DD MMM YYYY")}
              <button
                onClick={() => removeHoliday(date)}
                className="ml-0.5 hover:text-destructive transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No public holidays configured. Add dates above.
        </p>
      )}
    </div>
  );
}