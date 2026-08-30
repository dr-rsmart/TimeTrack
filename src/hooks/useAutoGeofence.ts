/**
 * useAutoGeofence — React hook for auto clock-in/out based on geofence boundaries.
 *
 * Integrates AutoGeofenceService with the clocking state machine and API.
 * When the user enters their assigned geofence, it auto-clocks them in.
 * When they leave, it auto-clocks them out and sends a notification.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  autoGeofenceService,
  type GeofenceDefinition,
  type AutoGeofenceEvent,
  type AutoGeofenceState,
} from '../services/AutoGeofenceService';
import { authApi, employeeApi, timeEntryApi, settingsApi } from '../services/api';
import { getCurrentPosition } from '../utils/clockInHelper';
import { useSSE } from './useSSE';

/** How often the geofence assignment is re-fetched as a safety net (SSE covers most updates instantly). */
const GEOFENCE_REFRESH_INTERVAL_MS = 5 * 60_000;

// ─────────────────────────────────────────────────────────────
// Local Storage Keys
// ─────────────────────────────────────────────────────────────

const AUTO_GEOFENCE_ENABLED_KEY = 'timetrack_auto_geofence_enabled';
const LOCATION_PERMISSION_ASKED_KEY = 'timetrack_location_permission_asked';
const LAST_AUTO_CLOCK_IN_KEY = 'timetrack_last_auto_clock_in';
const LAST_AUTO_CLOCK_OUT_KEY = 'timetrack_last_auto_clock_out';

// ─────────────────────────────────────────────────────────────
// Local Storage Helpers
// ─────────────────────────────────────────────────────────────

export function getAutoGeofenceEnabled(): boolean {
  try {
    const val = localStorage.getItem(AUTO_GEOFENCE_ENABLED_KEY);
    if (val === null) return true;
    return val === 'true';
  } catch {
    return true;
  }
}

export function setAutoGeofenceEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_GEOFENCE_ENABLED_KEY, String(enabled));
  } catch { /* ignore */ }
}

