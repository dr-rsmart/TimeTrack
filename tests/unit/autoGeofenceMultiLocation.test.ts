/**
 * Unit tests for multi-location geofence monitoring and the double clock-in
 * prevention (awaiting-exit guard) in AutoGeofenceService, including the
 * system (cron) auto-close suppression (armed since the 2026-09 duplicate
 * clocking fix) and the live 12h TTL expiry.
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
    activeWatcherCount: () => watchers.size,
  };
}

/** Import a fresh module instance so each test gets a clean singleton. */
async function importFreshService() {
  vi.resetModules();
  return import('../../src/services/AutoGeofenceService');
}

/** Minimal in-memory localStorage stub for the persisted awaiting-exit flag. */
function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  });
}

const GEOFENCE = {
  id: 'gf-1',
  name: 'Cape Town Branch',
  address: '45 Long Street, Cape Town',
  latitude: -33.9249,
  longitude: 18.4241,
  radius_meters: 300,
  is_active: true,
};

// Second work location ~3.6km away
const GEOFENCE2 = {
  id: 'gf-2',
  name: 'Head Office',
  address: '1 Main Road, Sandton',
  latitude: -33.9,
  longitude: 18.45,
  radius_meters: 300,
  is_active: true,
};

const POS_INSIDE_2 = { latitude: -33.9, longitude: 18.45 }; // centre of site 2
const POS_INSIDE = { latitude: -33.9249, longitude: 18.4241 }; // centre of site 1
const POS_OUTSIDE = { latitude: -33.93, longitude: 18.4241 }; // ~567m from site 1
const POS_FAR_AWAY = { latitude: -34.1, longitude: 18.6 }; // far from both

describe('AutoGeofenceService — multi-location monitoring', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubLocalStorage();
    vi.useFakeTimers({ now: new Date('2026-08-30T08:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('auto clock-in fires inside ANY assigned location (second site)', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    autoGeofenceService.startMonitoring([GEOFENCE, GEOFENCE2], false);
    const events: Array<{ type: string; geofenceId?: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type, geofenceId: e.geofence?.id }));

    // Employee arrives at Head Office (nowhere near the first site).
    harness.emitFix({ ...POS_INSIDE_2, accuracy: 10 });
    const entered = events.filter((e) => e.type === 'ENTERED_GEOFENCE');
    expect(entered.length).toBe(1);
    expect(entered[0].geofenceId).toBe('gf-2');
  });

  it('auto clock-out only fires when OUTSIDE ALL assigned locations', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    autoGeofenceService.startMonitoring([GEOFENCE, GEOFENCE2], true);
    autoGeofenceService.syncClockedIn(true);
    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));

    // Working at the SECOND location — must NOT be clocked out just because
    // they are far from the first monitored location.
    harness.emitFix({ ...POS_INSIDE_2, accuracy: 10 });
    harness.emitFix({ ...POS_INSIDE_2, accuracy: 12, timestamp: Date.now() + 30000 });
    expect(events.filter((e) => e.type === 'EXITED_GEOFENCE').length).toBe(0);
    expect(autoGeofenceService.getState().isInsideGeofence).toBe(true);

    // Driving far away from EVERY assigned site → exit confirms.
    // (Timestamps spaced so the implied speed stays under the service's
    // MAX_SPEED_MPS glitch filter.)
    vi.advanceTimersByTime(61_000); // clear event cooldown
    harness.emitFix({ ...POS_FAR_AWAY, accuracy: 15, timestamp: Date.now() + 900000 });
    harness.emitFix({ ...POS_FAR_AWAY, accuracy: 15, timestamp: Date.now() + 930000 });
    harness.emitFix({ ...POS_FAR_AWAY, accuracy: 15, timestamp: Date.now() + 960000 });
    expect(events.filter((e) => e.type === 'EXITED_GEOFENCE').length).toBe(1);
  });

  it('accepts a single geofence (backwards compatible signature)', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    autoGeofenceService.startMonitoring(GEOFENCE, false);
    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));
    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);
  });
});

