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
 *    ignored (never used for zone decisions or displayed distance).
 * 2. Speed filter — samples implying impossible movement (> MAX_SPEED_MPS
 *    relative to the last accepted fix) are ignored as glitches.
 * 3. Confirmation — a boundary crossing (enter or exit) only fires after
 *    CONSECUTIVE_CONFIRMATIONS qualifying samples agree in a row.
 * 4. Cooldown — at least EVENT_COOLDOWN_MS must elapse between auto
 *    clock-in/out events, breaking any residual flap loop.
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

/** Maximum GPS accuracy (metres) for a fix to be trusted. Fixes worse than this are dropped. */
export const MAX_ACCURACY_METERS = 100;

/** Maximum plausible speed (m/s) between two accepted fixes (~126 km/h). */
export const MAX_SPEED_MPS = 35;

/** Consecutive qualifying samples required to confirm a boundary crossing. */
export const CONSECUTIVE_CONFIRMATIONS = 3;

/** Minimum time (ms) between auto clock-in/out events. */
export const EVENT_COOLDOWN_MS = 60_000;

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
  };
  private eventListeners: Array<(event: AutoGeofenceEvent) => void> = [];
  private stateListeners: Array<(state: AutoGeofenceState) => void> = [];
  private previousState: 'INSIDE' | 'OUTSIDE' | null = null;

  // ── Stabilization internals ──
  private lastAccepted: { position: { latitude: number; longitude: number }; timestamp: number } | null = null;
  private pendingEnter = 0;
  private pendingExit = 0;
  private lastEventAt = 0;

  /**
   * Start monitoring the user's position against the target geofence.
   */
  startMonitoring(geofence: GeofenceDefinition): void {
    if (!navigator.geolocation) {
      this.emitError('GPS not supported on this device.');
      return;
    }

    this.state = {
      isMonitoring: true,
      isInsideGeofence: false,
      zone: 'outside',
      poorSignal: false,
      geofence,
    };
    this.previousState = null;
    this.lastAccepted = null;
    this.pendingEnter = 0;
    this.pendingExit = 0;
    this.lastEventAt = 0;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.processPosition(
          { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          geofence,
          pos.coords.accuracy,
          pos.timestamp || Date.now(),
        );
      },
      (err) => {
        this.emitError(`GPS error: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      },
    );

    // Immediate one-off position check to trigger instant auto-clock on sign-in
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.processPosition(
          { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          geofence,
          pos.coords.accuracy,
          pos.timestamp || Date.now(),
        );
      },
      () => {
        /* Watch position will handle errors if any */
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  }

  /**
   * Process a GPS position update against the active geofence.
   *
   * Raw samples first pass the accuracy gate and speed filter. Only accepted
   * fixes update the displayed distance/zone. Auto clock-in triggers when
   * inside the geofence (distance <= radius_meters) and auto clock-out when
   * 200m outside (distance > radius_meters + 200) — each confirmed by
   * CONSECUTIVE_CONFIRMATIONS qualifying samples and rate-limited by
   * EVENT_COOLDOWN_MS.
   */
  private processPosition(
    position: { latitude: number; longitude: number },
    geofence: GeofenceDefinition,
    accuracy?: number,
    timestamp?: number,
  ): void {
    const now = timestamp ?? Date.now();

    // ── 1. Accuracy gate: drop fixes the browser itself reports as unreliable ──
    if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_METERS) {
      this.state.poorSignal = true;
      this.notifyState();
      return;
    }

    // ── 2. Speed filter: drop fixes implying physically impossible movement ──
    if (this.lastAccepted) {
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

    const distance = haversineDistance(
      position.latitude,
      position.longitude,
      geofence.latitude,
      geofence.longitude,
    );
    this.state.lastDistance = Math.round(distance);

    const exitThreshold = geofence.radius_meters + EXIT_BUFFER_METERS;

    // Inside geofence: distance is within configured radius
    const isInside = distance <= geofence.radius_meters;
    // Exited geofence: distance exceeds radius + 200m exit boundary
    const isPastExitThreshold = distance > exitThreshold;

    this.state.isInsideGeofence = isInside;
    this.state.zone = isInside ? 'inside' : isPastExitThreshold ? 'outside' : 'approaching';

    // Emit live position update (accepted fixes only — UI never sees glitch jumps)
    this.emit({
      type: 'POSITION_UPDATE',
      geofence,
      distanceMetres: this.state.lastDistance,
      position,
    });

    // ── 3 & 4. Boundary crossings with confirmation samples + cooldown ──
    if (isInside && this.previousState !== 'INSIDE') {
      this.pendingExit = 0;
      this.pendingEnter += 1;
      if (this.pendingEnter >= CONSECUTIVE_CONFIRMATIONS) {
        this.pendingEnter = 0;
        if (now - this.lastEventAt >= EVENT_COOLDOWN_MS) {
          this.previousState = 'INSIDE';
          this.lastEventAt = now;
          this.emit({
            type: 'ENTERED_GEOFENCE',
            geofence,
            distanceMetres: this.state.lastDistance,
            position,
          });
        }
      }
    } else if (isPastExitThreshold && this.previousState === 'INSIDE') {
      this.pendingEnter = 0;
      this.pendingExit += 1;
      if (this.pendingExit >= CONSECUTIVE_CONFIRMATIONS) {
        this.pendingExit = 0;
        if (now - this.lastEventAt >= EVENT_COOLDOWN_MS) {
          this.previousState = 'OUTSIDE';
          this.lastEventAt = now;
          this.emit({
            type: 'EXITED_GEOFENCE',
            geofence,
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
   * Sync active clocked-in state from app to prevent manual clock-in race conditions.
   * If a user manually clocks in while inside or before exiting, ensure previousState
   * is set to 'INSIDE' so auto clock-out reliably triggers when crossing > (radius + 200m).
   *
   * When clocked in, previousState is ALWAYS set to 'INSIDE' regardless of the last
   * known distance — this guarantees the EXITED_GEOFENCE event can fire even if the
   * user clocked in while GPS had not yet reported a position, or was already in the
   * approaching zone. The exit event itself is still gated on the 200m threshold,
   * confirmation samples and cooldown.
   */
  syncClockedIn(isClockedIn: boolean): void {
    if (isClockedIn) {
      this.previousState = 'INSIDE';
    } else {
      this.previousState = 'OUTSIDE';
    }
  }

  /**
   * Stop background monitoring.
   */
  stopMonitoring(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.state.isMonitoring = false;
    this.previousState = null;
    this.lastAccepted = null;
    this.pendingEnter = 0;
    this.pendingExit = 0;
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