/**
 * Auto Geofence Service
 * ---------------------
 * Background geolocation monitoring service that detects when a user
 * enters or exits their assigned work geofence perimeter.
 *
 * Features:
 * - High-accuracy continuous GPS tracking via watchPosition
 * - ENTERED_GEOFENCE / EXITED_GEOFENCE event emission
 * - Distance calculation using Haversine formula
 * - Configurable accuracy thresholds and polling intervals
 *
 * GPS STABILIZATION (anti-flapping)
 * ---------------------------------
 * Mobile browsers fuse A-GPS, Wi-Fi and cell-tower positioning. When the GPS
 * radio sleeps or signal is momentarily lost, a single fix can jump hundreds
 * of metres (e.g. 2m → 238m), which previously caused random auto
 * clock-in/out cycles. To prevent this, every raw sample passes through:
 *
 * 1. Accuracy gate — samples with coords.accuracy > MAX_ACCURACY_METERS are
 *    ignored (never used for zone decisions or displayed distance). The gate
 *    is aligned with the server's GPS_ACCURACY_BUFFER_METERS (150m) so the
 *    client never rejects fixes the server itself would accept — indoor
 *    Wi-Fi/cell fixes (100–150m accuracy) remain usable.
 * 2. Speed filter — samples implying impossible movement (> MAX_SPEED_MPS
 *    relative to the last accepted fix) are ignored as glitches.
 * 3. Confirmation — a boundary crossing (enter or exit) only fires after
 *    CONSECUTIVE_CONFIRMATIONS qualifying samples agree in a row.
 * 4. Cooldown — at least EVENT_COOLDOWN_MS must elapse between auto
 *    clock-in/out events, breaking any residual flap loop.
 *
 * WATCH RESILIENCE
 * ----------------
 * Mobile browsers / WebViews frequently stop delivering watchPosition
 * callbacks after a transient error (timeout, provider unavailable). The
 * continuous watch therefore runs WITHOUT a timeout and the error handler
 * restarts the watch automatically with exponential backoff. Only a hard
 * PERMISSION_DENIED stops monitoring until the user re-enables location and
 * monitoring is restarted.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface GeofenceDefinition {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
}

export type AutoGeofenceEventType = 'ENTERED_GEOFENCE' | 'EXITED_GEOFENCE' | 'POSITION_UPDATE' | 'ERROR';

/**
 * Geofence proximity zone:
 * - 'inside':      distance <= radius (green)
 * - 'approaching': radius < distance <= radius + EXIT_BUFFER_METERS (orange)
 * - 'outside':     distance > radius + EXIT_BUFFER_METERS — auto clock-out zone (red)
 */
export type GeofenceZone = 'inside' | 'approaching' | 'outside';

/** Grace distance (metres) outside the geofence radius before auto clock-out triggers. */
export const EXIT_BUFFER_METERS = 200;

/**
 * Maximum GPS accuracy (metres) for a fix to be trusted. Fixes worse than
 * this are dropped. Aligned with the server's GPS_ACCURACY_BUFFER_METERS so
 * indoor Wi-Fi/cell-assisted fixes (commonly 100–150m) are still usable.
 */
export const MAX_ACCURACY_METERS = 150;

/** Maximum plausible speed (m/s) between two accepted fixes (~126 km/h). */
export const MAX_SPEED_MPS = 35;

/** Consecutive qualifying samples required to confirm a boundary crossing. */
export const CONSECUTIVE_CONFIRMATIONS = 3;

/** Minimum time (ms) between auto clock-in/out events. */
export const EVENT_COOLDOWN_MS = 60_000;

/** Backoff schedule (ms) for restarting the position watch after a transient GPS error. */
export const WATCH_RESTART_DELAYS_MS = [5_000, 10_000, 30_000, 60_000];

/**
 * localStorage key persisting the "awaiting confirmed exit" flag across app
 * restarts. Set when the employee clocks out (manually or automatically) so a
 * reload/reopen while still on site can NEVER instantly auto clock-in again —
 * they must first produce a confirmed OUTSIDE fix (double clock-in fix).
 */