describe('AutoGeofenceService — double clock-in prevention (awaiting exit)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubLocalStorage();
    vi.useFakeTimers({ now: new Date('2026-08-30T08:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clocking out while on site blocks re-clock-in until a confirmed exit (survives restart)', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    autoGeofenceService.startMonitoring(GEOFENCE, false);
    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));

    // Arrive and auto clock-in.
    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);

    // Employee clocks in, then MANUALLY clocks out while still on site.
    autoGeofenceService.syncClockedIn(true);
    autoGeofenceService.syncClockedIn(false);

    // App reload / monitoring restart while still inside the geofence…
    autoGeofenceService.stopMonitoring();
    autoGeofenceService.startMonitoring(GEOFENCE, false);
    vi.advanceTimersByTime(61_000); // beyond event cooldown

    // …must NOT instantly re-clock-in (first fix inside).
    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);

    // Staying inside also keeps the suppression.
    harness.emitFix({ ...POS_INSIDE, accuracy: 12, timestamp: Date.now() + 30000 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);

    // A confirmed exit releases the guard…
    vi.advanceTimersByTime(61_000);
    harness.emitFix({ ...POS_OUTSIDE, accuracy: 15, timestamp: Date.now() + 60000 });
    harness.emitFix({ ...POS_OUTSIDE, accuracy: 15, timestamp: Date.now() + 90000 });
    harness.emitFix({ ...POS_OUTSIDE, accuracy: 15, timestamp: Date.now() + 120000 });
    expect(events.filter((e) => e.type === 'EXITED_GEOFENCE').length).toBe(1);

    // …and returning inside now auto clocks-in normally (after the usual
    // confirmation samples for a non-initial crossing).
    vi.advanceTimersByTime(61_000);
    harness.emitFix({ ...POS_INSIDE, accuracy: 10, timestamp: Date.now() + 180000 });
    harness.emitFix({ ...POS_INSIDE, accuracy: 10, timestamp: Date.now() + 210000 });
    harness.emitFix({ ...POS_INSIDE, accuracy: 10, timestamp: Date.now() + 240000 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(2);
  });

  it('fresh sessions are never suppressed (initial sync does not arm the guard)', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    // App ordering: the mount-time clock-state sync happens BEFORE monitoring
    // starts (geofences are fetched asynchronously). Must NOT arm the guard.
    autoGeofenceService.syncClockedIn(false);
    autoGeofenceService.startMonitoring(GEOFENCE, false);

    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));
    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);
  });
});

describe('AutoGeofenceService — system-close suppression & live TTL expiry', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubLocalStorage();
    vi.useFakeTimers({ now: new Date('2026-08-30T08:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a system (cron) auto clock-out ARMS the awaiting-exit suppression (no instant re-clock-in on site)', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    autoGeofenceService.startMonitoring(GEOFENCE, false);
    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));

    // Arrive and auto clock-in.
    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);

    // The server cron closes the entry at the configured workday end while the
    // employee is still on site (stakeholder report 2026-09). The SSE payload
    // marks the close as automatic BEFORE the clock-state sync flips to
    // signed-out, so the hook calls noteSystemClockOut() first.
    autoGeofenceService.syncClockedIn(true);
    autoGeofenceService.noteSystemClockOut();
    autoGeofenceService.syncClockedIn(false);

    // App reload / monitoring restart while still inside the geofence…
    autoGeofenceService.stopMonitoring();
    autoGeofenceService.startMonitoring(GEOFENCE, false);
    vi.advanceTimersByTime(61_000); // beyond event cooldown

    // …must NOT auto clock-in again — an on-site system close arms the same
    // suppression as a voluntary on-site clock-out (fixes the cascade of
    // duplicate clock-ins/outs after a working-end auto close).
    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);

    // After the 12h safety TTL (i.e. by the next shift) the suppression
    // releases and the employee can auto clock-in again while still on site.
    vi.advanceTimersByTime(12 * 60 * 60 * 1000);
    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(2);
  });

  it('the system-close note never leaks into a later voluntary clock-out', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    autoGeofenceService.startMonitoring(GEOFENCE, false);
    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));

    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);

    // A system-close note arrives, but the employee is clocked IN again
    // (consuming/resetting the note) and later clocks out VOLUNTARILY while
    // still on site — that clock-out MUST arm the suppression.
    autoGeofenceService.syncClockedIn(true);
    autoGeofenceService.noteSystemClockOut();
    autoGeofenceService.syncClockedIn(true);
    autoGeofenceService.syncClockedIn(false);

    autoGeofenceService.stopMonitoring();
    autoGeofenceService.startMonitoring(GEOFENCE, false);
    vi.advanceTimersByTime(61_000);

    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);
  });

  it('the awaiting-exit suppression expires after the 12h TTL while monitoring runs', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { autoGeofenceService } = await importFreshService();

    autoGeofenceService.startMonitoring(GEOFENCE, false);
    const events: Array<{ type: string }> = [];
    autoGeofenceService.onEvent((e) => events.push({ type: e.type }));

    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);

    // Voluntary on-site clock-out arms the suppression.
    autoGeofenceService.syncClockedIn(true);
    autoGeofenceService.syncClockedIn(false);

    // Well inside the TTL window the employee is still suppressed — staying
    // inside never re-fires the enter event.
    vi.advanceTimersByTime(61_000);
    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(1);

    // Past the 12h safety TTL — WITHOUT any reload/restart — the suppression
    // releases live and the recovery path re-fires the enter event.
    vi.advanceTimersByTime(12 * 60 * 60 * 1000);
    harness.emitFix({ ...POS_INSIDE, accuracy: 10 });
    expect(events.filter((e) => e.type === 'ENTERED_GEOFENCE').length).toBe(2);
  });
});
