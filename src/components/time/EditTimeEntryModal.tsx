/**
 * Edit Time Entry Modal
 * ---------------------
 * Allows admin/manager/master to correct an existing time entry:
 * date, clock-in/out times, and break minutes. Used to fix forgotten
 * clock-outs, incorrect auto-clock-outs, or data-capturing errors.
 *
 * Every adjustment requires a reason, is flagged as `isManuallyAdjusted`,
 * and is recorded in the audit trail with the acting user's identity.
 */

import { useEffect, useMemo, useState } from 'react';
import { ShieldAlert, Save } from 'lucide-react';
import { toast } from 'sonner';
import { timeEntryApi, type TimeEntry, ApiError } from '../../services/api';
import {
  Button, Input, Label, Modal, Textarea,
} from '../ui';
import { toDateStr, formatTime } from '../../lib/utils';

interface EditTimeEntryModalProps {
  open: boolean;
  entry: TimeEntry | null;
  onClose: () => void;
  /** Called after a successful update so the parent can refresh. */
  onDone?: () => void;
}

/** Extract HH:mm from an ISO datetime string (local time). */
function toTimeStr(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function EditTimeEntryModal({ open, entry, onClose, onDone }: EditTimeEntryModalProps) {
  const [date, setDate] = useState('');
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Populate form when the modal opens with an entry
  useEffect(() => {
    if (open && entry) {
      setDate(toDateStr(new Date(entry.date)));
      setClockIn(toTimeStr(entry.clockIn));
      setClockOut(entry.clockOut ? toTimeStr(entry.clockOut) : '');
      setBreakMinutes(String(entry.breakMinutes ?? 0));
      setReason('');
    }
  }, [open, entry]);

  // Live total-hours preview (mirrors server calculation)
  const preview = useMemo(() => {
    if (!date || !clockIn) return null;
    // If no clock-out provided, we can't compute a total (entry stays active)
    if (!clockOut) return { valid: true, total: null };
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
    if (!entry) return;
    if (!date) {
      toast.error('Please choose a date');
      return;
    }
    if (!clockIn) {
      toast.error('Please provide a clock-in time');
      return;
    }
    if (preview && !preview.valid) {
      toast.error('Clock-out must be after clock-in');
      return;
    }
    if (!reason.trim()) {
      toast.error('A reason is required for manual adjustments');
      return;
    }

    setBusy(true);
    try {
      const parsed = parseInt(breakMinutes, 10);
      const mins = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      await timeEntryApi.update(entry.id, {
        date,
        clockIn,
        clockOut: clockOut || undefined,
        breakMinutes: mins,
        reason: reason.trim(),
      });
      toast.success(`Time entry updated for ${entry.employeeName ?? entry.employeeEmail}`);
      onDone?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        toast.error(err.details.map((d) => d.message).join('; '));
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Failed to update time entry');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Edit Time Entry" wide>
      <div className="space-y-5">
        {/* Context notice */}
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-amber-700 dark:text-amber-400">
            Use this to correct captured hours (e.g. forgotten clock-out, incorrect auto-clock-out,
            or data-capturing errors). The entry will be marked as <strong>Manual</strong> and the
            change is recorded in the audit trail with your identity.
          </p>
        </div>

        {/* Entry summary */}
        {entry && (
          <div className="rounded-lg border bg-secondary/40 p-3 text-sm space-y-1">
            <p className="font-medium">{entry.employeeName ?? entry.employeeEmail}</p>
            <p className="text-muted-foreground">
              Current: {toDateStr(new Date(entry.date))} · In {formatTime(entry.clockIn)} · Out{' '}
              {entry.clockOut ? formatTime(entry.clockOut) : '—'} · Break {entry.breakMinutes ?? 0}m
            </p>
          </div>
        )}

        {/* Date and times */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="edit-date">Date</Label>
            <Input
              id="edit-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-clock-in">Clock in</Label>
            <Input
              id="edit-clock-in"
              type="time"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-clock-out">Clock out</Label>
            <Input
              id="edit-clock-out"
              type="time"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty if the session is still active.
            </p>
          </div>
        </div>

        {/* Break minutes */}
        <div className="space-y-2">
          <Label htmlFor="edit-break">Break minutes (optional)</Label>
          <Input
            id="edit-break"
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

        {/* Reason / justification (required) */}
        <div className="space-y-2">
          <Label htmlFor="edit-reason">Reason for adjustment (required, recorded in audit log)</Label>
          <Textarea
            id="edit-reason"
            placeholder="e.g. Employee forgot to clock out / auto-clock-out failed / incorrect data captured…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
          />
        </div>

        {/* Total hours preview */}
        {preview && preview.valid && preview.total !== null && (
          <div className="rounded-lg border bg-secondary/40 p-3 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Total hours (after break)</span>
            <span className="font-semibold tabular-nums">{preview.total.toFixed(2)}h</span>
          </div>
        )}
        {preview && preview.valid && preview.total === null && (
          <p className="text-sm text-muted-foreground">
            No clock-out provided — entry will remain active.
          </p>
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
            disabled={busy || !preview?.valid || !reason.trim()}
            className="bg-gradient-to-r from-brand to-brand-light hover:from-brand-dark hover:to-brand text-white"
          >
            <Save className="h-4 w-4" />
            {busy ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}