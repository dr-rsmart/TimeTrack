/**
 * Staff Clock Modal
 * -----------------
 * Allows admin/manager to clock staff in or out in BULK via a checkbox
 * list (same pattern as "Assign Employees to a Work Location"), e.g. when
 * a whole shift forgot to punch. Each proxy action is flagged as a manual
 * override and audit-logged server-side with the acting user's identity.
 *
 * - "Clock In N selected"  → POST /time-entries/bulk-clock-in
 * - "Clock Out N selected" → POST /time-entries/bulk-clock-out
 * The server skips ineligible staff (already clocked in / no active session /
 * out of scope) and reports them back so the UI can summarise the outcome.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogIn, LogOut, Search, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { employeeApi, timeEntryApi, type Employee, ApiError } from '../../services/api';
import {
  Badge, Button, Input, Label, Modal, Spinner, Textarea,
} from '../ui';

interface StaffClockModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful bulk action so the parent can refresh. */
  onDone?: () => void;
}

interface SkipInfo {
  email: string;
  reason: string;
}

export default function StaffClockModal({ open, onClose, onDone }: StaffClockModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [activeEmails, setActiveEmails] = useState<Set<string>>(new Set());
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [justification, setJustification] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [busy, setBusy] = useState<'in' | 'out' | null>(null);

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

  // Load which staff currently have an active session (single request)
  const refreshSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await timeEntryApi.list({ status: 'active', limit: 500 });
      setActiveEmails(new Set(res.items.map((i) => i.employeeEmail)));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    if (open) refreshSessions();
  }, [open, refreshSessions]);

  // Reset state when the modal closes
  useEffect(() => {
    if (!open) {
      setSelectedEmails(new Set());
      setJustification('');
      setBreakMinutes('0');
      setSearch('');
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        `${e.firstName} ${e.surname}`.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.employeeNumber ?? '').toLowerCase().includes(q),
    );
  }, [employees, search]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selectedEmails.has(e.email));

  const toggleSelection = (email: string) => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const e of filtered) next.delete(e.email);
      } else {
        for (const e of filtered) next.add(e.email);
      }
      return next;
    });
  };

  const summarise = (okCount: number, skipped: SkipInfo[], verb: string) => {
    if (okCount > 0) toast.success(`${verb} ${okCount} staff member${okCount === 1 ? '' : 's'}`);
    if (skipped.length > 0) {
      const detail = skipped
        .slice(0, 3)
        .map((s) => `${s.email}: ${s.reason}`)
        .join(' · ');
      toast.info(
        `Skipped ${skipped.length}: ${detail}${skipped.length > 3 ? ' …' : ''}`,
      );
    }
    if (okCount === 0 && skipped.length === 0) toast.error('Nothing to do');
  };

  const handleBulkClockIn = async () => {
    if (selectedEmails.size === 0) return;
    setBusy('in');
    try {
      const res = await timeEntryApi.bulkClockIn(
        [...selectedEmails],
        justification.trim() || undefined,
      );
      summarise(res.clockedIn.length, res.skipped, 'Clocked in');
      setSelectedEmails(new Set());
      setJustification('');
      onDone?.();
      await refreshSessions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Bulk clock-in failed');
    } finally {
      setBusy(null);
    }
  };

  const handleBulkClockOut = async () => {
    if (selectedEmails.size === 0) return;
    setBusy('out');
    try {
      const parsed = parseInt(breakMinutes, 10);
      const mins = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      const res = await timeEntryApi.bulkClockOut([...selectedEmails], mins);
      summarise(res.clockedOut.length, res.skipped, 'Clocked out');
      setSelectedEmails(new Set());
      setBreakMinutes('0');
      onDone?.();
      await refreshSessions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Bulk clock-out failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Clock On Behalf of Staff" wide>
      <div className="space-y-5">
        {/* Context notice */}
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-amber-700 dark:text-amber-400">
            Select one or more staff members to bulk clock in or out (e.g. a shift that forgot to
            punch). These actions bypass geofence validation and are recorded in the audit trail
            with your identity.
          </p>
        </div>

        {/* Employee search */}
        <div className="space-y-2">
          <Label htmlFor="staff-search">Find staff member</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="staff-search"
              className="pl-9"
              placeholder="Search by name, email or staff number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Staff checkbox list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-border accent-[hsl(var(--brand))]"
              />
              Select all ({filtered.length})
            </label>
            {loadingSessions && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Spinner className="h-3 w-3" /> Checking sessions…
              </span>
            )}
          </div>

          {loadingEmployees ? (
            <div className="flex h-24 items-center justify-center"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No staff match your search.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border divide-y">
              {filtered.map((e) => {
                const isActive = activeEmails.has(e.email);
                return (
                  <label
                    key={e.id}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-secondary/40"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmails.has(e.email)}
                      onChange={() => toggleSelection(e.email)}
                      className="h-4 w-4 rounded border-border accent-[hsl(var(--brand))] shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {e.firstName} {e.surname}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {e.email} · {e.branch} / {e.department}
                      </p>
                    </div>
                    {isActive ? (
                      <Badge variant="success" className="shrink-0">Clocked in</Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">Not clocked in</Badge>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Justification (audit context for clock-in) */}
        <div className="space-y-2">
          <Label htmlFor="proxy-justification">Reason for clock-in (recorded in audit log)</Label>
          <Textarea
            id="proxy-justification"
            placeholder="e.g. Shift started before system was available / devices offline…"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            maxLength={500}
          />
        </div>

        {/* Break minutes (for clock-out) */}
        <div className="space-y-2">
          <Label htmlFor="proxy-break">Break minutes for clock-out</Label>
          <Input
            id="proxy-break"
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

        {/* Bulk actions */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            onClick={handleBulkClockIn}
            disabled={busy !== null || selectedEmails.size === 0}
            className="flex-1 bg-gradient-to-r from-brand to-brand-light hover:from-brand-dark hover:to-brand text-white"
          >
            <LogIn className="h-4 w-4" />
            {busy === 'in' ? 'Clocking in…' : `Clock In ${selectedEmails.size} selected`}
          </Button>
          <Button
            onClick={handleBulkClockOut}
            disabled={busy !== null || selectedEmails.size === 0}
            className="flex-1 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white"
          >
            <LogOut className="h-4 w-4" />
            {busy === 'out' ? 'Clocking out…' : `Clock Out ${selectedEmails.size} selected`}
          </Button>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}