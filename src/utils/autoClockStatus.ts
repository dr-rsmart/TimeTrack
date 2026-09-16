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
 * Hybrid ownership: the web monitor is the primary foreground punch path
 * (browsers AND the shell WebView); the native background task is the backup
 * for closed/locked states. The native ladder only fully owns the explanation
 * when the web monitor is not running inside the shell; otherwise native
 * snapshots are consulted for hard failures of the backup path.
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
  /** Punches queued in the native offline outbox awaiting sync. */
  outboxCount?: number;
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
    outboxCount:
      typeof d.outboxCount === 'number' && Number.isFinite(d.outboxCount)
        ? Math.max(0, Math.floor(d.outboxCount))
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
  | 'offline-pending'
  | 'foreground-only'
  | 'background-active'
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
  /** Punches queued in the WEB offline outbox awaiting sync. */
  pendingOfflinePunches?: number;
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

  // ── Runtime ownership (hybrid model) ──
  // Inside the shell the web monitor is the PRIMARY foreground punch path and
  // the native background task is the BACKUP for closed/locked states. The
  // native ladder fully owns the explanation only when the web monitor is not
  // running inside the shell (WebView geolocation denied, older shell). When
  // the web monitor IS running, a fresh native snapshot is still consulted for
  // hard failures that silently break the backup path.
  const ns = input.nativeShell ? input.nativeStatus : null;
  const nativeFresh = Boolean(ns && recent(ns.at));
  const nativeOwns = input.nativeShell && !input.webMonitoringActive;

  // Offline punch outboxes (web queue + native queue via the bridge snapshot).
  // A queued punch is the most actionable explanation: the employee DID punch,
  // it just has not reached the server yet.
  const pendingOffline =
    (input.pendingOfflinePunches ?? 0) + (nativeFresh && ns?.outboxCount ? ns.outboxCount : 0);
  if (pendingOffline > 0) {
    return note(
      'offline-pending',
      'info',
      'Punches waiting to sync',
      `${pendingOffline} automatic punch${pendingOffline === 1 ? '' : 'es'} queued while offline. ` +
        `It syncs with the original timestamp${pendingOffline === 1 ? '' : 's'} as soon as the connection returns.`,
    );
  }

  const permissionNote = (): ResolvedAutoClockStatus =>
    note(
      'permission',
      'warning',
      'Background location permission needed',
      'In device settings, allow background location for TimeTrack ("Allow all the time" on Android or "Always" on iOS), then reopen the app.',
    );
  const authNote = (): ResolvedAutoClockStatus =>
    note(
      'auth',
      'warning',
      'Background sign-in needs attention',
      'Background clocking has no usable sign-in credentials, or its last request remained unauthorised. Reopen the app or sign in again.',
    );
  const backgroundNote = (): ResolvedAutoClockStatus =>
    note(
      'background',
      'warning',
      'Background location not running reliably',
      'The app reports a stopped location task or a task error. Reopen TimeTrack and check device location settings. You can try manual clocking.',
    );
  const punchFailureNote = (
    failure: NonNullable<NativeAutoClockStatus['failure']>,
  ): ResolvedAutoClockStatus => {
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
      failure === 'reclock' ? 'cooldown' : 'punch-failed',
      'warning',
      'Last automatic punch was not completed',
      details[failure],
    );
  };

  if (nativeOwns) {
    if (!ns || !recent(ns.at)) {
      return note(
        'unknown',
        'warning',
        'Background status unavailable',
        'The app has not supplied a recent auto-clock status. Foreground GPS does not confirm background monitoring. You can try manual clocking.',
      );
    }
    if (ns.enabled === false) {
      return note(
        'off',
        'warning',
        'Native automatic clocking is disabled',
        'The app background setting is OFF. Reopen the app to sync settings; contact your administrator if this persists.',
      );
    }
    if (ns.backgroundPermission === 'denied' || ns.backgroundPermission === 'undetermined') {
      return permissionNote();
    }
    if (ns.hasToken === false || ns.failure === 'auth') {
      return authNote();
    }
    if (ns.backgroundStarted === false || ns.taskError) {
      return backgroundNote();
    }
    if (ns.backgroundStarted === null || ns.backgroundPermission == null) {
      return note(
        'unknown',
        'warning',
        'Background service status incomplete',
        'The app could not verify its background location service and permission. Reopen TimeTrack and check device settings.',
      );
    }
    if (ns.monitoredCount === 0) {
      return note(
        'unassigned',
        'warning',
        'No background work location assigned',
        'Company locations shown below are not necessarily monitored. Ask your administrator to check your active work-location assignment.',
      );
    }
  } else if (nativeFresh && ns) {
    // Hybrid: hard failures of the native BACKUP still break clocking while
    // the app is closed/locked, so surface them even though the foreground
    // web monitor is healthy and can punch on its own.
    if (ns.backgroundPermission === 'denied' || ns.backgroundPermission === 'undetermined') {
      // Foreground-only permission tier ("While Using the App" / "Allow only
      // while using the app" / one-time grants): the web monitor still punches
      // while the app is OPEN — explain the degraded-but-working mode with an
      // upgrade hint instead of a hard permission failure. The danger note is
      // reserved for a full denial (web monitor blocked too) below.
      if (input.webMonitoringActive && !input.webPermissionDenied) {
        return note(
          'foreground-only',
          'warning',
          'Auto clocking works while the app is open',
          'Background location is not enabled, so automatic punches only happen while TimeTrack is open. ' +
            'For hands-free clocking when the app is closed or locked, set location to "Allow all the time" (Android) or "Always" (iOS) in device settings.',
        );
      }
      return permissionNote();
    }
    if (ns.hasToken === false || ns.failure === 'auth') {
      return authNote();
    }
    if (ns.backgroundStarted === false || ns.taskError) {
      return backgroundNote();
    }
  }

  // Double clock-in suppression. The hybrid model runs BOTH state machines
  // (the web awaiting-exit flag inside the monitor and the native
  // clockedOutInside flag in the background task), so EITHER armed guard
  // pauses auto clock-in until a confirmed exit (or the 12 h TTL) releases it.
  const nativeSuppressedAt =
    ns &&
    ns.suppressed &&
    typeof ns.suppressedSetAt === 'number' &&
    ns.suppressedSetAt <= now &&
    now - ns.suppressedSetAt <= SUPPRESSION_TTL_MS
      ? ns.suppressedSetAt
      : null;
  const setAt =
    nativeSuppressedAt ?? (input.webAwaitingExit ? (input.webAwaitingExitSetAt ?? null) : null);
  const suppressed = nativeSuppressedAt !== null || input.webAwaitingExit;
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

  if (nativeOwns && ns) {
    if (ns.failure) {
      return punchFailureNote(ns.failure);
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

  // Hybrid: a failed BACKUP punch is still worth explaining even while the
  // foreground monitor is healthy — the next punch while the app is closed
  // would fail the same way.
  if (nativeFresh && ns?.failure) {
    return punchFailureNote(ns.failure);
  }

  // Browser / hybrid foreground runtime (the web monitor owns foreground
  // punches in browsers and inside the shell WebView).
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
  if (input.clockedIn || !input.inside) {
    // Positive confirmation ("Always" / "Allow all the time" tier): inside the
    // shell with a healthy background task, tell the employee that automatic
    // clocking also works while the app is closed — instead of showing nothing.
    if (
      nativeFresh &&
      ns &&
      ns.backgroundPermission === 'granted' &&
      ns.backgroundStarted === true &&
      ns.enabled !== false
    ) {
      return note(
        'background-active',
        'muted',
        'Background auto clocking is active',
        'TimeTrack can clock you in and out automatically even when the app is closed or the phone is locked.',
      );
    }
    return null;
  }
  return {
    kind: 'confirming',
    tone: 'info',
    title: 'Confirming your position',
    detail:
      'Waiting for the live monitor and attendance confirmation. The initial reliable inside fix can request clock-in; later crossings require confirmed samples. Server validation still applies.',
  };
}
