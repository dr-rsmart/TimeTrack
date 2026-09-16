import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Execute the actual module-level native pipeline without loading RN UI/Expo
// binaries. OS services are mocked; this is not a device permission test.
const source = readFileSync(new URL('../../mobile/App.js', import.meta.url), 'utf8');
const pipeline = source.slice(
  source.indexOf('const NOTIFICATION_CHANNEL_ID'),
  source.indexOf('export default function App'),
);

function harness() {
  const storage = new Map<string, string>([
    ['timetrack_auth_token', 'test-token'],
    [
      'timetrack_geofences',
      JSON.stringify([{ name: 'Office', latitude: 0, longitude: 0, radiusMeters: 100 }]),
    ],
  ]);
  const fetch = vi.fn().mockResolvedValue({ status: 201, json: async () => ({}) });
  const permission = vi.fn().mockResolvedValue({ status: 'granted' });
  const injectJavaScript = vi.fn();
  const api = runInNewContext(
    `${pipeline}
    webviewBridgeRef = { current: { injectJavaScript } };
    ({ processBackgroundLocation, syncAutoClockStatusToWebview });`,
    {
      console,
      Date,
      fetch,
      injectJavaScript,
      Platform: { OS: 'ios' },
      Notifications: { setNotificationHandler: vi.fn(), scheduleNotificationAsync: vi.fn() },
      TaskManager: { defineTask: vi.fn() },
      Location: {
        hasStartedLocationUpdatesAsync: async () => true,
        getBackgroundPermissionsAsync: permission,
      },
      AsyncStorage: {
        getItem: async (key: string) => storage.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          storage.set(key, value);
        },
        multiSet: async (entries: [string, string][]) =>
          entries.forEach(([key, value]) => storage.set(key, value)),
      },
    },
  ) as {
    processBackgroundLocation: (payload: unknown) => Promise<void>;
    syncAutoClockStatusToWebview: (id: string) => Promise<void>;
  };
  const fix = (accuracy = 20, timestamp = Date.now()) => ({
    timestamp,
    coords: { latitude: 0, longitude: 0, accuracy },
  });
  const sample = async (count = 1, accuracy = 20, timestamp = Date.now()) =>
    api.processBackgroundLocation({
      data: { locations: Array.from({ length: count }, () => fix(accuracy, timestamp)) },
    });
  const snapshot = async () => {
    await api.syncAutoClockStatusToWebview('request-1');
    let detail: Record<string, unknown> = {};
    runInNewContext(injectJavaScript.mock.calls.at(-1)![0], {
      window: {
        dispatchEvent: (event: { detail: Record<string, unknown> }) => {
          detail = event.detail;
        },
      },
      CustomEvent: class {
        constructor(
          public type: string,
          public options: { detail: unknown },
        ) {}
        get detail() {
          return this.options.detail;
        }
      },
    });
    return detail;
  };
  return { storage, fetch, permission, sample, snapshot, api };
}

describe('native pipeline diagnostics', () => {
  it('reports OS sample timestamps and actual 1/3 progress, without credentials', async () => {
    const h = harness();
    const timestamp = Date.now() - 30_000;
    await h.sample(1, 24, timestamp);
    expect(await h.snapshot()).toMatchObject({
      requestId: 'request-1',
      pendingEnter: 1,
      lastAcceptedAt: timestamp,
      sampleZone: 'inside',
      hasToken: true,
    });
    expect(JSON.stringify(await h.snapshot())).not.toContain('test-token');
    expect(h.fetch).not.toHaveBeenCalled();
    await h.sample(2);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.storage.get('timetrack_clocked_in')).toBe('true');
  });

  it('reports poor fixes without presenting them as accepted samples', async () => {
    const h = harness();
    await h.sample(3, 200);
    expect(await h.snapshot()).toMatchObject({
      poorSignal: true,
      lastAcceptedAt: null,
      pendingEnter: 0,
    });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('reports persistent 401 after a native refresh attempt', async () => {
    const h = harness();
    h.storage.set('timetrack_native_refresh_token', 'refresh-test');
    h.fetch
      .mockResolvedValueOnce({ status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'new-test', refreshToken: 'rotated-test' }),
      })
      .mockResolvedValueOnce({ status: 401, json: async () => ({ error: 'private response' }) });
    await h.sample(3);
    expect(h.fetch).toHaveBeenCalledTimes(3);
    expect(await h.snapshot()).toMatchObject({ failure: 'auth' });
    expect(JSON.stringify(await h.snapshot())).not.toContain('private response');
  });

  it('reports and then clears network failure on successful retry', async () => {
    const h = harness();
    h.fetch.mockRejectedValueOnce(new Error('offline'));
    await h.sample(3);
    expect(await h.snapshot()).toMatchObject({ failure: 'network' });
    await h.sample(3);
    expect(await h.snapshot()).toMatchObject({ failure: null });
  });

  it('reads permission changes separately from task registration', async () => {
    const h = harness();
    h.permission.mockResolvedValueOnce({ status: 'denied' });
    expect(await h.snapshot()).toMatchObject({
      backgroundStarted: true,
      backgroundPermission: 'denied',
    });
    expect(await h.snapshot()).toMatchObject({ backgroundPermission: 'granted' });
  });

  it('reports OS task failures without exposing their payload', async () => {
    const h = harness();
    await h.api.processBackgroundLocation({ error: { message: 'private OS details' } });
    expect(await h.snapshot()).toMatchObject({ taskError: true });
    expect(JSON.stringify(await h.snapshot())).not.toContain('private OS details');
  });
});