const AWAITING_EXIT_KEY = 'timetrack_awaiting_exit';

/** Safety expiry for the persisted awaiting-exit flag (12 hours). */
const AWAITING_EXIT_TTL_MS = 12 * 60 * 60 * 1000;

export interface AutoGeofenceEvent {
  type: AutoGeofenceEventType;
  geofence?: GeofenceDefinition;
  distanceMetres?: number;
  error?: string;
  position?: { latitude: number; longitude: number };
}

export interface AutoGeofenceState {
  isMonitoring: boolean;
  isInsideGeofence: boolean;
  /** Current proximity zone relative to the monitored geofence. */
  zone: GeofenceZone;
  lastPosition?: { latitude: number; longitude: number };
  lastDistance?: number;
  /** GPS accuracy (metres) of the last accepted fix. */
  lastAccuracy?: number;
  /** True when the most recent raw GPS sample was rejected (poor signal). */
  poorSignal: boolean;
  /** True when geolocation permission is denied — monitoring cannot continue until re-enabled. */
  permissionDenied: boolean;
  geofence?: GeofenceDefinition;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// Haversine Distance (same as server)
// ─────────────────────────────────────────────────────────────

const EARTH_RADIUS_METERS = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// ─────────────────────────────────────────────────────────────
// Service Implementation
// ─────────────────────────────────────────────────────────────

class AutoGeofenceService {
  private watchId: number | null = null;
  private state: AutoGeofenceState = {
    isMonitoring: false,
    isInsideGeofence: false,
    zone: 'outside',
    poorSignal: false,
    permissionDenied: false,
  };
  private eventListeners: Array<(event: AutoGeofenceEvent) => void> = [];
  private stateListeners: Array<(state: AutoGeofenceState) => void> = [];
  private previousState: 'INSIDE' | 'OUTSIDE' | null = null;

  // ── Stabilization internals ──
  private lastAccepted: { position: { latitude: number; longitude: number }; timestamp: number } | null = null;
  private pendingEnter = 0;
  private pendingExit = 0;
  private lastEventAt = 0;

