/**
 * Geofence Validation Engine
 * --------------------------
 * Uses the Haversine formula to compute the great-circle distance
 * between two points on Earth. Returns distance in meters.
 */

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Compute distance in meters between two lat/lng coordinates.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export interface GeofenceCheckResult {
  within: boolean;
  distanceMeters: number;
  geofenceName: string;
  geofenceAddress: string | null;
  geofenceLatitude: number;
  geofenceLongitude: number;
  geofenceRadius: number;
}

/**
 * Check whether a given coordinate falls within a geofence radius.
 */
export function checkGeofence(
  lat: number,
  lng: number,
  geofence: {
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    radiusMeters: number;
  },
): GeofenceCheckResult {
  const distance = haversineDistance(lat, lng, geofence.latitude, geofence.longitude);
  return {
    within: distance <= geofence.radiusMeters,
    distanceMeters: Math.round(distance),
    geofenceName: geofence.name,
    geofenceAddress: geofence.address,
    geofenceLatitude: geofence.latitude,
    geofenceLongitude: geofence.longitude,
    geofenceRadius: geofence.radiusMeters,
  };
}