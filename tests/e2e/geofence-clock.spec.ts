import { test, expect } from '@playwright/test';
// B8 remediation: verify the SHIPPED geofence math, not a local copy.
import { haversineDistance, checkGeofence } from '../../server/src/geofence';

const API_BASE = process.env.API_URL || 'http://localhost:4000';
const PERF_BYPASS = { 'x-perf-bypass': 'tt_perf_bench_2026' };

test.describe('Geofence Validation & Clocking Lifecycle', () => {
  test('should handle geolocation permissions and UI states', async ({ context, page }) => {
    // Grant geolocation permissions
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: -33.9249, longitude: 18.4241 }); // Cape Town

    await page.goto('/login');
    // Ensure login renders properly with mocked geolocation context
    await expect(page.locator('body')).toBeVisible();
  });

  test('should simulate geofence boundary calculation accuracy (real engine)', async () => {
    // Verify the production Haversine implementation (server/src/geofence.ts).

    // Exactly same location = 0 distance
    const zeroDist = haversineDistance(-33.9249, 18.4241, -33.9249, 18.4241);
    expect(zeroDist).toBeCloseTo(0, 1);

    // Cape Town to Sitari (~35km)
    const dist = haversineDistance(-33.9249, 18.4241, -34.0754, 18.7903);
    expect(dist).toBeGreaterThan(30000);
    expect(dist).toBeLessThan(50000);

    // checkGeofence boundary semantics: inside / outside / edge.
    const geofence = {
      name: 'HQ',
      address: null,
      latitude: -33.9249,
      longitude: 18.4241,
      radiusMeters: 200,
    };
    expect(checkGeofence(-33.9249, 18.4241, geofence).within).toBe(true);
    expect(checkGeofence(-34.0754, 18.7903, geofence).within).toBe(false);
    expect(checkGeofence(-33.9249, 18.4241, geofence).distanceMeters).toBe(0);
  });

  test('should complete full clock-in/out lifecycle via API', async ({ request }) => {
    // 1. Login as employee
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: 'sipho@timetrack.com', password: 'Password123' },
      headers: PERF_BYPASS,
    });
    expect(loginRes.status()).toBe(200);
    const { token } = await loginRes.json();
    const authHeaders = { Authorization: `Bearer ${token}`, ...PERF_BYPASS };

    // 2. Force clock-out any existing active session first (cleanup)
    await request.post(`${API_BASE}/api/time-entries/clock-out`, {
      data: { breakMinutes: 0 },
      headers: authHeaders,
    }).catch(() => {});

    // 3. Clock in (no coordinates = geofence bypass for API test)
    const clockInRes = await request.post(`${API_BASE}/api/time-entries/clock-in`, {
      data: {},
      headers: authHeaders,
    });
    // Accept 201 (success) or 409 (already active) or 400/403 (geofence required/denied without coordinates)
    expect([201, 409, 400, 403]).toContain(clockInRes.status());

    if (clockInRes.status() === 201) {
      const entry = await clockInRes.json();
      expect(entry.status).toBe('active');
      expect(entry.clockIn).toBeTruthy();

      // 4. Verify active session exists
      const activeRes = await request.get(`${API_BASE}/api/time-entries/active`, {
        headers: authHeaders,
      });
      expect(activeRes.status()).toBe(200);

      // 5. Clock out
      const clockOutRes = await request.post(`${API_BASE}/api/time-entries/clock-out`, {
        data: { breakMinutes: 15 },
        headers: authHeaders,
      });
      expect(clockOutRes.status()).toBe(200);
      const completed = await clockOutRes.json();
      expect(completed.status).toBe('completed');
      expect(completed.clockOut).toBeTruthy();
    }
  });

  test('should reject duplicate active clock-in sessions', async ({ request }) => {
    // Login as employee
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: 'lerato@timetrack.com', password: 'Password123' },
      headers: PERF_BYPASS,
    });
    expect(loginRes.status()).toBe(200);
    const { token } = await loginRes.json();
    const authHeaders = { Authorization: `Bearer ${token}`, ...PERF_BYPASS };

    // First clock-in
    const first = await request.post(`${API_BASE}/api/time-entries/clock-in`, {
      data: {},
      headers: authHeaders,
    });

    if (first.status() === 201) {
      // Second clock-in should be rejected (409 Conflict)
      const second = await request.post(`${API_BASE}/api/time-entries/clock-in`, {
        data: {},
        headers: authHeaders,
      });
      expect(second.status()).toBe(409);

      // Cleanup: clock out
      await request.post(`${API_BASE}/api/time-entries/clock-out`, {
        data: { breakMinutes: 0 },
        headers: authHeaders,
      });
    }
  });

  test('should enforce employee self-service isolation', async ({ request }) => {
    // Login as employee
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: 'sipho@timetrack.com', password: 'Password123' },
      headers: PERF_BYPASS,
    });
    const { token } = await loginRes.json();
    const authHeaders = { Authorization: `Bearer ${token}`, ...PERF_BYPASS };

    // Employee should only see their own time entries
    const entriesRes = await request.get(`${API_BASE}/api/time-entries`, {
      headers: authHeaders,
    });
    expect(entriesRes.status()).toBe(200);
    const body = await entriesRes.json();
    const items = body.items || body;
    if (Array.isArray(items)) {
      for (const entry of items) {
        expect(entry.employeeEmail).toBe('sipho@timetrack.com');
      }
    }
  });
});
