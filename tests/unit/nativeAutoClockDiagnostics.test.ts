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
  const fgPermission = vi.fn().mockResolvedValue({ status: 'granted' });
  const startLocationUpdatesAsync = vi.fn().mockResolvedValue(undefined);
  const injectJavaScript = vi.fn();
  const platform = { OS: 'ios' };
  const notifications = {
    getPermissionsAsync: vi.fn().mockResolvedValue({ status: 'denied' }),
    getExpoPushTokenAsync: vi.fn(),
  };
  const api = runInNewContext(
    `${pipeline}
    webviewBridgeRef = { current: { injectJavaScript } };
    ({ processBackgroundLocation, syncAutoClockStatusToWebview, registerPushTokenWithServer, ensureBackgroundLocationUpdates });`,
    {
      console,
      Date,
      fetch,
      injectJavaScript,
      encodeURIComponent,
      Platform: platform,
      AppState: { currentState: 'active' },
      Notifications: {
        setNotificationHandler: vi.fn(),
        scheduleNotificationAsync: vi.fn(),
        addNotificationResponseReceivedListener: vi.fn(),
        ...notifications,
      },
      TaskManager: { defineTask: vi.fn() },
      Location: {
        Accuracy: { High: 4 },
        hasStartedLocationUpdatesAsync: async () => true,
        getBackgroundPermissionsAsync: permission,
        getForegroundPermissionsAsync: fgPermission,
        startLocationUpdatesAsync,
        hasStartedGeofencingAsync: async () => false,
        startGeofencingAsync: async () => undefined,
        stopGeofencingAsync: async () => undefined,
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
    registerPushTokenWithServer: () => Promise<void>;
    ensureBackgroundLocationUpdates: () => Promise<void>;
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
  return {
    storage,
    fetch,
    permission,
    fgPermission,
    startLocationUpdatesAsync,
    platform,
    notifications,
    sample,
    snapshot,
    api,
  };
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

  it('records the push registration outcome without storing the token', async () => {
    const h = harness();
    // Notifications permission not granted → explicit, visible outcome.
    await h.api.registerPushTokenWithServer();
    expect(await h.snapshot()).toMatchObject({ pushRegistration: 'permission-denied' });

    // Granted, but Expo cannot mint a token (missing APNs/FCM credentials).
    h.notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    h.notifications.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('no aps-environment'));
    await h.api.registerPushTokenWithServer();
    expect(await h.snapshot()).toMatchObject({ pushRegistration: 'token-failed' });

    // Token minted, server rejects → status code surfaced.
    h.notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    h.fetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
    await h.api.registerPushTokenWithServer();
    expect(await h.snapshot()).toMatchObject({ pushRegistration: 'server-400' });

    // Happy path: registered, platform sent, token kept locally for sign-out only.
    h.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await h.api.registerPushTokenWithServer();
    const snap = await h.snapshot();
    expect(snap).toMatchObject({ pushRegistration: 'registered' });
    expect(typeof snap.pushRegistrationAt).toBe('number');
    expect(JSON.stringify(snap)).not.toContain('ExponentPushToken');
    const [url, init] = h.fetch.mock.calls.at(-1)!;
    expect(url).toBe('https://time-track.tech/api/auth/push-token');
    expect(JSON.parse(init.body)).toEqual({ token: 'ExponentPushToken[abc]', platform: 'ios' });
    expect(h.storage.get('timetrack_push_token')).toBe('ExponentPushToken[abc]');
  });

  it('refreshes a stale native token once and retries the push registration', async () => {
    const h = harness();
    h.storage.set('timetrack_native_refresh_token', 'refresh-test');
    h.notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    h.notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[xyz]' });
    h.fetch
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'fresh-token', refreshToken: 'rotated-refresh' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await h.api.registerPushTokenWithServer();
    expect(h.fetch).toHaveBeenCalledTimes(3);
    expect(h.fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh-token');
    expect(await h.snapshot()).toMatchObject({ pushRegistration: 'registered' });
  });

  it('reports OS task failures without exposing their payload', async () => {
    const h = harness();
    await h.api.processBackgroundLocation({ error: { message: 'private OS details' } });
    expect(await h.snapshot()).toMatchObject({ taskError: true });
    expect(JSON.stringify(await h.snapshot())).not.toContain('private OS details');
  });

  it('arms foreground-initiated background location on both Android and iOS when device does not grant "Allow all the time" / "Always" yet but consent + foreground permission are granted', async () => {
    for (const os of ['android', 'ios']) {
      const h = harness();
      h.platform.OS = os;
      h.permission.mockResolvedValue({ status: 'denied' });
      h.fgPermission.mockResolvedValue({ status: 'granted' });
      h.storage.set('timetrack_bg_disclosure_consent', 'granted');
      if (os === 'ios') {
        // Simulate not yet started on iOS so startLocationUpdatesAsync is called
        await h.api.ensureBackgroundLocationUpdates();
      } else {
        await h.api.ensureBackgroundLocationUpdates();
      }
      expect(await h.snapshot()).toMatchObject({
        backgroundArmed: true,
        backgroundBlockedReason: null,
        backgroundPermission: 'granted',
      });
    }
  });

  it('completes closed-app auto clock-out on a single OS geofence exit wake (fromRegionTask)', async () => {
    const h = harness();
    h.storage.set('timetrack_clocked_in', 'true');
    h.fetch.mockResolvedValueOnce({ status: 200, json: async () => ({}) });
    const farFix = {
      timestamp: Date.now(),
      coords: { latitude: 0.01, longitude: 0.01, accuracy: 15 },
    };
    await h.api.processBackgroundLocation({
      data: { locations: [farFix, farFix, farFix], fromRegionTask: true },
    });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0][0]).toContain('/api/time-entries/clock-out');
    expect(h.storage.get('timetrack_clocked_in')).toBe('false');
  });

  it('enables R8/ProGuard for Google Play Vitals while explicitly keeping RNHeadlessAppLoader and expo.modules.** to prevent Android startup/background crashes', () => {
    const appJson = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8'));
    const buildProps = appJson.expo.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === 'expo-build-properties',
    );
    expect(buildProps?.[1]?.android?.enableProguardInReleaseBuilds).toBe(true);
    expect(buildProps?.[1]?.android?.enableShrinkResourcesInReleaseBuilds).toBe(true);
    expect(buildProps?.[1]?.android?.extraProguardRules).toContain('RNHeadlessAppLoader');
    expect(buildProps?.[1]?.android?.extraProguardRules).toContain(
      '-keep class expo.modules.** { *; }',
    );
  });

  it('serializes ensureBackgroundLocationUpdates on Android foreground and does not block WebView mount on push-token network calls', async () => {
    const h = harness();
    h.platform.OS = 'android';
    await Promise.all([
      h.api.ensureBackgroundLocationUpdates(),
      h.api.ensureBackgroundLocationUpdates(),
      h.api.ensureBackgroundLocationUpdates(),
    ]);
    await h.api.ensureBackgroundLocationUpdates();
    expect(h.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(source).not.toContain('await registerPushTokenWithServer()');
  });
});
