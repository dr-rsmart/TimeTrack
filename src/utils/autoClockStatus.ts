/**
 * Auto-clock status reasoning (employee-facing observability)
 * -----------------------------------------------------------
 * The Time tab can show a valid "inside geofence" fix while the employee is
 * NOT clocked in. That contradiction has several designed causes (toggle off,
 * the double clock-in suppression after an on-site clock-out, background
 * location not running in the native shell, poor GPS signal, pending
 * confirmation samples). This module turns the observable inputs from the web
 * monitor (AutoGeofenceService state) and the native shell bridge
 * (mobile/App.js → `timetrack-native-auto-clock` event) into a single
 * human-readable explanation, so the UI never shows an unexplained
 * "inside geofence + not clocked in" state.
 *
 * Pure functions only — no DOM, no React — so the ladder is unit-testable.
 */

import { formatTime } from '../lib/utils';

/** Window event published by the React Native shell (mobile/App.js). */
export const NATIVE_AUTO_CLOCK_EVENT = 'timetrack-native-auto-clock';
/** Diagnostic freshness threshold, not a promise about OS wake frequency. */
export const AUTO_CLOCK_STATUS_STALE_MS = 2 * 60_000;
const SUPPRESSION_TTL_MS = 12 * 60 * 60_000;

/** Status snapshot published by the native background state machine. */
export interface NativeAutoClockStatus {
  /** Double clock-in guard armed (clocked out while still on site). */
  suppressed: boolean;
  /** When the suppression was armed (null when not suppressed). */
  suppressedSetAt: number | null;
  /** Native boundary zone ('inside' | 'outside' | null when unseeded). */
  zone: 'inside' | 'outside' | null;
  /** Consecutive inside samples collected toward the next confirmation. */
  pendingEnter: number;
  /** True when the OS background location task is running. */
  backgroundStarted: boolean | null;
  requestId?: string | null;
  backgroundPermission?: 'granted' | 'denied' | 'undetermined' | null;
  enabled?: boolean | null;
  hasToken?: boolean | null;
  monitoredCount?: number | null;
  lastSampleAt?: number | null;
  lastAcceptedAt?: number | null;
  sampleZone?: 'inside' | 'outside' | 'approaching' | null;
  poorSignal?: boolean;
  taskError?: boolean;
  failure?: 'auth' | 'network' | 'server' | 'rejected' | 'reclock' | null;
  cooldownUntil?: number | null;
  /** Snapshot time (epoch ms). */
  at: number;
}

/** Validate an untrusted event detail into a NativeAutoClockStatus. */
export function parseNativeAutoClockStatus(detail: unknown): NativeAutoClockStatus | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as Record<string, unknown>;
  if (typeof d.suppressed !== 'boolean' || timestamp(d.at) === null) return null;
  return {
    suppressed: d.suppressed,
    suppressedSetAt: timestamp(d.suppressedSetAt),
    zone: d.zone === 'inside' || d.zone === 'outside' ? d.zone : null,
    pendingEnter:
      typeof d.pendingEnter === 'number' && Number.isFinite(d.pendingEnter)
        ? Math.max(0, Math.floor(d.pendingEnter))
        : 0,
    backgroundStarted: typeof d.backgroundStarted === 'boolean' ? d.backgroundStarted : null,
    requestId: typeof d.requestId === 'string' ? d.requestId : null,
    backgroundPermission:
      d.backgroundPermission === 'granted' ||
      d.backgroundPermission === 'denied' ||
      d.backgroundPermission === 'undetermined'
        ? d.backgroundPermission
        : null,
    enabled: typeof d.enabled === 'boolean' ? d.enabled : null,
    hasToken: typeof d.hasToken === 'boolean' ? d.hasToken : null,
    monitoredCount:
      typeof d.monitoredCount === 'number' &&
      Number.isInteger(d.monitoredCount) &&
      d.monitoredCount >= 0
        ? d.monitoredCount
        : null,
    lastSampleAt: timestamp(d.lastSampleAt),
    lastAcceptedAt: timestamp(d.lastAcceptedAt),
    sampleZone:
      d.sampleZone === 'inside' || d.sampleZone === 'outside' || d.sampleZone === 'approaching'
        ? d.sampleZone
        : null,
    poorSignal: d.poorSignal === true,
    taskError: d.taskError === true,
    failure:
      d.failure === 'auth' ||
      d.failure === 'network' ||
      d.failure === 'server' ||
      d.failure === 'rejected' ||
      d.failure === 'reclock'
        ? d.failure
        : null,
    cooldownUntil: timestamp(d.cooldownUntil),
    at: d.at as number,
  };
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export type AutoClockStatusKind =
  | 'ineligible'
  | 'off'
  | 'suppressed'
  | 'background'
  | 'native-idle'
  | 'confirming'
  | 'permission'
  | 'monitor-off'
  | 'poor-signal'
  | 'auth'
  | 'punch-failed'
  | 'cooldown'
  | 'unassigned'
  | 'stale'
  | 'unknown';

