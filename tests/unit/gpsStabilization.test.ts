/**
 * Unit tests for client-side GPS stabilization in src/utils/clockInHelper.ts
 *
 * Poor GPS signal: unstable readings (coords.accuracy > 100m) are ignored,
 * and an acquisition that cannot produce a reliable fix falls back to the
 * last reliable position acquired this session (flagged `isCached: true`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  };
}

/** Import a fresh module instance so the last-reliable-position cache starts empty. */
async function importFreshClockInHelper() {
  vi.resetModules();
  return import('../../src/utils/clockInHelper');
}

describe('GPS Stabilization — getCurrentPosition (clockInHelper)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a reliable fix and caches it as the last reliable position', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { getCurrentPosition, getLastReliablePosition } = await importFreshClockInHelper();

    const promise = getCurrentPosition({ timeoutMs: 2000 });
    harness.emitFix({ latitude: -33.9249, longitude: 18.4241, accuracy: 12 });

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result?.latitude).toBe(-33.9249);
    expect(result?.longitude).toBe(18.4241);
    expect(result?.accuracy).toBe(12);
    expect(result?.isCached).toBe(false);

    const cached = getLastReliablePosition();
    expect(cached?.latitude).toBe(-33.9249);
    expect(cached?.isCached).toBe(false);
    // Watch is cleaned up once a fix is accepted.
    expect(harness.activeWatcherCount()).toBe(0);
  });

  it('ignores unstable fixes and resolves with the first reliable one', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { getCurrentPosition } = await importFreshClockInHelper();

    const promise = getCurrentPosition({ timeoutMs: 2000 });
    // Glitch jumps — must be ignored.
    harness.emitFix({ latitude: -33.9000, longitude: 18.9500, accuracy: 238 });
    harness.emitFix({ latitude: -33.9100, longitude: 18.8000, accuracy: 150 });
    // First fix that passes the 100m gate.
    harness.emitFix({ latitude: -33.9249, longitude: 18.4241, accuracy: 20 });

    const result = await promise;
    expect(result?.latitude).toBe(-33.9249);
    expect(result?.longitude).toBe(18.4241);
    expect(result?.accuracy).toBe(20);
    expect(result?.isCached).toBe(false);
  });

  it('falls back to a fresh cached position when only unstable fixes arrive (poor signal)', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { getCurrentPosition } = await importFreshClockInHelper();

    // Seed the cache with a reliable fix.
    const first = getCurrentPosition({ timeoutMs: 2000 });
    harness.emitFix({ latitude: -33.9249, longitude: 18.4241, accuracy: 15 });
    await first;

    // Second acquisition: only a glitch fix arrives, then geolocation errors out.
    const second = getCurrentPosition({ timeoutMs: 2000 });
    harness.emitFix({ latitude: -33.9000, longitude: 18.9500, accuracy: 480 }); // glitch — ignored
    harness.emitError(2, 'Position unavailable');

    const result = await second;
    expect(result?.isCached).toBe(true);
    expect(result?.latitude).toBe(-33.9249); // last reliable, not the glitch
    expect(result?.longitude).toBe(18.4241);
  });

  it('falls back to a fresh cached position when the acquisition times out', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { getCurrentPosition } = await importFreshClockInHelper();

    // Seed the cache with a reliable fix.
    const first = getCurrentPosition({ timeoutMs: 2000 });
    harness.emitFix({ latitude: -33.9249, longitude: 18.4241, accuracy: 15 });
    await first;

    // Second acquisition: only unstable fixes arrive, then the timeout fires.
    const second = getCurrentPosition({ timeoutMs: 100 });
    harness.emitFix({ latitude: -33.9000, longitude: 18.9500, accuracy: 300 }); // glitch — ignored

    const result = await second;
    expect(result?.isCached).toBe(true);
    expect(result?.latitude).toBe(-33.9249);
    expect(harness.activeWatcherCount()).toBe(0); // watch cleaned up on timeout
  });

  it('returns null when no reliable fix arrives and the cache is empty', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { getCurrentPosition, getLastReliablePosition } = await importFreshClockInHelper();

    const byError = getCurrentPosition({ timeoutMs: 2000 });
    harness.emitFix({ latitude: -33.9000, longitude: 18.9500, accuracy: 480 }); // ignored
    harness.emitError(1, 'User denied Geolocation');
    expect(await byError).toBeNull();

    const byTimeout = getCurrentPosition({ timeoutMs: 100 });
    expect(await byTimeout).toBeNull();

    expect(getLastReliablePosition()).toBeNull();
  });

  it('does not use a stale cached position (> 5 minutes) as fallback', async () => {
    const harness = createGeolocationHarness();
    vi.stubGlobal('navigator', { geolocation: harness.geolocation });
    const { getCurrentPosition } = await importFreshClockInHelper();

    // Seed the cache with a reliable fix whose timestamp is already 6 minutes old.
    const staleTimestamp = Date.now() - 6 * 60_000;
    const first = getCurrentPosition({ timeoutMs: 2000 });
    harness.emitFix({ latitude: -33.9249, longitude: 18.4241, accuracy: 15, timestamp: staleTimestamp });
    await first;

    // Next acquisition fails — the stale cache must NOT be served.
    const second = getCurrentPosition({ timeoutMs: 2000 });
    harness.emitError(2, 'Position unavailable');
    expect(await second).toBeNull();
  });

  it('returns null when the device does not support geolocation', async () => {
    vi.stubGlobal('navigator', {});
    const { getCurrentPosition } = await importFreshClockInHelper();

    expect(await getCurrentPosition()).toBeNull();
  });
});