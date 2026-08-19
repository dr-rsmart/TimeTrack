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
// Notification Helpers
// ─────────────────────────────────────────────────────────────

function sendNotification(title: string, body: string): void {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico', tag: `${title}-${Date.now()}` });
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
  autoGeofenceEnabled: boolean;
  error: string | null;
}

// ─────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────

export function useAutoGeofence(options: UseAutoGeofenceOptions): UseAutoGeofenceReturn {
  const { userEmail, isClockedIn, activeEntryId, activeEntry, onClockIn, onClockOut, enabled = true } = options;

  const [autoGeofenceEnabled, setAutoGeofenceEnabledState] = useState(() => getAutoGeofenceEnabled());
  const [geofence, setGeofence] = useState<GeofenceDefinition | null>(null);
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

  // ── Sync active clocked-in state with background service ──
  useEffect(() => {
    autoGeofenceService.syncClockedIn(isClockedIn);
  }, [isClockedIn]);

  // ── Fetch employee's geofence ──

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !userEmail) { setGeofence(null); return; }

    async function fetchGeofence() {
      try {
        // Use employee-accessible endpoint /api/settings/geofences/my
        const myData = await settingsApi.getMyGeofences().catch(() => null);
        let targetGeofence: GeofenceDefinition | null = null;

        if (myData && myData.geofences) {
          const assignedId = myData.employee?.geofenceId;
          if (assignedId) {
            const assigned = myData.geofences.find((g) => g.id === assignedId && g.isActive);
            if (assigned) {
              targetGeofence = {
                id: assigned.id,
                name: assigned.name,
                address: assigned.address,
                latitude: assigned.latitude,
                longitude: assigned.longitude,
                radius_meters: assigned.radiusMeters,
                is_active: assigned.isActive,
              };
            }
          }

          // If no assigned geofence or not found, fall back to first active company geofence
          if (!targetGeofence && myData.geofences.length > 0) {
            const firstActive = myData.geofences.find((g) => g.isActive);
            if (firstActive) {
              targetGeofence = {
                id: firstActive.id,
                name: firstActive.name,
                address: firstActive.address,
                latitude: firstActive.latitude,
                longitude: firstActive.longitude,
                radius_meters: firstActive.radiusMeters,
                is_active: firstActive.isActive,
              };
            }
          }
        }

        // Fallback for Admin/Manager roles if /geofences/my returned empty
        if (!targetGeofence) {
          try {
            const { geofences } = await settingsApi.listGeofences();
            const active = geofences.find((g) => g.isActive);
            if (active) {
              targetGeofence = {
                id: active.id,
                name: active.name,
                address: active.address,
                latitude: active.latitude,
                longitude: active.longitude,
                radius_meters: active.radiusMeters,
                is_active: active.isActive,
              };
            }
          } catch {
            // Ignore error if not permitted
          }
        }

        if (cancelled) return;

        if (!targetGeofence) {
          setError('No active work location assigned to your profile.');
          setGeofence(null);
          return;
        }

        setGeofence(targetGeofence);
        setError(null);
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.error('[useAutoGeofence] Failed to fetch geofence:', err);
          setError(`Failed to load geofence data: ${message}`);
        }
      }
    }
    fetchGeofence();
    return () => { cancelled = true; };
  }, [enabled, userEmail]);

  // ── Start/stop monitoring ──

  useEffect(() => {
    if (!enabled || !geofence || !autoGeofenceEnabled) {
      autoGeofenceService.stopMonitoring();
      return;
    }
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    autoGeofenceService.startMonitoring(geofence);
    autoGeofenceService.syncClockedIn(isClockedInRef.current);
    return () => { autoGeofenceService.stopMonitoring(); };
  }, [enabled, geofence, autoGeofenceEnabled]);

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
            sendNotification('Auto Clock In', `You entered "${event.geofence.name}".`);
            showToast('success', `Auto clocked in at "${event.geofence.name}"`, `~${event.distanceMetres ?? 0}m from centre.`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          if (!msg.toLowerCase().includes('already clocked')) {
            showToast('error', 'Auto clock-in failed', msg);
          }
        }
      } else if (event.type === 'EXITED_GEOFENCE' && event.geofence && isClockedInRef.current && activeEntryRef.current) {
        try {
          const pos = event.position || (await getCurrentPosition());
          await timeEntryApi.clockOut(0, pos?.latitude, pos?.longitude, userEmail ?? undefined);
          setLastAutoClockOut();
          await onClockOutRef.current();
          sendNotification('Auto Clock Out', `You left "${event.geofence.name}".`);
          showToast('success', `Auto clocked out — left "${event.geofence.name}"`, `~${event.distanceMetres ?? 0}m from centre.`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          showToast('error', 'Auto clock-out failed', msg);
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

  return {
    isAutoGeofenceActive: autoGeofenceEnabled && monitorState?.isMonitoring === true,
    isInsideGeofence,
    geofence,
    monitorState,
    toggleAutoGeofence,
    autoGeofenceEnabled,
    error,
  };
}

export default useAutoGeofence;