export type AutoClockStatusTone = 'muted' | 'info' | 'warning' | 'danger';

export interface ResolvedAutoClockStatus {
  kind: AutoClockStatusKind;
  tone: AutoClockStatusTone;
  title: string;
  detail: string;
}

export interface AutoClockStatusInput {
  /** Employee currently has an active time entry. */
  clockedIn: boolean;
  /** Foreground proximity says the employee is inside an allowed geofence. */
  inside: boolean;
  /** User-facing auto clock-in/out setting (GeofenceManager toggle). */
  toggleEnabled: boolean;
  /** Session is eligible for auto clocking (master/demo sessions are not). */
  eligible: boolean;
  /** Running inside the React Native WebView shell. */
  nativeShell: boolean;
  /** Web monitor is actively watching position (browser runtime). */
  webMonitoringActive: boolean;
  /** Web double clock-in suppression armed (AutoGeofenceState.awaitingExit). */
  webAwaitingExit: boolean;
  webPermissionDenied: boolean;
  webPoorSignal: boolean;
  /** Latest native shell snapshot (null until the first publish). */
  nativeStatus: NativeAutoClockStatus | null;
  /** Consecutive samples required to confirm a crossing (GEOFENCE_CONFIRMATIONS). */
  confirmations: number;
  now?: number;
  webAwaitingExitSetAt?: number | null;
}

/**
 * Resolve WHY an automatic clock-in has not fired (or why auto clock-out will
 * not). Returns null when there is nothing to explain — i.e. the visible state
 * is self-consistent.
 */