  // ── Watch resilience internals ──
  /** All monitored work locations (multi-location employees). */
  private activeGeofences: GeofenceDefinition[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;

  // ── Double clock-in prevention ──
  /**
   * True when the employee clocked out and has not yet produced a confirmed
   * OUTSIDE fix. While set, ENTERED_GEOFENCE events are suppressed so an
   * employee who clocks out while still on site is never auto clocked back in.
   * Persisted to localStorage so it survives app restarts/page reloads.
   */
  private awaitingExit = false;
  /** Last clocked-in state synced by the app (transition detection). */
  private lastSyncedClockedIn: boolean | null = null;
  /** Live clocked-in knowledge (drives the inside-but-not-clocked recovery path). */
  private lastKnownClockedIn = false;

  /** Compatibility accessor: primary (first) monitored geofence. */
  private get activeGeofence(): GeofenceDefinition | null {
    return this.activeGeofences.length > 0 ? this.activeGeofences[0] : null;
  }

  /** Read the persisted awaiting-exit flag (expired flags are ignored). */
  private loadAwaitingExit(): boolean {
    try {
      const raw = localStorage.getItem(AWAITING_EXIT_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { setAt?: number };
      if (typeof parsed?.setAt !== 'number') return false;
      if (Date.now() - parsed.setAt > AWAITING_EXIT_TTL_MS) {
        localStorage.removeItem(AWAITING_EXIT_KEY);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private setAwaitingExit(value: boolean): void {
    if (this.awaitingExit === value) return;
    this.awaitingExit = value;
    try {
      if (value) {
        localStorage.setItem(AWAITING_EXIT_KEY, JSON.stringify({ setAt: Date.now() }));
      } else {
        localStorage.removeItem(AWAITING_EXIT_KEY);
      }
    } catch {
      /* storage unavailable — in-memory flag still protects this session */
    }
  }

  /**
   * Start monitoring the user's position against one or more target geofences
   * (multi-location employees are monitored against ALL assigned locations:
   * auto clock-in fires inside ANY of them, auto clock-out only when OUTSIDE
   * ALL of them).
   *
   * @param geofence   The work location(s) to monitor (single or array).
   * @param isClockedIn Current clocked-in state. When true the service is
   *   seeded as INSIDE so auto clock-out can fire reliably even before the
   *   first fix arrives. When false the previous state is left unset so the
   *   first accepted fix inside the geofence triggers an immediate auto
   *   clock-in (no 3-sample wait on sign-in) — UNLESS the awaiting-exit flag
   *   is set (employee clocked out and has not left the site yet).
   */
  startMonitoring(geofence: GeofenceDefinition | GeofenceDefinition[], isClockedIn = false): void {
    if (!navigator.geolocation) {
      this.emitError('GPS not supported on this device.');
      return;
    }

    const list = (Array.isArray(geofence) ? geofence : [geofence]).filter(Boolean);
    if (list.length === 0) {
      this.emitError('No work location to monitor.');
      return;
    }

    this.activeGeofences = list;
    this.state = {
      isMonitoring: true,
      isInsideGeofence: false,
      zone: 'outside',
      poorSignal: false,
      permissionDenied: false,
      geofence: list[0],
    };
    // Seed boundary state from live clock state (see doc above).
    this.previousState = isClockedIn ? 'INSIDE' : null;
    this.lastKnownClockedIn = isClockedIn;
    // Restore the persisted awaiting-exit flag — but only when NOT clocked in.
    // A clocked-in employee never needs the suppression. The in-memory flag
    // also survives same-session monitoring restarts (storage may be absent).
    this.awaitingExit = isClockedIn ? false : this.awaitingExit || this.loadAwaitingExit();
    if (isClockedIn) this.setAwaitingExit(false);
    this.lastAccepted = null;
    this.pendingEnter = 0;
    this.pendingExit = 0;
    this.lastEventAt = 0;
    this.restartAttempts = 0;
    this.clearRestartTimer();

    this.startWatch();
    this.requestImmediateFix();
  }

  /** (Re)arm the continuous position watch. No timeout: it must run indefinitely. */
  private startWatch(): void {
    const geofences = this.activeGeofences;
    if (geofences.length === 0) return;

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        // Any successful fix proves the watch is alive — reset the backoff.
        this.restartAttempts = 0;
        this.processPosition(
          { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          geofences,
          pos.coords.accuracy,
          pos.timestamp || Date.now(),
        );
      },
      (err) => this.handleWatchError(err),
      {
        enableHighAccuracy: true,
        // NOTE: no `timeout` here. A timeout on watchPosition fires the error
        // callback and on several mobile browsers/WebViews silently kills the
        // watch. The watch must keep running; fixes arrive when the OS has one.
        maximumAge: 5000,
      },
    );
  }

  /** One-shot position check to trigger instant auto-clock on sign-in. */
  private requestImmediateFix(): void {
    const geofences = this.activeGeofences;
    if (geofences.length === 0 || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!this.state.isMonitoring) return;
        this.processPosition(
          { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          geofences,
          pos.coords.accuracy,
          pos.timestamp || Date.now(),
        );
      },
      () => {
        /* The continuous watch (with its own recovery) handles errors. */
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  }

  /**
   * Watch error handler. POSITION_UNAVAILABLE / TIMEOUT are transient: the
   * underlying watch frequently stops delivering callbacks afterwards, so
   * restart it with exponential backoff. PERMISSION_DENIED is terminal until
   * the user re-enables location (handled by a stop/start cycle from the UI).
   */
  private handleWatchError(err: GeolocationPositionError): void {
    if (!this.state.isMonitoring) return;

    if (err.code === 1 /* PERMISSION_DENIED */) {
      this.state.permissionDenied = true;
      this.emitError(
        'Location permission is blocked. Enable location access for this app to use auto clock-in/out.',
      );
      return;
    }

    this.emitError(`GPS signal lost (${err.message || 'unknown error'}) — retrying automatically…`);
    this.scheduleWatchRestart();
  }

  /** Schedule a watch restart with exponential backoff (5s → 10s → 30s → 60s cap). */
  private scheduleWatchRestart(): void {
    if (!this.state.isMonitoring || !this.activeGeofence) return;
    if (this.restartTimer !== null) return; // a restart is already scheduled

    const attempt = Math.min(this.restartAttempts, WATCH_RESTART_DELAYS_MS.length - 1);
    const delay = WATCH_RESTART_DELAYS_MS[attempt];
    this.restartAttempts += 1;

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.state.isMonitoring || !this.activeGeofence) return;
      this.startWatch();
      this.requestImmediateFix();
    }, delay);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  /**
   * Process a GPS position update against ALL active (monitored) geofences.
   *
   * Raw samples first pass the accuracy gate and speed filter. Only accepted
   * fixes update the displayed distance/zone. With multiple assigned
   * locations: auto clock-in triggers when INSIDE ANY geofence
   * (distance <= radius_meters) and auto clock-out only when OUTSIDE ALL of
   * them (every distance > radius_meters + 200) — each confirmed by
   * CONSECUTIVE_CONFIRMATIONS qualifying samples and rate-limited by
   * EVENT_COOLDOWN_MS.
   *
   * Coarse fixes (accuracy > MAX_ACCURACY_METERS) are normally dropped, BUT
   * are accepted when they clearly prove the user is far away from every
   * monitored location (distance − accuracy > radius + exit buffer). This
   * makes auto clock-out reliable while driving away even when the GPS radio
   * sleeps and only coarse network fixes arrive.
   */
  private processPosition(
    position: { latitude: number; longitude: number },
    geofences: GeofenceDefinition[],
    accuracy?: number,
    timestamp?: number,
  ): void {
    const now = timestamp ?? Date.now();
    if (geofences.length === 0) return;

    // ── Distance profile across all monitored geofences ──
    let nearest = geofences[0];
    let nearestDistance = Infinity;
    let insideAny = false;
    let outsideAll = true;
    for (const gf of geofences) {
      const d = haversineDistance(position.latitude, position.longitude, gf.latitude, gf.longitude);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = gf;
      }
      if (d <= gf.radius_meters) insideAny = true;
      if (d <= gf.radius_meters + EXIT_BUFFER_METERS) outsideAll = false;
    }

    // ── 1. Accuracy gate: drop fixes the browser itself reports as unreliable ──
    const coarseFix =
      typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_METERS;
    let clearlyFarEverywhere = false;
    if (coarseFix) {
      clearlyFarEverywhere = geofences.every((gf) => {
        const d = haversineDistance(position.latitude, position.longitude, gf.latitude, gf.longitude);
        return d - (accuracy as number) > gf.radius_meters + EXIT_BUFFER_METERS;
      });
      if (!clearlyFarEverywhere) {
        this.state.poorSignal = true;
        this.notifyState();
        return;
      }
    }

    // ── 2. Speed filter: drop fixes implying physically impossible movement ──
    // Skipped for clearly-far coarse fixes: network-based positioning
    // legitimately jumps kilometres between fixes, and rejecting those jumps
    // would prevent exit confirmations while driving away.
    if (!clearlyFarEverywhere && this.lastAccepted) {
      const dtSec = (now - this.lastAccepted.timestamp) / 1000;
      if (dtSec > 0.5) {
        const moved = haversineDistance(
          this.lastAccepted.position.latitude,
          this.lastAccepted.position.longitude,
          position.latitude,
          position.longitude,
        );
        if (moved / dtSec > MAX_SPEED_MPS) {
          // e.g. a 2m → 238m jump in one second is a glitch, not movement
          this.state.poorSignal = true;
          this.notifyState();
          return;
        }
      }
    }

    // ── Accepted fix ──
    this.lastAccepted = { position, timestamp: now };
    this.state.poorSignal = false;
    if (typeof accuracy === 'number' && Number.isFinite(accuracy)) {
      this.state.lastAccuracy = Math.round(accuracy);
    }
    this.state.lastPosition = position;
    this.state.lastDistance = Math.round(nearestDistance);
    this.state.geofence = nearest;

    // Inside: within the radius of ANY assigned geofence.
    const isInside = insideAny;
    // Exited: beyond radius + 200m exit boundary of EVERY assigned geofence.
    const isPastExitThreshold = outsideAll;

    this.state.isInsideGeofence = isInside;
    this.state.zone = isInside ? 'inside' : isPastExitThreshold ? 'outside' : 'approaching';

    // An accepted fix outside ALL assigned locations proves the employee left
    // — release the double-clock-in suppression immediately.
    if (isPastExitThreshold && this.awaitingExit) {
      this.setAwaitingExit(false);
    }

    // Emit live position update (accepted fixes only — UI never sees glitch jumps)
    this.emit({
      type: 'POSITION_UPDATE',
      geofence: nearest,
      distanceMetres: this.state.lastDistance,
      position,
    });

    // ── 3 & 4. Boundary crossings with confirmation samples + cooldown ──
    // When initial fix is accepted inside geofence, trigger entered event directly if first reading (previousState === null),
    // otherwise require confirmation samples for boundary transitions.
    const isInitialFix = this.previousState === null;

    if (isInside && this.previousState !== 'INSIDE') {
      this.pendingExit = 0;
      this.pendingEnter += 1;
      if (isInitialFix || this.pendingEnter >= CONSECUTIVE_CONFIRMATIONS) {
        this.pendingEnter = 0;
        if (now - this.lastEventAt >= EVENT_COOLDOWN_MS || isInitialFix) {
          this.previousState = 'INSIDE';
          this.lastEventAt = now;
          if (this.awaitingExit) {
            // Double clock-in prevention: the employee clocked out while still on
            // site — swallow the enter event. They must first leave every
            // assigned location (which clears the flag) before auto clock-in
            // is re-armed.
          } else {
            this.emit({
              type: 'ENTERED_GEOFENCE',
              geofence: nearest,
              distanceMetres: this.state.lastDistance,
              position,
            });
          }
        }
      }
    } else if (isInside && this.previousState === 'INSIDE' && !this.lastKnownClockedIn && !this.awaitingExit) {
      // Recovery path: inside, not clocked in, not awaiting exit. Happens when
      // the employee clocked out while OUTSIDE (or a transition was missed)
      // and walked back in — no OUTSIDE→INSIDE crossing would otherwise fire.
      // Also provides a natural retry (once per cooldown) when a clock-in was
      // temporarily rejected (e.g. the server re-clock guard window).
      this.pendingExit = 0;
      if (now - this.lastEventAt >= EVENT_COOLDOWN_MS) {
        this.lastEventAt = now;
        this.emit({
          type: 'ENTERED_GEOFENCE',
          geofence: nearest,
          distanceMetres: this.state.lastDistance,
          position,
        });
      }
    } else if (isPastExitThreshold && this.previousState === 'INSIDE') {
      this.pendingEnter = 0;
      this.pendingExit += 1;
      if (this.pendingExit >= CONSECUTIVE_CONFIRMATIONS) {
        this.pendingExit = 0;
        if (now - this.lastEventAt >= EVENT_COOLDOWN_MS) {
          this.previousState = 'OUTSIDE';
          this.lastEventAt = now;
          this.setAwaitingExit(false);
          this.emit({
            type: 'EXITED_GEOFENCE',
            geofence: nearest,
            distanceMetres: this.state.lastDistance,
            position,
          });
        }
      }
    } else {
      // Approaching zone or no crossing in progress — reset pending counters
      this.pendingEnter = 0;
      this.pendingExit = 0;
    }
  }

  /**
   * Sync active clocked-in state from app to prevent manual clock-in/out race conditions.
   * If a user is clocked in, ensure previousState is set to 'INSIDE' so auto clock-out
   * triggers when crossing > (radius + 200m).
   * If a user clocks out while physically inside the geofence, keep previousState as 'INSIDE'
   * so they are not immediately re-clocked in (they must first physically exit before re-entering).
   *
   * DOUBLE CLOCK-IN PREVENTION: on a genuine clocked-in → clocked-out
   * transition while still inside, the awaiting-exit flag is armed
   * (persisted). While armed, ENTERED_GEOFENCE events are suppressed — even
   * across app restarts/page reloads — until a fix proves the employee left
   * every assigned location.
   */
  syncClockedIn(isClockedIn: boolean): void {
    const wasClockedIn = this.lastSyncedClockedIn;
    this.lastSyncedClockedIn = isClockedIn;
    this.lastKnownClockedIn = isClockedIn;

    if (isClockedIn) {
      this.previousState = 'INSIDE';
      this.setAwaitingExit(false);
      return;
    }

    if (!this.state.isInsideGeofence) {
      this.previousState = 'OUTSIDE';
    }
    // If clocked out while still inside geofence (isInsideGeofence === true),
    // retain previousState = 'INSIDE'. Auto clock-in will not trigger until
    // the user leaves (transitioning to OUTSIDE) and returns.

    // Arm the suppression on a REAL clocked-in → clocked-out transition. The
    // initial mount sync (wasClockedIn === null) never arms it, so fresh
    // sessions still auto clock in normally. It is armed regardless of the
    // last known zone: if the employee is already outside, the next accepted
    // outside fix releases it immediately; if they are on site (or GPS has
    // not fixed yet), re-clock-in stays blocked until they genuinely leave.
    if (wasClockedIn === true) {
      this.setAwaitingExit(true);
    }
  }

  /**
   * Stop background monitoring.
   */
  stopMonitoring(): void {
    this.clearRestartTimer();
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.state.isMonitoring = false;
    this.previousState = null;
    this.lastAccepted = null;
    this.pendingEnter = 0;
    this.pendingExit = 0;
    this.activeGeofences = [];
    this.restartAttempts = 0;
    // NOTE: the persisted awaiting-exit flag is intentionally NOT cleared —
    // the suppression must survive monitoring restarts and page reloads.
  }

  /**
   * Restart monitoring with the last active geofences (e.g. after the user
   * re-enables location permission). No-op when nothing was being monitored.
   */
  restartMonitoring(isClockedIn = false): void {
    const geofences =
      this.activeGeofences.length > 0
        ? this.activeGeofences
        : this.state.geofence
          ? [this.state.geofence]
          : [];
    if (geofences.length === 0) return;
    this.stopMonitoring();
    // stopMonitoring clears activeGeofences — startMonitoring re-arms them.
    this.startMonitoring(geofences, isClockedIn);
  }

  /**
   * Get current monitoring state.
   */
  getState(): AutoGeofenceState {
    return { ...this.state };
  }

  /**
   * Subscribe to geofence state changes.
   * Returns an unsubscribe function.
   */
  onStateChange(callback: (state: AutoGeofenceState) => void): () => void {
    this.stateListeners.push(callback);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== callback);
    };
  }

  /**
   * Subscribe to geofence events.
   * Returns an unsubscribe function.
   */
  onEvent(callback: (event: AutoGeofenceEvent) => void): () => void {
    this.eventListeners.push(callback);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== callback);
    };
  }

  /** Notify state listeners only (used when a sample is rejected). */
  private notifyState(): void {
    this.stateListeners.forEach((cb) => {
      try {
        cb(this.state);
      } catch {
        /* ignore listener errors */
      }
    });
  }

  private emit(event: AutoGeofenceEvent): void {
    // Notify state listeners with updated state
    this.stateListeners.forEach((cb) => {
      try {
        cb(this.state);
      } catch {
        /* ignore listener errors */
      }
    });
    // Notify event listeners
    this.eventListeners.forEach((cb) => {
      try {
        cb(event);
      } catch {
        /* ignore listener errors */
      }
    });
  }

  private emitError(message: string): void {
    this.state.error = message;
    this.emit({
      type: 'ERROR',
      error: message,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Singleton Export
// ─────────────────────────────────────────────────────────────

export const autoGeofenceService = new AutoGeofenceService();
export default autoGeofenceService;