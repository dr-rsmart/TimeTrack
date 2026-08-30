/**
 * Unit tests for src/services/AutoGeofenceService.ts
 *
 * Covers the GPS-stabilized geofence boundary engine and the watch
 * resilience layer:
 *   • immediate auto clock-in on the first accepted fix inside the geofence
 *   • confirmed auto clock-out after CONSECUTIVE_CONFIRMATIONS outside fixes
 *   • accuracy gate (fixes worse than MAX_ACCURACY_METERS are ignored)
 *   • speed filter (impossible jumps are ignored)
 *   • event cooldown (no flap within EVENT_COOLDOWN_MS)
 *   • transient GPS errors restart the watch with backoff
 *   • permission denial halts monitoring without restarts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface MockFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp?: number;
}

interface WatchHandlers {
  success: (pos: GeolocationPosition) => void;
  error: (err: GeolocationPositionError) => void;
}

/** Minimal fake for navigator.geolocation backed by watchPosition streams. */
function createGeolocationHarness() {
  const watchers = new Map<number, WatchHandlers>();
  let nextId = 1;

  const geolocation = {
    watchPosition: vi.fn((success: WatchHandlers['success'], error: WatchHandlers['error']) => {
      const id = nextId++;
      watchers.set(id, { success, error });
      return id;
    }),
    clearWatch: vi.fn((id: number) => {
      watchers.delete(id);
    }),
    getCurrentPosition: vi.fn(),
  };

  return {
    geolocation,
    /** Deliver a fix to every active watcher. */
    emitFix(fix: MockFix) {
      const position = {
        coords: {
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracy: fix.accuracy,
        },
        timestamp: fix.timestamp ?? Date.now(),
      } as unknown as GeolocationPosition;
      for (const w of [...watchers.values()]) w.success(position);
    },
    /** Deliver an error to every active watcher. */
    emitError(code: number, message: string) {
      const err = { code, message } as unknown as GeolocationPositionError;
      for (const w of [...watchers.values()]) w.error(err);
    },
    activeWatcherCount: () => watchers.size,
    watchCalls: () => geolocation.watchPosition.mock.calls.length,
  };
}

/** Import a fresh module instance so each test gets a clean singleton. */
async function importFreshService() {
  vi.resetModules();
  return import('../../src/services/AutoGeofenceService');
}

// ── Test geofence: Cape Town Branch, 300m radius ──
const GEOFENCE = {
  id: 'gf-1',
  name: 'Cape Town Branch',
  address: '45 Long Street, Cape Town',
  latitude: -33.9249,
  longitude: 18.4241,
  radius_meters: 300,
  is_active: true,
};

// ~0m from centre (inside)
const POS_INSIDE = { latitude: -33.9249, longitude: 18.4241 };
// ~400m from centre (approaching: > radius, <= radius + 200)
const POS_APPROACHING = { latitude: -33.9285, longitude: 18.4241 };
// ~567m from centre (outside: > radius + 200)
const POS_OUTSIDE = { latitude: -33.9300, longitude: 18.4241 };

