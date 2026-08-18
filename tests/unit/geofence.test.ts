import { describe, it, expect } from 'vitest';
import { haversineDistance } from '../../server/src/geoValidationService.js';

describe('Geofence Math & Validation Unit Tests', () => {
  const CAPE_TOWN = { lat: -33.9249, lon: 18.4241 };
  const JOHANNESBURG = { lat: -26.2041, lon: 28.0473 };

  it('calculates 0 distance for identical coordinates', () => {
    const dist = haversineDistance(CAPE_TOWN.lat, CAPE_TOWN.lon, CAPE_TOWN.lat, CAPE_TOWN.lon);
    expect(dist).toBe(0);
  });

  it('calculates accurate distance between Cape Town and Johannesburg (~1260km)', () => {
    const dist = haversineDistance(CAPE_TOWN.lat, CAPE_TOWN.lon, JOHANNESBURG.lat, JOHANNESBURG.lon);
    expect(dist).toBeGreaterThan(1_250_000);
    expect(dist).toBeLessThan(1_280_000);
  });

  it('correctly validates coordinates within small radius (e.g. 50m walk)', () => {
    // 0.0001 deg lat is approx 11.1 meters
    const nearbyLat = CAPE_TOWN.lat + 0.0002; // ~22.2 meters away
    const dist = haversineDistance(CAPE_TOWN.lat, CAPE_TOWN.lon, nearbyLat, CAPE_TOWN.lon);
    expect(dist).toBeGreaterThan(15);
    expect(dist).toBeLessThan(30);
  });

  it('handles negative, zero, and boundary coordinates correctly', () => {
    // Equator and Prime Meridian (Null Island)
    const d1 = haversineDistance(0, 0, 0, 1);
    expect(d1).toBeGreaterThan(110_000); // ~111km per longitude degree at equator
    expect(d1).toBeLessThan(112_000);

    // North Pole to South Pole (~20,015 km)
    const poleDist = haversineDistance(90, 0, -90, 0);
    expect(poleDist).toBeGreaterThan(19_900_000);
    expect(poleDist).toBeLessThan(20_100_000);
  });

  it('handles antipodal points (~20,000 km)', () => {
    const dist = haversineDistance(0, 0, 0, 180);
    expect(dist).toBeGreaterThan(19_900_000);
    expect(dist).toBeLessThan(20_100_000);
  });
});