export function resolveAutoClockStatus(
  input: AutoClockStatusInput,
): ResolvedAutoClockStatus | null {
  const now = input.now ?? Date.now();
  const recent = (at: number | null | undefined) =>
    typeof at === 'number' &&
    Number.isFinite(at) &&
    at > 0 &&
    at <= now &&
    now - at <= AUTO_CLOCK_STATUS_STALE_MS;
  const note = (
    kind: AutoClockStatusKind,
    tone: AutoClockStatusTone,
    title: string,
    detail: string,
  ): ResolvedAutoClockStatus => ({ kind, tone, title, detail });

  if (!input.eligible) {
    return {
      kind: 'ineligible',
      tone: 'muted',
      title: 'Auto clock-in/out not applied',
      detail: 'This session type (e.g. master or demo session) does not use automatic clocking.',
    };
  }

  if (!input.toggleEnabled) {
    return {
      kind: 'off',
      tone: 'muted',
      title: input.clockedIn
        ? 'Auto-Geofence OFF — no automatic clock-out'
        : 'Auto-Geofence OFF — no automatic clock-in',
      detail:
        'Automatic clocking is disabled for this device. Ask your administrator about Geofence settings. You can try manual clocking; normal validation still applies.',
    };
  }

  // Only the active runtime is authoritative. A stopped web monitor can retain
  // state from before the native shell took ownership.
  const ns = input.nativeShell ? input.nativeStatus : null;
  if (input.nativeShell && (!ns || !recent(ns.at))) {
    return note(
      'unknown',
      'warning',
      'Background status unavailable',
      'The app has not supplied a recent auto-clock status. Foreground GPS does not confirm background monitoring. You can try manual clocking.',
    );
  }
  if (ns?.enabled === false) {
    return note(
      'off',
      'warning',
      'Native automatic clocking is disabled',
      'The app background setting is OFF. Reopen the app to sync settings; contact your administrator if this persists.',
    );
  }
  if (ns?.backgroundPermission === 'denied' || ns?.backgroundPermission === 'undetermined') {
    return note(
      'permission',
      'warning',
      'Background location permission needed',
      'In device settings, allow background location for TimeTrack ("Allow all the time" on Android or "Always" on iOS), then reopen the app.',
    );
  }
  if (ns?.hasToken === false || ns?.failure === 'auth') {
    return note(
      'auth',
      'warning',
      'Background sign-in needs attention',
      'Background clocking has no usable sign-in credentials, or its last request remained unauthorised. Reopen the app or sign in again.',
    );
  }
  if (ns?.backgroundStarted === false || ns?.taskError) {
    return note(
      'background',
      'warning',
      'Background location not running reliably',
      'The app reports a stopped location task or a task error. Reopen TimeTrack and check device location settings. You can try manual clocking.',
    );
  }
  if (ns && (ns.backgroundStarted === null || ns.backgroundPermission == null)) {
    return note(
      'unknown',
      'warning',
      'Background service status incomplete',
      'The app could not verify its background location service and permission. Reopen TimeTrack and check device settings.',
    );
  }
  if (ns?.monitoredCount === 0) {
    return note(
      'unassigned',
      'warning',
      'No background work location assigned',
      'Company locations shown below are not necessarily monitored. Ask your administrator to check your active work-location assignment.',
    );
  }

  const setAt = ns ? ns.suppressedSetAt : input.webAwaitingExitSetAt;
  const suppressed = ns
    ? ns.suppressed &&
      typeof setAt === 'number' &&
      setAt <= now &&
      now - setAt <= SUPPRESSION_TTL_MS
    : input.webAwaitingExit;
  if (suppressed && !input.clockedIn) {
    const when = setAt ? ` (armed at ${formatTime(new Date(setAt))})` : '';
    return {
      kind: 'suppressed',
      tone: 'warning',
      title: 'Auto clock-in paused — you clocked out on site',
      detail:
        `To prevent a double clock-in, auto clock-in waits for a confirmed exit from every assigned location${when}. ` +
        'The guard expires after 12 h and is released when monitoring next processes it. You can try manual clock-in; normal validation still applies.',
    };
  }

  if (ns) {
    if (ns.failure) {
      const details = {
        auth: 'Sign in again to restore background clocking.',
        network:
          'The last automatic punch could not reach the server. Check your connection; the app will retry on a later eligible location update.',
        server:
          'The server could not complete the last automatic punch. Check your attendance before retrying manually.',
        rejected:
          'The server did not accept the last automatic punch. Check your attendance and contact your administrator if this persists.',
        reclock:
          'The server blocked a repeat clock-in shortly after clock-out. The app will retry on a later eligible location update.',
      };
      return note(
        ns.failure === 'reclock' ? 'cooldown' : 'punch-failed',
        'warning',
        'Last automatic punch was not completed',
        details[ns.failure],
      );
    }
    if (recent(ns.lastSampleAt) && ns.poorSignal) {
      return note(
        'poor-signal',
        'warning',
        'Poor background GPS signal',
        'The latest background reading was ignored. Waiting for a reliable location update.',
      );
    }
    if (!recent(ns.lastSampleAt) || !recent(ns.lastAcceptedAt)) {
      return note(
        'stale',
        'warning',
        'No recent reliable background position',
        'The background service has not reported a recent accepted GPS fix. Device scheduling and movement affect updates; foreground proximity alone cannot trigger a native punch.',
      );
    }
    if (input.clockedIn || !input.inside) return null;
    if (ns.cooldownUntil && ns.cooldownUntil > now) {
      return note(
        'cooldown',
        'info',
        'Waiting between clock events',
        'A recent clock event is still in its safety cooldown. The next eligible background update can retry.',
      );
    }
    if (
      ns.sampleZone === 'inside' &&
      ns.pendingEnter > 0 &&
      ns.pendingEnter < input.confirmations
    ) {
      return note(
        'confirming',
        'info',
        'Confirming your position',
        `Background samples inside: ${ns.pendingEnter}/${input.confirmations}. A punch requires confirmed samples and server approval; update timing depends on the device.`,
      );
    }
    return note(
      'native-idle',
      'info',
      'Waiting for background clocking',
      'No entry confirmation is currently in progress. Background and foreground positions or attendance state may differ. Check your attendance and try manual clocking if needed.',
    );
  }

  // Browser runtime (web monitor owns auto clocking).
  if (input.webPermissionDenied) {
    return {
      kind: 'permission',
      tone: 'danger',
      title: 'Location permission blocked',
      detail:
        'Auto clock-in cannot run while location access is denied. Re-enable location for this browser.',
    };
  }
  if (!input.webMonitoringActive) {
    return {
      kind: 'monitor-off',
      tone: 'warning',
      title: 'Location monitoring not running',
      detail:
        'The live geofence monitor is not running. Check location access and your work-location assignment. You can try manual clocking.',
    };
  }
  if (input.webPoorSignal) {
    return {
      kind: 'poor-signal',
      tone: 'warning',
      title: 'Poor GPS signal',
      detail: 'Unstable readings are ignored — waiting for a reliable fix before auto clock-in.',
    };
  }
  if (input.clockedIn || !input.inside) return null;
  return {
    kind: 'confirming',
    tone: 'info',
    title: 'Confirming your position',
    detail:
      'Waiting for the live monitor and attendance confirmation. The initial reliable inside fix can request clock-in; later crossings require confirmed samples. Server validation still applies.',
  };
}
