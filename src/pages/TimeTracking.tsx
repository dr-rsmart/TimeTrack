/**
 * Time Tracking Page
 * ------------------
 * Self-service clock in/out with geofence, live session timer,
 * break tracking, and recent entries table.
 * Role-aware: employees see their own entries; managers/admins see team entries.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { LogIn, LogOut, MapPin, Clock, Coffee, History, UserRound, CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';
import { timeEntryApi, type TimeEntry, ApiError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../hooks/useSSE';
import { MyWorkLocation } from '../components/location/MyWorkLocation';
import StaffClockModal from '../components/time/StaffClockModal';
import ManualTimeEntryModal from '../components/time/ManualTimeEntryModal';
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState,
  Input, Label, Modal,
  Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
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
  const canClockOnBehalf = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'master';

  // ── Manual time entry modal (backdated hours for a previous date) ──
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);


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
                <Badge variant="success" className="px-3 py-1 text-sm">Currently Working</Badge>
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
                {user?.branch ? `Assigned location: ${user.branch}` : 'Start your work session'}
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
        </CardContent>
      </Card>

      {/* My Work Location — available to all roles.
          Only admin/master can add locations; managers and employees get read-only view.
          Managers can change employee locations via Workforce, but cannot create new locations. */}
      <MyWorkLocation canAddLocation={user?.role === 'admin' || user?.role === 'master'} />

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
            <div className="flex h-32 items-center justify-center"><Spinner /></div>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
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
                      <div className="flex items-center gap-1.5">
                        <Badge variant={e.status === 'active' ? 'success' : 'secondary'}>{e.status}</Badge>
                        {e.isManuallyAdjusted && (
                          <Badge variant="warning" title={e.adjustmentReason ?? undefined}>manual</Badge>
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
      <Modal open={showClockOutModal} onClose={() => !busy && setShowClockOutModal(false)} title="Clock Out">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Session started at {active ? formatTime(active.clockIn) : '—'} · Elapsed {elapsed || '—'}
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
            <Button onClick={confirmClockOut} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white">
              <LogOut className="h-4 w-4" /> {busy ? 'Clocking out…' : 'Confirm Clock Out'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
