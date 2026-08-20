/**
 * Manual Time Entry Modal
 * -----------------------
 * Allows admin/manager/master to capture hours for a previous (or any) date
 * when an employee didn't clock in or out. Creates a completed time entry
 * via POST /time-entries/manual, flagged as a manual override and recorded
 * in the audit trail with the acting user's identity.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, ShieldAlert, CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';
import { employeeApi, timeEntryApi, type Employee, ApiError } from '../../services/api';
import {
  Button, Input, Label, Modal, Select, Spinner, Textarea,
} from '../ui';
import { toDateStr } from '../../lib/utils';

interface ManualTimeEntryModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful manual entry so the parent can refresh. */
  onDone?: () => void;
}

/** Yesterday's date as YYYY-MM-DD (local time). */
function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateStr(d);
}

export default function ManualTimeEntryModal({ open, onClose, onDone }: ManualTimeEntryModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [date, setDate] = useState(yesterdayStr());
  const [clockIn, setClockIn] = useState('08:00');
  const [clockOut, setClockOut] = useState('17:00');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Load employee list when the modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingEmployees(true);
      try {
        const res = await employeeApi.list({ limit: 500 });
        if (!cancelled) {
          setEmployees(
            res.items
              .filter((e) => e.status === 'active')
              .sort((a, b) => `${a.surname} ${a.firstName}`.localeCompare(`${b.surname} ${b.firstName}`)),
          );
        }
      } catch (err) {
        if (!cancelled) toast.error('Failed to load employee list');
        console.error(err);
      } finally {
        if (!cancelled) setLoadingEmployees(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset state when the modal closes
  useEffect(() => {
    if (!open) {
      setSelectedId('');
      setSearch('');
      setDate(yesterdayStr());
      setClockIn('08:00');
      setClockOut('17:00');
      setBreakMinutes('0');
      setNotes('');
    }
  }, [open]);

  const selectedEmployee = employees.find((e) => e.id === selectedId) ?? null;

  const filtered = employees.filter((e) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      `${e.firstName} ${e.surname}`.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      (e.employeeNumber ?? '').toLowerCase().includes(q)
    );
  });

  // Live total-hours preview (mirrors server calculation)
  const preview = useMemo(() => {
    if (!date || !clockIn || !clockOut) return null;
    const inDate = new Date(`${date}T${clockIn}:00`);
    const outDate = new Date(`${date}T${clockOut}:00`);
    if (isNaN(inDate.getTime()) || isNaN(outDate.getTime())) return null;
    if (outDate <= inDate) return { valid: false, total: 0 };
    const parsed = parseInt(breakMinutes, 10);
    const breakHrs = (Number.isFinite(parsed) && parsed >= 0 ? parsed : 0) / 60;
    const rawHours = (outDate.getTime() - inDate.getTime()) / 3_600_000;
    const total = Math.max(0, Math.round((rawHours - breakHrs) * 100) / 100);
    return { valid: true, total };
  }, [date, clockIn, clockOut, breakMinutes]);

  const handleSubmit = async () => {
    if (!selectedEmployee) {
      toast.error('Please select a staff member');
      return;
    }
    if (!date) {
      toast.error('Please choose a date');
      return;
    }
    if (!preview || !preview.valid) {
      toast.error('Clock-out must be after clock-in');
      return;
    }

    setBusy(true);
    try {
      const parsed = parseInt(breakMinutes, 10);
      const mins = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      await timeEntryApi.manual({
        employeeId: selectedEmployee.id,
        date,
        clockIn,
        clockOut,
        breakMinutes: mins,
        notes: notes.trim() || undefined,
      });
      toast.success(`Time entry added for ${selectedEmployee.firstName} ${selectedEmployee.surname} (${date})`);
      onDone?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        toast.error(err.details.map((d) => d.message).join('; '));
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Failed to create manual time entry');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Add Manual Time Entry" wide>
      <div className="space-y-5">
        {/* Context notice */}
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-amber-700 dark:text-amber-400">
            Use this to capture hours for a previous date when a staff member didn't clock in or
            out. The entry is created as completed, flagged as a manual override, and recorded in
            the audit trail with your identity.
          </p>
        </div>

        {/* Employee search */}
        <div className="space-y-2">
          <Label htmlFor="manual-search">Find staff member</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="manual-search"
              className="pl-9"
              placeholder="Search by name, email or staff number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Employee selection */}
        <div className="space-y-2">
          <Label htmlFor="manual-select">Staff member</Label>
          {loadingEmployees ? (
            <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Loading employees…
            </div>
          ) : (
            <Select
              id="manual-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">— Select staff member —</option>
              {filtered.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.surname}, {e.firstName} · {e.branch} / {e.department}
                  {e.employeeNumber ? ` · #${e.employeeNumber}` : ''}
                </option>
              ))}
            </Select>
          )}
        </div>

        {/* Date and times */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="manual-date">Date</Label>
            <Input
              id="manual-date"
              type="date"
              value={date}
              max={toDateStr(new Date())}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-clock-in">Clock in</Label>
            <Input
              id="manual-clock-in"
              type="time"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-clock-out">Clock out</Label>
            <Input
              id="manual-clock-out"
              type="time"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
            />
          </div>
        </div>

        {/* Break minutes */}
        <div className="space-y-2">
          <Label htmlFor="manual-break">Break minutes (optional)</Label>
          <Input
            id="manual-break"
            type="number"
            min="0"
            max="720"
            step="5"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
          />
          <div className="flex gap-2">
            {[0, 15, 30, 60].map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={breakMinutes === String(m) ? 'default' : 'outline'}
                onClick={() => setBreakMinutes(String(m))}
              >
                {m === 0 ? 'No break' : `${m}m`}
              </Button>
            ))}
          </div>
        </div>

        {/* Notes / justification */}
        <div className="space-y-2">
          <Label htmlFor="manual-notes">Reason / notes (recorded in audit log)</Label>
          <Textarea
            id="manual-notes"
            placeholder="e.g. Employee forgot to clock out on Tuesday / device was offline…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />
        </div>

        {/* Total hours preview */}
        {preview && preview.valid && (
          <div className="rounded-lg border bg-secondary/40 p-3 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Total hours (after break)</span>
            <span className="font-semibold tabular-nums">{preview.total.toFixed(2)}h</span>
          </div>
        )}
        {preview && !preview.valid && (
          <p className="text-sm text-red-500">Clock-out must be after clock-in.</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={busy || !selectedEmployee || !preview?.valid}
            className="bg-gradient-to-r from-brand to-brand-light hover:from-brand-dark hover:to-brand text-white"
          >
            <CalendarPlus className="h-4 w-4" />
            {busy ? 'Saving…' : 'Add Time Entry'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}