/**
 * Staff Clock Modal
 * -----------------
 * Allows admin/manager to clock in or out on behalf of a staff member,
 * e.g. when the employee has lost their phone or forgot it at home.
 * All proxy actions are flagged as manual overrides and audit-logged
 * server-side with the acting user's identity.
 */

import { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut, Search, UserRound, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { employeeApi, timeEntryApi, type Employee, type TimeEntry, ApiError } from '../../services/api';
import {
  Badge, Button, Input, Label, Modal, Select, Spinner, Textarea,
} from '../ui';
import { formatTime } from '../../lib/utils';

interface StaffClockModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful proxy clock-in/out so the parent can refresh. */
  onDone?: () => void;
}

export default function StaffClockModal({ open, onClose, onDone }: StaffClockModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedEmail, setSelectedEmail] = useState('');
  const [activeSession, setActiveSession] = useState<TimeEntry | null>(null);
  const [checkingSession, setCheckingSession] = useState(false);
  const [justification, setJustification] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('0');
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
      setSelectedEmail('');
      setActiveSession(null);
      setJustification('');
      setBreakMinutes('0');
      setSearch('');
    }
  }, [open]);

  // Check the selected employee's active session
  const checkSession = useCallback(async (email: string) => {
    if (!email) {
      setActiveSession(null);
      return;
    }
    setCheckingSession(true);
    try {
      const res = await timeEntryApi.active(email);
      setActiveSession(res.active);
    } catch (err) {
      console.error(err);
      setActiveSession(null);
    } finally {
      setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    checkSession(selectedEmail);
  }, [selectedEmail, checkSession]);

  const selectedEmployee = employees.find((e) => e.email === selectedEmail) ?? null;

  const filtered = employees.filter((e) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      `${e.firstName} ${e.surname}`.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      (e.employeeNumber ?? '').toLowerCase().includes(q)
    );
  });

  const handleProxyClockIn = async () => {
    if (!selectedEmployee) return;
    setBusy(true);
    try {
      await timeEntryApi.clockIn(
        undefined,
        undefined,
        selectedEmployee.email,
        justification.trim() || `Proxy clock-in: staff phone unavailable (${selectedEmployee.firstName} ${selectedEmployee.surname})`,
      );
      toast.success(`${selectedEmployee.firstName} ${selectedEmployee.surname} clocked in successfully`);
      setJustification('');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Proxy clock-in failed');
    } finally {
      setBusy(false);
    }
  };

  const handleProxyClockOut = async () => {
    if (!selectedEmployee) return;
    setBusy(true);
    try {
      const parsed = parseInt(breakMinutes, 10);
      const mins = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      await timeEntryApi.clockOut(mins, undefined, undefined, selectedEmployee.email);
      toast.success(`${selectedEmployee.firstName} ${selectedEmployee.surname} clocked out successfully`);
      setBreakMinutes('0');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Proxy clock-out failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Clock On Behalf of Staff" wide>
      <div className="space-y-5">
        {/* Context notice */}
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-amber-700 dark:text-amber-400">
            Use this when a staff member cannot clock in or out themselves (e.g. lost or forgotten
            phone). This action bypasses geofence validation and is recorded in the audit trail
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

        {/* Employee selection */}
        <div className="space-y-2">
          <Label htmlFor="staff-select">Staff member</Label>
          {loadingEmployees ? (
            <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Loading employees…
            </div>
          ) : (
            <Select
              id="staff-select"
              value={selectedEmail}
              onChange={(e) => setSelectedEmail(e.target.value)}
            >
              <option value="">— Select staff member —</option>
              {filtered.map((e) => (
                <option key={e.id} value={e.email}>
                  {e.surname}, {e.firstName} · {e.branch} / {e.department}
                  {e.employeeNumber ? ` · #${e.employeeNumber}` : ''}
                </option>
              ))}
            </Select>
          )}
        </div>

        {/* Selected employee summary + session status */}
        {selectedEmployee && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand">
                <UserRound className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold">
                  {selectedEmployee.firstName} {selectedEmployee.surname}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {selectedEmployee.email} · {selectedEmployee.position || 'No position'}
                </p>
              </div>
              <div className="ml-auto">
                {checkingSession ? (
                  <Spinner className="h-4 w-4" />
                ) : activeSession ? (
                  <Badge variant="success">Clocked in</Badge>
                ) : (
                  <Badge variant="secondary">Not clocked in</Badge>
                )}
              </div>
            </div>

            {activeSession && (
              <p className="text-sm text-muted-foreground">
                Active session started at <span className="font-medium text-foreground">{formatTime(activeSession.clockIn)}</span>
                {activeSession.geofenceName ? ` · ${activeSession.geofenceName}` : ''}
              </p>
            )}

            {/* Justification (required context for the audit trail) */}
            <div className="space-y-2">
              <Label htmlFor="proxy-justification">Reason (recorded in audit log)</Label>
              <Textarea
                id="proxy-justification"
                placeholder="e.g. Employee forgot phone at home / phone battery died…"
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                maxLength={500}
              />
            </div>

            {/* Actions: show clock-in OR clock-out depending on session state */}
            {activeSession ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="proxy-break">Break minutes</Label>
                  <Input
                    id="proxy-break"
                    type="number"
                    min="0"
                    max="720"
                    step="5"
                    value={breakMinutes}
                    onChange={(e) => setBreakMinutes(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleProxyClockOut}
                  disabled={busy}
                  className="w-full bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white"
                >
                  <LogOut className="h-4 w-4" />
                  {busy ? 'Clocking out…' : `Clock Out ${selectedEmployee.firstName}`}
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleProxyClockIn}
                disabled={busy}
                className="w-full bg-gradient-to-r from-brand to-brand-light hover:from-brand-dark hover:to-brand text-white"
              >
                <LogIn className="h-4 w-4" />
                {busy ? 'Clocking in…' : `Clock In ${selectedEmployee.firstName}`}
              </Button>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}