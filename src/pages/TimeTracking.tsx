/**
 * Time Tracking Page
 * ------------------
 * Self-service clock in/out with geofence, live session timer,
 * break tracking, and recent entries table.
 * Role-aware: employees see their own entries; managers/admins see team entries.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LogIn,
  LogOut,
  MapPin,
  Clock,
  History,
  UserRound,
  CalendarPlus,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { timeEntryApi, type TimeEntry, ApiError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../hooks/useSSE';
import { MyWorkLocation } from '../components/location/MyWorkLocation';
import { isAutoClockEligible, useAutoGeofenceState } from '../hooks/useAutoGeofence';
import StaffClockModal from '../components/time/StaffClockModal';
import ManualTimeEntryModal from '../components/time/ManualTimeEntryModal';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Modal,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui';
import { formatDate, formatTime, formatHours } from '../lib/utils';
import { getCurrentPosition } from '../utils/clockInHelper';

export default function TimeTracking() {
  const { user } = useAuth();
  const [active, setActive] = useState<TimeEntry | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());

  // ── Clock-out modal state (replaces browser prompt for break minutes) ──
  const [showClockOutModal, setShowClockOutModal] = useState(false);
  const [breakInput, setBreakInput] = useState('0');

  // ── Proxy clock modal (admin/manager clock on behalf of staff) ──
  const [showStaffClockModal, setShowStaffClockModal] = useState(false);
  const canClockOnBehalf =
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'master';

  // ── Manual time entry modal (backdated hours for a previous date) ──
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);

  // ── Spec §5 self-delete + spec §7 duplicate resolution ──
  const [searchParams, setSearchParams] = useSearchParams();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicateEntry, setDuplicateEntry] = useState<TimeEntry | null>(null);
  const [resolving, setResolving] = useState(false);
  // Resolving a duplicate DELETES a payroll-relevant row, so it stays a
  // supervisory action — employees see the red warning and ask a manager.
  const canResolveDuplicates = canClockOnBehalf;

  // ── Auto-geofence toggle state (read-only) for the not-clocked-in card ──
  const autoGeo = useAutoGeofenceState(user ? `${user.email}:${user.role}` : undefined);

  const load = useCallback(async () => {
    try {
      const [a, list] = await Promise.all([
        timeEntryApi.active(),
        timeEntryApi.list({ limit: 50 }),
      ]);
      setActive(a.active);
      setEntries(list.items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Tick for live timer
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useSSE(
    useCallback(
      (event) => {
        if (event.type === 'entity_event' && event.entity === 'TimeEntry') load();
      },
      [load],
    ),
  );

  // Spec §3 "View Details" deep link: /time?entry=<id> from the Notification
  // Centre opens the duplicate-resolution modal for that entry. The param is
  // cleared afterwards so a refresh does not re-open a stale modal.
  useEffect(() => {
    const entryId = searchParams.get('entry');
    if (!entryId || loading) return;
    const match = entries.find((e) => e.id === entryId);
    searchParams.delete('entry');
    setSearchParams(searchParams, { replace: true });
    if (match?.isFlaggedDuplicate) setDuplicateEntry(match);
  }, [searchParams, setSearchParams, entries, loading]);

  /**
   * Spec §5 — delete a time entry. Employees may remove their OWN entry within
   * the self-service window (default 24 h); the server owns that decision and
   * returns a human-readable reason, which we surface verbatim rather than
   * duplicating (and drifting from) the rule on the client.
   */
  const handleDeleteEntry = async (entry: TimeEntry) => {
    const when = `${formatDate(entry.date)} at ${formatTime(entry.clockIn)}`;
    if (!window.confirm(`Delete this time entry (${when})?\n\nThis cannot be undone.`)) return;
    setDeletingId(entry.id);
    try {
      await timeEntryApi.remove(entry.id);
      toast.success('Time entry deleted');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the time entry');
    } finally {
      setDeletingId(null);
    }
  };

  /** Spec §7 Option A — keep the first punch, discard the flagged duplicate. */
  const handleResolveDuplicate = async () => {
    if (!duplicateEntry) return;
    setResolving(true);
    try {
      await timeEntryApi.resolveDuplicate(duplicateEntry.id);
      toast.success('Duplicate punch resolved — the first punch was kept.');
      setDuplicateEntry(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not resolve the duplicate punch');
    } finally {
      setResolving(false);
    }
  };

  /** An open session must be clocked out, not deleted — mirrors the server rule. */
  const canDeleteEntry = (entry: TimeEntry): boolean => entry.status !== 'active';

  const handleClockIn = async () => {
    setBusy(true);
    try {
      // GPS-stabilized geolocation: unstable readings are ignored and, on
      // poor signal, the last reliable position is used (optional — falls
      // back to clocking in without coordinates when nothing is available).
      const pos = await getCurrentPosition({ timeoutMs: 5000 });
      await timeEntryApi.clockIn(pos?.latitude, pos?.longitude);
      toast.success('Clocked in successfully');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Clock-in failed');
    } finally {
      setBusy(false);
    }
  };

  const openClockOutModal = () => {
    setBreakInput('0');
    setShowClockOutModal(true);
  };

  const confirmClockOut = async () => {
    setBusy(true);
    try {
      const parsed = parseInt(breakInput, 10);
      const breakMinutes = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      await timeEntryApi.clockOut(breakMinutes);
      toast.success('Clocked out successfully');
      setShowClockOutModal(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Clock-out failed');
    } finally {
      setBusy(false);
    }
  };

  // Elapsed time for active session
  let elapsed = '';
  if (active) {
    const ms = now.getTime() - new Date(active.clockIn).getTime();
    const hrs = Math.floor(ms / 3_600_000);
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    const secs = Math.floor((ms % 60_000) / 1000);
    elapsed = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-5 h-5 text-brand" />
            <h1 className="text-2xl font-bold">Time Tracking</h1>
          </div>
          <p className="text-sm text-muted-foreground">Clock in and out of your work sessions</p>
        </div>
        {canClockOnBehalf && (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setShowStaffClockModal(true)}
              variant="outline"
              className="border-brand/30 text-brand hover:bg-brand/10 rounded-xl"
            >
              <UserRound className="h-4 w-4" /> Clock On Behalf of Staff
            </Button>
            <Button
              onClick={() => setShowManualEntryModal(true)}
              variant="outline"
              className="border-brand/30 text-brand hover:bg-brand/10 rounded-xl"
            >
              <CalendarPlus className="h-4 w-4" /> Add Manual Time Entry
            </Button>
          </div>
        )}
      </div>

      {/* Clock in/out card */}
      <Card className="relative overflow-hidden border-border/50 shadow-card">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand to-brand-light" />
        <CardContent className="flex flex-col items-center gap-5 p-8">
          {active ? (
            <>
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                <Badge variant="success" className="px-3 py-1 text-sm">
                  Currently Working
                </Badge>
              </div>
              <p className="font-mono text-6xl font-bold tabular-nums tracking-tight">{elapsed}</p>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" />
                Started at {formatTime(active.clockIn)}
                {active.geofenceName && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {active.geofenceName}
                  </span>
                )}
              </p>
              <motion.div whileTap={{ scale: 0.97 }}>
                <Button
                  size="lg"
                  onClick={openClockOutModal}
                  disabled={busy}
                  className="h-14 px-10 text-base font-semibold bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-lg shadow-red-500/25 rounded-xl"
                >
                  <LogOut className="h-5 w-5" /> Clock Out
                </Button>
              </motion.div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-secondary/50 flex items-center justify-center mb-2">
                <Clock className="w-8 h-8 text-muted-foreground/50" />
              </div>
              <p className="text-lg font-semibold">You are not clocked in</p>
              <p className="text-sm text-muted-foreground">
                {user?.branch ? `Branch: ${user.branch}` : 'Start your work session'}
              </p>
              <motion.div whileTap={{ scale: 0.97 }}>
                <Button
                  size="lg"
                  onClick={handleClockIn}
                  disabled={busy}
                  className="h-14 px-10 text-base font-semibold bg-gradient-to-r from-brand to-brand-light hover:from-brand-dark hover:to-brand text-white shadow-lg shadow-brand/25 rounded-xl"
                >
                  <LogIn className="h-5 w-5" /> {busy ? 'Clocking in…' : 'Clock In'}
                </Button>
              </motion.div>
            </>
          )}
          <Badge
            variant={
              isAutoClockEligible(user) && autoGeo.autoGeofenceEnabled ? 'success' : 'secondary'
            }
            className="px-2.5 py-0.5 text-xs"
            title="Device setting only. ON does not confirm that background monitoring is running."
          >
            Auto-Geofence{' '}
            {!isAutoClockEligible(user)
              ? 'not applicable'
              : autoGeo.autoGeofenceEnabled
                ? 'ON'
                : 'OFF'}
          </Badge>
        </CardContent>
      </Card>

      {/* My Work Location — available to all roles.
          Only admin/master can add locations; managers and employees get read-only view.
          Managers can change employee locations via Workforce, but cannot create new locations. */}
      <MyWorkLocation
        canAddLocation={user?.role === 'admin' || user?.role === 'master'}
        clockedIn={loading ? undefined : !!active}
      />

      {/* Recent entries */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="w-4 h-4 text-brand" />
            Recent Time Entries
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : entries.length === 0 ? (
            <EmptyState message="No time entries yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {/* Employee column only for manager/admin/master — they see team entries */}
                  {user?.role !== 'employee' && <TableHead>Employee</TableHead>}
                  <TableHead>Date</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Break</TableHead>
                  <TableHead>Total Hours</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow
                    key={e.id}
                    // Spec §7: a flagged duplicate renders red with a warning
                    // icon so it cannot be missed during payroll review.
                    className={
                      e.isFlaggedDuplicate
                        ? 'bg-red-500/10 hover:bg-red-500/15 border-l-2 border-l-red-500'
                        : undefined
                    }
                    data-testid={e.isFlaggedDuplicate ? `entry-row-duplicate-${e.id}` : undefined}
                  >
                    {user?.role !== 'employee' && (
                      <TableCell className="font-medium">
                        {e.employeeName || e.employeeEmail}
                      </TableCell>
                    )}
                    <TableCell>{formatDate(e.date)}</TableCell>
                    <TableCell>{formatTime(e.clockIn)}</TableCell>
                    <TableCell>{e.clockOut ? formatTime(e.clockOut) : '—'}</TableCell>
                    <TableCell>{e.breakMinutes != null ? `${e.breakMinutes}m` : '—'}</TableCell>
                    <TableCell className="font-medium">{formatHours(e.totalHours)}</TableCell>
                    <TableCell>{e.geofenceName || '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant={e.status === 'active' ? 'success' : 'secondary'}>
                          {e.status}
                        </Badge>
                        {e.isManuallyAdjusted && (
                          <Badge variant="warning" title={e.adjustmentReason ?? undefined}>
                            manual
                          </Badge>
                        )}
                        {e.isFlaggedDuplicate && (
                          <Badge
                            variant="destructive"
                            title="Two punches landed within the duplicate window. Review before payroll."
                          >
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            possible duplicate
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {e.isFlaggedDuplicate && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            data-testid={`resolve-duplicate-${e.id}`}
                            onClick={() => setDuplicateEntry(e)}
                            title={
                              canResolveDuplicates
                                ? 'Review and resolve this duplicate punch'
                                : 'Ask a manager to resolve this duplicate punch'
                            }
                          >
                            Review
                          </Button>
                        )}
                        {canDeleteEntry(e) && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="text-muted-foreground hover:text-red-600"
                            data-testid={`delete-entry-${e.id}`}
                            disabled={deletingId === e.id}
                            onClick={() => void handleDeleteEntry(e)}
                            title="Delete this time entry (own entries within 24 h)"
                            aria-label={`Delete time entry for ${formatDate(e.date)}`}
                          >
                            {deletingId === e.id ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Proxy clock modal — admin/manager clock in/out on behalf of staff */}
      {canClockOnBehalf && (
        <StaffClockModal
          open={showStaffClockModal}
          onClose={() => setShowStaffClockModal(false)}
          onDone={load}
        />
      )}

      {/* Manual time entry modal — backdated hours for a previous date */}
      {canClockOnBehalf && (
        <ManualTimeEntryModal
          open={showManualEntryModal}
          onClose={() => setShowManualEntryModal(false)}
          onDone={load}
        />
      )}

      {/* Clock-out modal — break minutes input (replaces browser prompt) */}
      <Modal
        open={showClockOutModal}
        onClose={() => !busy && setShowClockOutModal(false)}
        title="Clock Out"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Session started at {active ? formatTime(active.clockIn) : '—'} · Elapsed{' '}
            {elapsed || '—'}
          </p>
          <div className="space-y-2">
            <Label htmlFor="break-minutes">Break minutes (optional)</Label>
            <Input
              id="break-minutes"
              type="number"
              min="0"
              max="480"
              step="5"
              value={breakInput}
              onChange={(e) => setBreakInput(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              {[0, 15, 30, 60].map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={breakInput === String(m) ? 'default' : 'outline'}
                  onClick={() => setBreakInput(String(m))}
                >
                  {m === 0 ? 'No break' : `${m}m`}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowClockOutModal(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={confirmClockOut}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <LogOut className="h-4 w-4" /> {busy ? 'Clocking out…' : 'Confirm Clock Out'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Spec §7 — duplicate punch resolution modal */}
      <Modal
        open={duplicateEntry !== null}
        onClose={() => !resolving && setDuplicateEntry(null)}
        title="Possible duplicate punch"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div className="text-sm space-y-1">
              <p className="font-semibold text-red-600">
                Two punches were recorded within the duplicate window.
              </p>
              <p className="text-muted-foreground">
                {duplicateEntry?.employeeName || duplicateEntry?.employeeEmail} ·{' '}
                {duplicateEntry ? formatDate(duplicateEntry.date) : ''} · clocked in{' '}
                {duplicateEntry ? formatTime(duplicateEntry.clockIn) : ''}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Double punches usually happen when the app is tapped twice, or when an offline punch
            syncs after you have already clocked in. You only need to clock in <strong>once</strong>{' '}
            — a second tap does not add hours, it creates a record that payroll must clean up.
          </p>

          {canResolveDuplicates ? (
            <div className="space-y-2">
              <Button
                type="button"
                className="w-full"
                disabled={resolving}
                data-testid="duplicate-option-a"
                onClick={() => void handleResolveDuplicate()}
              >
                {resolving ? 'Resolving…' : 'Option A — Keep the first punch (recommended)'}
              </Button>
              <p className="text-[11px] text-muted-foreground px-1">
                Discards the flagged duplicate and keeps the earlier punch. This is audited.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={resolving}
                data-testid="duplicate-option-b"
                onClick={() => {
                  setDuplicateEntry(null);
                  toast.info(
                    'Option B: adjust both entries from Reports → Attendance, then resolve the flag.',
                  );
                }}
              >
                Option B — Manually adjust both entries
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">
                Only a manager or administrator can resolve a duplicate punch. Please contact them —
                your hours are safe and the earlier punch is kept.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setDuplicateEntry(null)}
              >
                Close
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
