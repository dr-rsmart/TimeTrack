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
export const EXIT_BUFFER_METERS = 110;

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
  };
  private eventListeners: Array<(event: AutoGeofenceEvent) => void> = [];
  private stateListeners: Array<(state: AutoGeofenceState) => void> = [];
  private previousState: 'INSIDE' | 'OUTSIDE' | null = null;

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
      geofence,
    };
    this.previousState = null;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const position = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
        this.state.lastPosition = position;

        const distance = haversineDistance(
          position.latitude,
          position.longitude,
          geofence.latitude,
          geofence.longitude,
        );
        this.state.lastDistance = Math.round(distance);

        this.processPosition(position, geofence);
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
        const position = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
        this.processPosition(position, geofence);
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
   * Auto clock-in triggers when inside geofence (distance <= radius_meters).
   * Auto clock-out triggers after reaching 110m outside geofence radius (distance > radius_meters + 110).
   */
  private processPosition(
    position: { latitude: number; longitude: number },
    geofence: GeofenceDefinition,
  ): void {
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
    // Exited geofence: distance exceeds radius + 110m exit boundary
    const isPastExitThreshold = distance > exitThreshold;

    this.state.isInsideGeofence = isInside;
    this.state.zone = isInside ? 'inside' : isPastExitThreshold ? 'outside' : 'approaching';

    // Emit live position update
    this.emit({
      type: 'POSITION_UPDATE',
      geofence,
      distanceMetres: this.state.lastDistance,
      position,
    });

    // Detect boundary crossings with hysteresis
    if (isInside && this.previousState !== 'INSIDE') {
      this.previousState = 'INSIDE';
      this.emit({
        type: 'ENTERED_GEOFENCE',
        geofence,
        distanceMetres: this.state.lastDistance,
        position,
      });
    } else if (isPastExitThreshold && this.previousState === 'INSIDE') {
      this.previousState = 'OUTSIDE';
      this.emit({
        type: 'EXITED_GEOFENCE',
        geofence,
        distanceMetres: this.state.lastDistance,
        position,
      });
    }
  }

  /**
   * Sync active clocked-in state from app to prevent manual clock-in race conditions.
   * If a user manually clocks in while inside or before exiting, ensure previousState
   * is set to 'INSIDE' so auto clock-out reliably triggers when crossing > (radius + 110m).
   *
   * When clocked in, previousState is ALWAYS set to 'INSIDE' regardless of the last
   * known distance — this guarantees the EXITED_GEOFENCE event can fire even if the
   * user clocked in while GPS had not yet reported a position, or was already in the
   * approaching zone. The exit event itself is still gated on the 110m threshold.
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