export function getLocationPermissionAsked(): boolean {
  try {
    return localStorage.getItem(LOCATION_PERMISSION_ASKED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setLocationPermissionAsked(): void {
  try {
    localStorage.setItem(LOCATION_PERMISSION_ASKED_KEY, 'true');
  } catch { /* ignore */ }
}

function setLastAutoClockIn(entryId: string): void {
  try {
    localStorage.setItem(LAST_AUTO_CLOCK_IN_KEY, JSON.stringify({ entryId, timestamp: Date.now() }));
  } catch { /* ignore */ }
}

function setLastAutoClockOut(): void {
  try {
    localStorage.setItem(LAST_AUTO_CLOCK_OUT_KEY, JSON.stringify({ timestamp: Date.now() }));
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────
// Auto-clock eligibility (role rules)
// ─────────────────────────────────────────────────────────────

/**
 * Auto clock-in/out NEVER applies to master accounts — including sessions a
 * master operates indirectly:
 *   • pure master sessions (`role === 'master'`),
 *   • demo-persona sessions (`originalRole === 'master'`, `demoEmail` set —
 *     the JWT role is the simulated persona's role),
 *   • impersonation sessions (`originalRole === 'master'`, role 'admin').
 * A master driving a persona around a site must not create attendance
 * records for that persona. Genuine tenant users (employee/admin/manager)
 * are eligible.
 */
export function isAutoClockEligible(
  user: { role: string; originalRole?: string | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role === 'master') return false;
  if (user.originalRole === 'master') return false; // demo persona / impersonation
  return true;
}

// ─────────────────────────────────────────────────────────────
// Notification Helpers
// ─────────────────────────────────────────────────────────────

function sendNotification(title: string, body: string): void {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico', tag: `${title}-${Date.now()}` });
  }
}

// ─────────────────────────────────────────────────────────────
// Native Shell Bridge (mobile app)
// ─────────────────────────────────────────────────────────────
// The React Native shell (mobile/App.js) injects `window.ReactNativeWebView`
// into the WebView. We forward the geofence assignment, clock state and auth
// token so the NATIVE background task can auto clock in/out even when the
// WebView is suspended. In a plain browser this is a silent no-op.

export function postToNativeShell(message: Record<string, unknown>): void {
  try {
    const shell = (window as unknown as { ReactNativeWebView?: { postMessage?: (msg: string) => void } })
      .ReactNativeWebView;
    shell?.postMessage?.(JSON.stringify(message));
  } catch {
    /* Never let bridge failures affect the web app. */
  }
}

export function isNativeShellPresent(): boolean {
  try {
    return typeof (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView !== 'undefined';
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Auto-clock completion event (consumed by UI widgets for refresh)
// ─────────────────────────────────────────────────────────────

export const AUTO_CLOCK_EVENT = 'timetrack:auto-clock';

/** Dispatched on window after a successful auto clock-in/out API call. */
export function dispatchAutoClockCompleted(kind: 'in' | 'out'): void {
  try {
    window.dispatchEvent(new CustomEvent(AUTO_CLOCK_EVENT, { detail: { kind } }));
  } catch {
    /* ignore */
  }
}

// Simple toast notification helper
function showToast(type: 'success' | 'error' | 'info', title: string, description?: string): void {
  const el = document.createElement('div');
  const bgColor = type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600';
  el.className = `fixed bottom-4 right-4 z-50 ${bgColor} text-white rounded-lg shadow-xl p-4 max-w-sm`;
  el.innerHTML = `<div class="font-semibold">${title}</div>${description ? `<div class="text-sm opacity-90 mt-1">${description}</div>` : ''}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ─────────────────────────────────────────────────────────────
// Hook Types & Interface
// ─────────────────────────────────────────────────────────────

export interface UseAutoGeofenceOptions {
  userEmail: string | null | undefined;
  isClockedIn: boolean;
  activeEntryId: string | null;
  activeEntry?: Record<string, unknown> | null;
  onClockIn: () => Promise<void>;
  onClockOut: () => Promise<void>;
  enabled?: boolean;
}

export interface UseAutoGeofenceReturn {
  isAutoGeofenceActive: boolean;
  isInsideGeofence: boolean;
  geofence: GeofenceDefinition | null;
  monitorState: AutoGeofenceState | null;
  toggleAutoGeofence: () => void;
  /** Restart monitoring with the current geofence (e.g. after permission re-grant). */
  restartMonitoring: () => void;
  autoGeofenceEnabled: boolean;
  error: string | null;
}

// ─────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────

export function useAutoGeofence(options: UseAutoGeofenceOptions): UseAutoGeofenceReturn {
  const { userEmail, isClockedIn, activeEntryId, activeEntry, onClockIn, onClockOut, enabled = true } = options;

  const [autoGeofenceEnabled, setAutoGeofenceEnabledState] = useState(() => getAutoGeofenceEnabled());
  /** All assigned work locations being monitored (multi-location employees). */
  const [geofences, setGeofences] = useState<GeofenceDefinition[]>([]);
  /** Primary monitoring target (first assigned location) — display/compat. */
  const geofence = geofences.length > 0 ? geofences[0] : null;
  const [monitorState, setMonitorState] = useState<AutoGeofenceState | null>(null);
  const [isInsideGeofence, setIsInsideGeofence] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClockedInRef = useRef(isClockedIn);
  isClockedInRef.current = isClockedIn;
  const activeEntryRef = useRef(activeEntry);
  activeEntryRef.current = activeEntry;
  const onClockInRef = useRef(onClockIn);
  onClockInRef.current = onClockIn;
  const onClockOutRef = useRef(onClockOut);
  onClockOutRef.current = onClockOut;
  const autoGeofenceEnabledRef = useRef(autoGeofenceEnabled);
  autoGeofenceEnabledRef.current = autoGeofenceEnabled;

  // ── Sync active clocked-in state with background service + native shell ──
  useEffect(() => {
    autoGeofenceService.syncClockedIn(isClockedIn);
    // Keep the native background task's clock state in sync so it knows
    // whether to clock in or out on the next geofence boundary crossing.
    // Only for eligible sessions — master/demo sessions never touch the
    // native clocking state.
    if (enabled) {
      postToNativeShell({ type: 'CLOCK_STATE', clockedIn: isClockedIn });
    }
  }, [isClockedIn, enabled]);

  // ── Fetch the employee's assigned geofence(s) — multi-location aware ──
  //
  // Assigned employees are monitored against ALL their assigned locations:
  // auto clock-in inside ANY of them, auto clock-out only when OUTSIDE ALL.
  // UNASSIGNED employees ("No Geo Location Assigned") are NOT monitored —
  // they have no location restriction for clocking (server-side), so tying
  // their auto punches to an arbitrary company site would be wrong.

  const fetchGeofences = useCallback(async () => {
    if (!enabled || !userEmail) return;
    try {
      // Employee-accessible endpoint /api/settings/geofences/my
      const myData = await settingsApi.getMyGeofences().catch(() => null);
      let targets: GeofenceDefinition[] = [];

      if (myData && myData.geofences) {
        const assignedIds: string[] =
          myData.employee?.geofenceIds ?? (myData.employee?.geofenceId ? [myData.employee.geofenceId] : []);
        targets = myData.geofences
          .filter((g) => g.isActive && assignedIds.includes(g.id))
          .map((g) => ({
            id: g.id,
            name: g.name,
            address: g.address,
            latitude: g.latitude,
            longitude: g.longitude,
            radius_meters: g.radiusMeters,
            is_active: g.isActive,
          }));
      }

      setGeofences(targets);
      setError(null);

      // Forward the FULL assignment list to the native shell so its
      // background task can monitor every location while the WebView is
      // suspended. `geofence` (single) is kept for older app builds.
      if (targets.length > 0) {
        postToNativeShell({
          type: 'GEOFENCE_ASSIGNED',
          geofence: {
            id: targets[0].id,
            name: targets[0].name,
            latitude: targets[0].latitude,
            longitude: targets[0].longitude,
            radiusMeters: targets[0].radius_meters,
          },
          geofences: targets.map((t) => ({
            id: t.id,
            name: t.name,
            latitude: t.latitude,
            longitude: t.longitude,
            radiusMeters: t.radius_meters,
          })),
        });
      } else {
        // Assignment removed — tell the native shell to stop geofence
        // monitoring (new builds clear any stale stored location).
        postToNativeShell({ type: 'GEOFENCE_ASSIGNED', geofence: null, geofences: [] });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[useAutoGeofence] Failed to fetch geofences:', err);
      setError(`Failed to load geofence data: ${message}`);
    }
  }, [enabled, userEmail]);

  // Initial load + refresh whenever the session/target changes.
  useEffect(() => {
    if (!enabled || !userEmail) {
      setGeofences([]);
      return;
    }
    void fetchGeofences();
  }, [enabled, userEmail, fetchGeofences]);

  // Realtime refresh: admin reassignment broadcasts (geofence entity).
  useSSE((event) => {
    if (event.entity === 'geofence') void fetchGeofences();
  });

  // Safety-net periodic refresh in case SSE is unavailable.
  useEffect(() => {
    if (!enabled || !userEmail) return;
    const iv = setInterval(() => { void fetchGeofences(); }, GEOFENCE_REFRESH_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [enabled, userEmail, fetchGeofences]);

  // ── Start/stop monitoring ──

  // Key on the geofence ID set so identical re-fetches (SSE/poll) don't tear
  // down and restart the position watch unnecessarily.
  const geofenceIdsKey = geofences.map((g) => g.id).join('|');

  useEffect(() => {
    if (!enabled || geofences.length === 0 || !autoGeofenceEnabled) {
      autoGeofenceService.stopMonitoring();
      return;
    }
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    // startMonitoring seeds the boundary state from the live clock state:
    // clocked-in users are treated as INSIDE (reliable auto clock-out), and
    // signed-out users get an immediate auto clock-in on the first good fix
    // inside ANY assigned geofence (unless the awaiting-exit guard is armed).
    autoGeofenceService.startMonitoring(geofences, isClockedInRef.current);
    return () => { autoGeofenceService.stopMonitoring(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geofenceIdsKey, autoGeofenceEnabled]);

  // ── Listen for state changes ──

  useEffect(() => {
    const unsubscribe = autoGeofenceService.onStateChange((state: AutoGeofenceState) => {
      setMonitorState(state);
      setIsInsideGeofence(state.isInsideGeofence);
      if (state.error) setError(state.error);
    });
    return unsubscribe;
  }, []);

  // ── Handle geofence events ──

  useEffect(() => {
    const unsubscribe = autoGeofenceService.onEvent(async (event: AutoGeofenceEvent) => {
      if (!autoGeofenceEnabledRef.current) return;

      if (event.type === 'ENTERED_GEOFENCE' && event.geofence && !isClockedInRef.current) {
        try {
          const pos = event.position || (await getCurrentPosition());
          const result = await timeEntryApi.clockIn(pos?.latitude, pos?.longitude, userEmail ?? undefined);
          if (result?.id) {
            setLastAutoClockIn(result.id);
            await onClockInRef.current();
            dispatchAutoClockCompleted('in');
            sendNotification('Auto Clock In', `You entered "${event.geofence.name}".`);
            showToast('success', `Auto clocked in at "${event.geofence.name}"`, `~${event.distanceMetres ?? 0}m from centre.`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          if (!msg.toLowerCase().includes('already clocked')) {
            showToast('error', 'Auto clock-in failed', msg);
          }
        }
      } else if (event.type === 'EXITED_GEOFENCE' && event.geofence && isClockedInRef.current) {
        try {
          const pos = event.position || (await getCurrentPosition());
          await timeEntryApi.clockOut(0, pos?.latitude, pos?.longitude, userEmail ?? undefined);
          setLastAutoClockOut();
          await onClockOutRef.current();
          dispatchAutoClockCompleted('out');
          sendNotification('Auto Clock Out', `You left "${event.geofence.name}".`);
          showToast('success', `Auto clocked out — left "${event.geofence.name}"`, `~${event.distanceMetres ?? 0}m from centre.`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          if (msg.toLowerCase().includes('no active')) {
            // Session was already closed server-side — most commonly the
            // shift-end auto clock-out. Sync local state and inform instead
            // of surfacing a failure.
            setLastAutoClockOut();
            await onClockOutRef.current();
            dispatchAutoClockCompleted('out');
            showToast('info', 'Shift already closed', 'You were automatically clocked out at the scheduled shift end.');
          } else {
            showToast('error', 'Auto clock-out failed', msg);
          }
        }
      }
    });
    return unsubscribe;
  }, [userEmail, onClockIn, onClockOut]);

  // ── Toggle auto-geofence ──

  const toggleAutoGeofence = useCallback(() => {
    setAutoGeofenceEnabledState((prev) => {
      const next = !prev;
      setAutoGeofenceEnabled(next);
      if (!next) {
        autoGeofenceService.stopMonitoring();
        showToast('info', 'Auto clock-in/out disabled', 'You will need to clock in and out manually.');
      } else {
        showToast('info', 'Auto clock-in/out enabled', 'You will be automatically clocked in/out based on location.');
      }
      return next;
    });
  }, []);

  // ── Restart monitoring (e.g. after the user re-enables location permission) ──
  // startMonitoring is idempotent — it tears down any existing watch/timers
  // first, so this is safe to call at any time.
  const restartMonitoring = useCallback(() => {
    if (geofences.length === 0 || !autoGeofenceEnabledRef.current) return;
    autoGeofenceService.startMonitoring(geofences, isClockedInRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geofenceIdsKey]);

  return {
    isAutoGeofenceActive: autoGeofenceEnabled && monitorState?.isMonitoring === true,
    isInsideGeofence,
    geofence,
    monitorState,
    toggleAutoGeofence,
    restartMonitoring,
    autoGeofenceEnabled,
    error,
  };
}

// ─────────────────────────────────────────────────────────────
// Read-only consumer hook (UI widgets)
// ─────────────────────────────────────────────────────────────
// The owner hook (useAutoGeofence) is mounted ONCE at app-shell level so
// monitoring survives page navigation and never double-subscribes. Widgets
// that only need to DISPLAY monitoring state (distance, zone, geofence name)
// use this read-only hook, which subscribes to the shared singleton service.

export interface UseAutoGeofenceStateReturn {
  isInsideGeofence: boolean;
  geofence: GeofenceDefinition | null;
  monitorState: AutoGeofenceState | null;
  autoGeofenceEnabled: boolean;
  error: string | null;
}

export function useAutoGeofenceState(): UseAutoGeofenceStateReturn {
  const [autoGeofenceEnabled] = useState(() => getAutoGeofenceEnabled());
  const [geofence, setGeofence] = useState<GeofenceDefinition | null>(
    () => autoGeofenceService.getState().geofence ?? null,
  );
  const [monitorState, setMonitorState] = useState<AutoGeofenceState | null>(null);
  const [isInsideGeofence, setIsInsideGeofence] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Hydrate from current service state first (monitoring may already run).
    const current = autoGeofenceService.getState();
    setGeofence(current.geofence ?? null);
    setMonitorState(current);
    setIsInsideGeofence(current.isInsideGeofence);
    if (current.error) setError(current.error);

    const unsubscribe = autoGeofenceService.onStateChange((state: AutoGeofenceState) => {
      setMonitorState(state);
      setIsInsideGeofence(state.isInsideGeofence);
      if (state.geofence) setGeofence(state.geofence);
      if (state.error) setError(state.error);
      if (!state.isMonitoring) {
        // Monitoring stopped — clear transient error so the UI recovers cleanly.
        setError(null);
      }
    });
    return unsubscribe;
  }, []);

  return { isInsideGeofence, geofence, monitorState, autoGeofenceEnabled, error };
}

export default useAutoGeofence;