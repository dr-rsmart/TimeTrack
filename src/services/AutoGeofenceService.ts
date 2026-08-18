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

        const wasInside = this.previousState === 'INSIDE';
        const nowInside = distance <= geofence.radius_meters;
        const becameInside = !wasInside && nowInside;
        const becameOutside = wasInside && !nowInside;

        this.state.isInsideGeofence = nowInside;

        // Emit position update
        this.emit({
          type: 'POSITION_UPDATE',
          geofence,
          distanceMetres: this.state.lastDistance,
          position,
        });

        // Detect boundary crossings
        if (becameInside) {
          this.previousState = 'INSIDE';
          this.emit({
            type: 'ENTERED_GEOFENCE',
            geofence,
            distanceMetres: this.state.lastDistance,
            position,
          });
        } else if (becameOutside) {
          this.previousState = 'OUTSIDE';
          this.emit({
            type: 'EXITED_GEOFENCE',
            geofence,
            distanceMetres: this.state.lastDistance,
            position,
          });
        }
      },
      (err) => {
        this.emitError(`GPS error: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      },
    );
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