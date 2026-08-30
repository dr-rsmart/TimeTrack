/**
 * E2E: Auto Geofence Clock-In / Clock-Out (web path)
 * --------------------------------------------------
 * Proves the flagship feature end-to-end in a real browser:
 *   1. Employee signs in with GPS mocked INSIDE their assigned geofence
 *      → the app-shell monitor auto clocks them in (no button press).
 *   2. Employee moves >radius+200m away (after the 60s event cooldown)
 *      → the app auto clocks them out.
 * Verified against the real API (active session probe + entry status).
 *
 * Test account: raees@smartpatel.co.za — assigned geofence "Main Office"
 * (-34.05306, 18.77181, 1000m radius).
 */

import { test, expect, type Page } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:4000';
const PERF_BYPASS = { 'x-perf-bypass': 'tt_perf_bench_2026' };

const EMPLOYEE = { email: 'raees@smartpatel.co.za', password: 'Password123' };
const GEOFENCE_CENTER = { latitude: -34.05306, longitude: 18.77181, accuracy: 10 };
// ~1.5km south of centre — beyond radius (1000m) + exit buffer (200m).
const OUTSIDE_POINT = { latitude: -34.0666, longitude: 18.77181, accuracy: 10 };

test.describe('Auto geofence clock-in/out', () => {
  test.setTimeout(420_000); // ~2.5 min of real waiting (60s cooldown included)

  test('auto clocks in on arrival and out on departure', async ({ context, page }) => {
    // ── Cleanup: ensure no leftover active session for the employee ──
    const loginRes = await context.request.post(`${API_BASE}/api/auth/login`, {
      data: EMPLOYEE,
      headers: PERF_BYPASS,
    });
    expect(loginRes.status()).toBe(200);
    // Self clock-out is allowed anywhere; 404 means nothing active — fine.
    await context.request.post(`${API_BASE}/api/time-entries/clock-out`, {
      data: { breakMinutes: 0 },
      headers: PERF_BYPASS,
    });

    // Capture console errors for diagnosis if the flow fails.
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // ── ARRIVAL: GPS inside the assigned geofence BEFORE the app loads ──
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(GEOFENCE_CENTER);

    await page.goto('/');
    // The cookie session from the API login signs the web app in via /auth/me.
    await page.waitForURL('**/', { timeout: 30_000 });
    await expect(page.getByText(/Good (Morning|Afternoon|Evening)/i)).toBeVisible({ timeout: 30_000 });

    // ── Assert AUTO clock-in happens without any manual interaction ──
    const activeAfterIn = await pollUntil(
      async () => {
        const res = await context.request.get(`${API_BASE}/api/time-entries/active`, { headers: PERF_BYPASS });
        if (!res.ok()) return null;
        return (await res.json()).active;
      },
      (entry) => entry !== null,
      60_000,
    );
    expect(activeAfterIn, 'expected an active session created by AUTO clock-in').not.toBeNull();
    expect(activeAfterIn.employeeEmail).toBe(EMPLOYEE.email);

    // The widget must reflect the active session (running timer UI).
    await expect(page.getByText('Started at')).toBeVisible({ timeout: 30_000 });

    const clockInDetectedAt = Date.now();

    // ── DEPARTURE: wait out the 60s event cooldown, then move away ──
    const cooldownRemaining = 65_000 - (Date.now() - clockInDetectedAt);
    if (cooldownRemaining > 0) await page.waitForTimeout(cooldownRemaining);

    // Drive outside the geofence: nudge the mocked position a few times so the
    // watcher receives several fixes (3 consecutive confirmations required).
    for (let i = 0; i < 4; i++) {
      await context.setGeolocation({
        latitude: OUTSIDE_POINT.latitude + i * 0.00002,
        longitude: OUTSIDE_POINT.longitude,
        accuracy: 10,
      });
      await page.waitForTimeout(2_500);
    }

    // ── Assert AUTO clock-out: active session is closed ──
    const activeAfterOut = await pollUntil(
      async () => {
        const res = await context.request.get(`${API_BASE}/api/time-entries/active`, { headers: PERF_BYPASS });
        if (!res.ok()) return 'probe-failed';
        return (await res.json()).active;
      },
      (entry) => entry === null,
      120_000,
    );
    expect(activeAfterOut, 'expected the active session to be closed by AUTO clock-out').toBeNull();

    // And the entry is persisted as completed with a clockOut timestamp.
    const today = new Date().toISOString().split('T')[0];
    const entriesRes = await context.request.get(
      `${API_BASE}/api/time-entries?date=${today}&employeeEmail=${EMPLOYEE.email}&limit=10`,
      { headers: PERF_BYPASS },
    );
    expect(entriesRes.status()).toBe(200);
    const { items } = await entriesRes.json();
    const latest = items.find((e: { id: string }) => e.id === activeAfterIn.id);
    expect(latest).toBeTruthy();
    expect(latest.status).toBe('completed');
    expect(latest.clockOut).toBeTruthy();

    // Surface any console errors captured during the run.
    expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });
});

/** Poll an async probe until the predicate passes or the timeout elapses. */
async function pollUntil<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  intervalMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await probe();
  while (!predicate(last) && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, intervalMs));
    // eslint-disable-next-line no-await-in-loop
    last = await probe();
  }
  return last;
}