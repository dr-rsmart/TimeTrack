import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import moment from "moment";

export default function TimeEntryDialog({ open, onOpenChange, entry, onSave, onDelete }) {
  const [form, setForm] = useState({
    date: moment().format("YYYY-MM-DD"),
    clock_in_time: "09:00",
    clock_out_time: "17:00",
    break_minutes: 0,
    notes: "",
  });

  useEffect(() => {
    if (entry) {
      setForm({
        date: entry.date || moment(entry.clock_in).format("YYYY-MM-DD"),
        clock_in_time: moment(entry.clock_in).format("HH:mm"),
        clock_out_time: entry.clock_out ? moment(entry.clock_out).format("HH:mm") : "",
        break_minutes: entry.break_minutes || 0,
        notes: entry.notes || "",
      });
    } else {
      setForm({
        date: moment().format("YYYY-MM-DD"),
        clock_in_time: "09:00",
        clock_out_time: "17:00",
        break_minutes: 0,
        notes: "",
      });
    }
  }, [entry, open]);

  const handleSave = () => {
    const clockIn = moment(`${form.date} ${form.clock_in_time}`, "YYYY-MM-DD HH:mm").toISOString();
    const clockOut = form.clock_out_time
      ? moment(`${form.date} ${form.clock_out_time}`, "YYYY-MM-DD HH:mm").toISOString()
      : null;

    let totalHours = null;
    if (clockOut) {
      const diff = moment(clockOut).diff(moment(clockIn), "minutes");
      totalHours = Math.max(0, (diff - (form.break_minutes || 0)) / 60);
    }

    onSave({
      date: form.date,
      clock_in: clockIn,
      clock_out: clockOut,
      total_hours: totalHours,
      break_minutes: parseInt(form.break_minutes) || 0,
      notes: form.notes,
      status: clockOut ? "edited" : "clocked_in",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit Time Entry" : "Add Time Entry"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Date</Label>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Clock In</Label>
              <Input
                type="time"
                value={form.clock_in_time}
                onChange={(e) => setForm({ ...form, clock_in_time: e.target.value })}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Clock Out</Label>
              <Input
                type="time"
                value={form.clock_out_time}
                onChange={(e) => setForm({ ...form, clock_out_time: e.target.value })}
                className="mt-1.5"
              />
            </div>
          </div>
          <div>
            <Label>Break (minutes)</Label>
            <Input
              type="number"
              min="0"
              value={form.break_minutes}
              onChange={(e) => setForm({ ...form, break_minutes: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional notes..."
              className="mt-1.5 resize-none"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {entry && onDelete && (
            <Button variant="destructive" onClick={() => onDelete(entry.id)} className="mr-auto">
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}