describe('AutoGeofenceService — boundary engine', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useFakeTimers({ now: new Date('2026-08-30T08:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fires ENTERED_GEOFENCE immediately on the first accepted fix inside (not clocked in)', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));
    autoGeofenceService.startMonitoring(GEOFENCE, false);

    harness.emitFix({ ...POS_INSIDE, accuracy: 15 });

    const entered = events.filter((e) => e.type === 'ENTERED_GEOFENCE');
    expect(entered.length).toBe(1);
    expect(autoGeofenceService.getState().isInsideGeofence).toBe(true);
  });

  it('requires CONSECUTIVE_CONFIRMATIONS outside fixes to fire EXITED_GEOFENCE when clocked in', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService, CONSECUTIVE_CONFIRMATIONS } = await importFreshService();

    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));
    // Clocked in → seeded INSIDE, so exit is the first crossing to detect.
    autoGeofenceService.startMonitoring(GEOFENCE, true);

    for (let i = 0; i < CONSECUTIVE_CONFIRMATIONS - 1; i++) {
      vi.advanceTimersByTime(2000);
      harness.emitFix({ ...POS_OUTSIDE, accuracy: 20 });
    }
    expect(events.filter((e) => e.type === 'EXITED_GEOFENCE').length).toBe(0);

    vi.advanceTimersByTime(2000);
    harness.emitFix({ ...POS_OUTSIDE, accuracy: 20 });
    expect(events.filter((e) => e.type === 'EXITED_GEOFENCE').length).toBe(1);
    expect(autoGeofenceService.getState().isInsideGeofence).toBe(false);
  });

  it('ignores fixes worse than the accuracy gate and flags poorSignal', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));
    autoGeofenceService.startMonitoring(GEOFENCE, false);

    // 250m accuracy — rejected by the gate.
    harness.emitFix({ ...POS_INSIDE, accuracy: 250 });

    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(0);
    expect(autoGeofenceService.getState().poorSignal).toBe(true);
    // A subsequent reliable fix still triggers entry.
    harness.emitFix({ ...POS_INSIDE, accuracy: 25 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);
  });

  it('accepts indoor-grade fixes at the 150m accuracy boundary', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService, MAX_ACCURACY_METERS } = await importFreshService();

    expect(MAX_ACCURACY_METERS).toBe(150);

    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));
    autoGeofenceService.startMonitoring(GEOFENCE, false);

    // Exactly 150m accuracy must pass the gate (gate is `> MAX`, not `>=`).
    harness.emitFix({ ...POS_INSIDE, accuracy: 150 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);
  });

  it('rejects impossible movement via the speed filter', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));
    // Clocked in: a glitch jump far away must NOT auto clock-out.
    autoGeofenceService.startMonitoring(GEOFENCE, true);

    // Baseline accepted fix at centre.
    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });

    // Teleport ~5km in 1s (≈5000 m/s) — impossible, must be rejected.
    vi.advanceTimersByTime(1000);
    harness.emitFix({ latitude: -33.97, longitude: 18.42, accuracy: 10 });

    expect(events.filter((e) => e.type === 'EXITED_GEOFENCE').length).toBe(0);
    expect(autoGeofenceService.getState().poorSignal).toBe(true);
  });

  it('suppresses a crossing that occurs within the cooldown window', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService, CONSECUTIVE_CONFIRMATIONS } = await importFreshService();

    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));
    autoGeofenceService.startMonitoring(GEOFENCE, true);

    // First confirmed exit fires.
    for (let i = 0; i < CONSECUTIVE_CONFIRMATIONS; i++) {
      vi.advanceTimersByTime(2000);
      harness.emitFix({ ...POS_OUTSIDE, accuracy: 10 });
    }
    expect(events.filter((e) => e.type === 'EXITED_GEOFENCE').length).toBe(1);

    // Re-enter almost immediately (inside cooldown) — must not fire again.
    for (let i = 0; i < CONSECUTIVE_CONFIRMATIONS; i++) {
      vi.advanceTimersByTime(2000);
      harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    }
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(0);
  });
});

describe('AutoGeofenceService — watch resilience', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useFakeTimers({ now: new Date('2026-08-30T08:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('restarts the watch after a transient (non-permission) error', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService, WATCH_RESTART_DELAYS_MS } = await importFreshService();

    autoGeofenceService.startMonitoring(GEOFENCE, false);
    const initialWatches = harness.watchCalls();
    expect(harness.activeWatcherCount()).toBe(1);

    // POSITION_UNAVAILABLE (code 2) is transient → schedule restart.
    harness.emitError(2, 'Network location provider not available');

    // Advance past the first backoff delay; watch should be re-armed.
    vi.advanceTimersByTime(WATCH_RESTART_DELAYS_MS[0] + 100);
    expect(harness.watchCalls()).toBeGreaterThan(initialWatches);
    expect(harness.activeWatcherCount()).toBe(1);
    expect(autoGeofenceService.getState().isMonitoring).toBe(true);
  });

  it('does NOT restart the watch on permission denial and flags permissionDenied', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService, WATCH_RESTART_DELAYS_MS } = await importFreshService();

    autoGeofenceService.startMonitoring(GEOFENCE, false);
    const initialWatches = harness.watchCalls();

    harness.emitError(1, 'User denied Geolocation');
    expect(autoGeofenceService.getState().permissionDenied).toBe(true);

    // Even after enough time for several restarts, no new watch is armed.
    vi.advanceTimersByTime(WATCH_RESTART_DELAYS_MS[WATCH_RESTART_DELAYS_MS.length - 1] * 3);
    expect(harness.watchCalls()).toBe(initialWatches);
  });

  it('restartMonitoring re-arms after a permission re-grant', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    autoGeofenceService.startMonitoring(GEOFENCE, false);
    harness.emitError(1, 'User denied Geolocation');
    expect(autoGeofenceService.getState().permissionDenied).toBe(true);

    // User re-enables location in OS settings and taps retry.
    autoGeofenceService.restartMonitoring(false);
    expect(autoGeofenceService.getState().permissionDenied).toBe(false);
    expect(autoGeofenceService.getState().isMonitoring).toBe(true);
    expect(harness.activeWatcherCount()).toBe(1);

    // And it works again.
    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));
    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);
  });

  it('stopMonitoring clears the watch and cancels any pending restart', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService, WATCH_RESTART_DELAYS_MS } = await importFreshService();

    autoGeofenceService.startMonitoring(GEOFENCE, false);
    harness.emitError(2, 'unavailable'); // schedules a restart

    autoGeofenceService.stopMonitoring();
    expect(harness.activeWatcherCount()).toBe(0);

    // The pending restart must have been cancelled.
    vi.advanceTimersByTime(WATCH_RESTART_DELAYS_MS[0] + 100);
    expect(harness.activeWatcherCount()).toBe(0);
    expect(autoGeofenceService.getState().isMonitoring).toBe(false);
  });
});