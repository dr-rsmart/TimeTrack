import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import moment from "moment";

const EMPTY = {
  employee_email: "",
  date: moment().format("YYYY-MM-DD"),
  start_time: "09:00",
  end_time: "17:00",
  shift_type: "full_day",
  location: "",
  notes: "",
};

export default function ShiftForm({ open, onOpenChange, onSave, existing, employees = [] }) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (existing) {
      setForm({ ...EMPTY, ...existing });
    } else {
      setForm(EMPTY);
    }
  }, [existing, open]);

  const handleSave = () => {
    const emp = employees.find((e) => e.email === form.employee_email);
    onSave({
      ...form,
      employee_name: emp?.full_name || form.employee_name || "",
    });
    onOpenChange(false);
  };

  const isValid = form.employee_email && form.date && form.start_time && form.end_time;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Shift" : "Create Shift"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Employee *</Label>
            <Select value={form.employee_email} onValueChange={(v) => setForm({ ...form, employee_email: v })}>
              <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.email}>
                    {emp.full_name} {emp.position ? `— ${emp.position}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date *</Label>
            <Input className="mt-1.5 rounded-xl" type="date" value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Time *</Label>
              <Input className="mt-1.5 rounded-xl" type="time" value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
            </div>
            <div>
              <Label>End Time *</Label>
              <Input className="mt-1.5 rounded-xl" type="time" value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Shift Type</Label>
              <Select value={form.shift_type} onValueChange={(v) => setForm({ ...form, shift_type: v })}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_day">Full Day</SelectItem>
                  <SelectItem value="morning">Morning</SelectItem>
                  <SelectItem value="afternoon">Afternoon</SelectItem>
                  <SelectItem value="night">Night</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Location</Label>
              <Input className="mt-1.5 rounded-xl" value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Main Office" />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea className="mt-1.5 rounded-xl" rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">Cancel</Button>
          <Button onClick={handleSave} disabled={!isValid} className="rounded-xl">
            {existing ? "Save Changes" : "Create Shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}