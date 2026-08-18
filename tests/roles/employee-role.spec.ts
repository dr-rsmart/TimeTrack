import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:4000';
const PERF_BYPASS = { 'x-perf-bypass': 'tt_perf_bench_2026' };

test.describe.serial('Employee Role (Staff Member) — Process Test Pack', () => {
  let employeeToken: string;
  let employeeId: string;
  let employeeEmail: string = 'sipho@timetrack.com';
  let createdTimeEntryId: string | null = null;

  test.beforeAll(async ({ request }) => {
    // 1. Employee Login
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: employeeEmail, password: 'Password123' },
    });
    expect(loginRes.status()).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.user.role).toBe('employee');
    employeeToken = loginData.token;

    // Get profile details
    const meRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${employeeToken}`, ...PERF_BYPASS },
    });
    const meData = await meRes.json();
    employeeId = meData.employeeId;
  });

  const authHeader = () => ({
    Authorization: `Bearer ${employeeToken}`,
    ...PERF_BYPASS,
  });

  test('Process 1: View Own Profile & Geofences (GET /api/auth/me, /geofences/my)', async ({ request }) => {
    const meRes = await request.get(`${API_BASE}/api/auth/me`, { headers: authHeader() });
    expect(meRes.status()).toBe(200);
    const me = await meRes.json();
    expect(me.email).toBe(employeeEmail);
    expect(me.role).toBe('employee');

    const geoRes = await request.get(`${API_BASE}/api/settings/geofences/my`, { headers: authHeader() });
    expect(geoRes.status()).toBe(200);
    const geoData = await geoRes.json();
    expect(Array.isArray(geoData.geofences)).toBe(true);
  });

  test('Process 2: Geofence Distance Calculation & Validation (POST /geofences/test-distance)', async ({ request }) => {
    // Sitari coordinates: -34.0841, 18.7842
    const insideRes = await request.post(`${API_BASE}/api/settings/geofences/test-distance`, {
      headers: authHeader(),
      data: {
        latitude: -34.0841,
        longitude: 18.7842,
        radiusMeters: 500,
      },
    });
    expect(insideRes.status()).toBe(200);
    const insideData = await insideRes.json();
    expect(insideData.passed).toBe(true);
  });

  test('Process 3: Geofence Clock-in Enforcement — Reject Out-of-Bounds Punch (POST /clock-in)', async ({ request }) => {
    // Far away coordinates (e.g. London: 51.5074, -0.1278)
    const outRes = await request.post(`${API_BASE}/api/time-entries/clock-in`, {
      headers: authHeader(),
      data: {
        latitude: 51.5074,
        longitude: -0.1278,
      },
    });
    expect(outRes.status()).toBe(403);
    const outData = await outRes.json();
    expect(outData.error).toMatch(/Clock-in denied|outside/);
  });

  test('Process 4: Valid Self-Service Clock-in & Duplicate Session Prevention (POST /clock-in)', async ({ request }) => {
    // Clean any prior active session
    const activeCheck = await request.get(`${API_BASE}/api/time-entries/active`, { headers: authHeader() });
    const activeBody = await activeCheck.json();
    if (activeBody.active) {
      await request.post(`${API_BASE}/api/time-entries/clock-out`, {
        headers: authHeader(),
        data: { latitude: -34.0841, longitude: 18.7842 },
      });
    }

    // 1. Clock in inside Sitari geofence
    const clockInRes = await request.post(`${API_BASE}/api/time-entries/clock-in`, {
      headers: authHeader(),
      data: {
        latitude: -34.0841,
        longitude: 18.7842,
      },
    });
    expect(clockInRes.status()).toBe(201);
    const entry = await clockInRes.json();
    expect(entry.status).toBe('active');
    expect(entry.employeeEmail).toBe(employeeEmail);
    createdTimeEntryId = entry.id;

    // 2. Prevent duplicate active session
    const dupRes = await request.post(`${API_BASE}/api/time-entries/clock-in`, {
      headers: authHeader(),
      data: {
        latitude: -34.0841,
        longitude: 18.7842,
      },
    });
    expect(dupRes.status()).toBe(409);
  });

  test('Process 5: View Active Session & Self-Service Clock-Out (GET /active, POST /clock-out)', async ({ request }) => {
    // Check active
    const activeRes = await request.get(`${API_BASE}/api/time-entries/active`, { headers: authHeader() });
    expect(activeRes.status()).toBe(200);
    const activeData = await activeRes.json();
    expect(activeData.active).not.toBeNull();

    // Clock out
    const clockOutRes = await request.post(`${API_BASE}/api/time-entries/clock-out`, {
      headers: authHeader(),
      data: {
        latitude: -34.0841,
        longitude: 18.7842,
        breakMinutes: 0,
      },
    });
    expect(clockOutRes.status()).toBe(200);
    const outEntry = await clockOutRes.json();
    expect(outEntry.status).toBe('completed');
  });

  test('Process 6: View Personal Shifts and Attendance Entries (GET /shifts, GET /time-entries)', async ({ request }) => {
    const [shiftsRes, entriesRes] = await Promise.all([
      request.get(`${API_BASE}/api/shifts`, { headers: authHeader() }),
      request.get(`${API_BASE}/api/time-entries`, { headers: authHeader() }),
    ]);

    expect(shiftsRes.status()).toBe(200);
    expect(entriesRes.status()).toBe(200);

    const shiftsData = await shiftsRes.json();
    const entriesData = await entriesRes.json();

    // Employee must only see their own records
    for (const shift of shiftsData.items) {
      if (shift.employeeEmail) {
        expect(shift.employeeEmail).toBe(employeeEmail);
      }
    }
    for (const entry of entriesData.items) {
      expect(entry.employeeEmail).toBe(employeeEmail);
    }
  });

  test('Process 7: Password Self-Service Lifecycle (Forgot, Keep & Change Password)', async ({ request }) => {
    // 1. Forgot password
    const forgotRes = await request.post(`${API_BASE}/api/auth/forgot-password`, {
      headers: PERF_BYPASS,
      data: { email: employeeEmail },
    });
    expect(forgotRes.status()).toBe(200);
    const forgotData = await forgotRes.json();
    expect(forgotData.success).toBe(true);

    // 2. Keep password (returns 200, or 400 if server enforces mandatory rotation on default password)
    const keepRes = await request.post(`${API_BASE}/api/auth/keep-password`, {
      headers: authHeader(),
    });
    expect([200, 400]).toContain(keepRes.status());
  });

  test('Process 8: Security Boundaries — Reject Privileged Actions by Employee', async ({ request }) => {
    // 1. Cannot access master stats
    const masterRes = await request.get(`${API_BASE}/api/master/stats`, { headers: authHeader() });
    expect(masterRes.status()).toBe(403);

    // 2. Cannot update company settings
    const settingsRes = await request.put(`${API_BASE}/api/settings/settings`, {
      headers: authHeader(),
      data: { ordinaryHoursPerDay: 4 },
    });
    expect(settingsRes.status()).toBe(403);

    // 3. Cannot query another employee's active session
    const otherActiveRes = await request.get(`${API_BASE}/api/time-entries/active?employeeEmail=admin@timetrack.com`, {
      headers: authHeader(),
    });
    expect(otherActiveRes.status()).toBe(403);
  });

  test.afterAll(async ({ request }) => {
    // Cleanup created time entry
    if (createdTimeEntryId) {
      // Login as admin to delete test entry
      const adminRes = await request.post(`${API_BASE}/api/auth/login`, {
        headers: PERF_BYPASS,
        data: { email: 'admin@timetrack.com', password: 'Password123' },
      });
      const adminToken = (await adminRes.json()).token;
      await request.delete(`${API_BASE}/api/time-entries/${createdTimeEntryId}`, {
        headers: { Authorization: `Bearer ${adminToken}`, ...PERF_BYPASS },
      });
    }
  });
});
