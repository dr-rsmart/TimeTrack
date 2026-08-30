/**
 * Auto Geofence Monitor — app-shell level OWNER of auto clock-in/out.
 * ------------------------------------------------------------------
 * Mounted once inside RequireAuth (App.tsx) so geofence monitoring:
 *   • starts as soon as the user signs in (no need to visit the dashboard),
 *   • survives client-side page navigation (previously the widget unmounted
 *     and monitoring stopped whenever the user left the dashboard),
 *   • is owned by exactly one component — UI widgets consume state via the
 *     read-only useAutoGeofenceState hook so events never double-fire.
 *
 * Clock state is kept fresh four ways: initial load, the AUTO_CLOCK_EVENT
 * window event (fired after each auto punch), SSE timeEntry broadcasts, and
 * a 60s safety poll.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { timeEntryApi, type TimeEntry } from '../../services/api';
import { useAutoGeofence, AUTO_CLOCK_EVENT, isAutoClockEligible } from '../../hooks/useAutoGeofence';
import { useSSE } from '../../hooks/useSSE';
import { checkGpsAvailability } from '../../utils/clockInHelper';

export default function AutoGeofenceMonitor() {
  const { user } = useAuth();
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [gpsAvailable] = useState<boolean>(() => checkGpsAvailability().available);

  // ── Keep the active clock-in session fresh ──
  const loadActive = useCallback(async () => {
    try {
      const res = await timeEntryApi.active();
      setActiveEntry(res.active);
    } catch {
      /* Session probe failed (transient) — keep the last known state. */
    }
  }, []);

  useEffect(() => {
    loadActive();
  }, [loadActive]);

  // Refresh immediately after every completed auto punch.
  useEffect(() => {
    const handler = () => loadActive();
    window.addEventListener(AUTO_CLOCK_EVENT, handler);
    return () => window.removeEventListener(AUTO_CLOCK_EVENT, handler);
  }, [loadActive]);

  // Realtime: any timeEntry broadcast (manual punches, bulk ops, cron closes).
  useSSE((event) => {
    if (event.entity === 'timeEntry') loadActive();
  });

  // Safety poll in case SSE is unavailable.
  useEffect(() => {
    const iv = setInterval(loadActive, 60_000);
    return () => clearInterval(iv);
  }, [loadActive]);

  // ── Own the auto-geofence hook ──
  // Auto clock-in/out NEVER applies to master accounts — including demo and
  // impersonation sessions a master operates (originalRole === 'master'), so
  // a master driving a persona never creates attendance records for it.
  // Genuine tenant personas (employee, admin, manager) get monitoring.
  // Widgets refresh themselves via AUTO_CLOCK_EVENT, so no callbacks needed.
  useAutoGeofence({
    userEmail: user?.email ?? null,
    isClockedIn: Boolean(activeEntry),
    activeEntryId: activeEntry?.id ?? null,
    activeEntry: (activeEntry as Record<string, unknown> | null) ?? null,
    onClockIn: async () => undefined,
    onClockOut: async () => undefined,
    enabled: gpsAvailable && isAutoClockEligible(user),
  });

  return null;
}