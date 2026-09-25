/**
 * TimeTrack Native Shell
 * ----------------------
 * React Native / Expo shell that hosts the production TimeTrack web app
 * in a WebView and runs NATIVE background geofence location monitoring so
 * employees are automatically clocked in / out when they enter or leave
 * their assigned work location — even when the app is closed or the device
 * is locked.
 *
 * Hybrid auto clock-in/out (2026-09): the hosted web app's own geofence
 * monitor is the PRIMARY punch path while the WebView is open (foreground);
 * the native background task below is the BACKUP that covers closed/locked/
 * backgrounded states. Server-side dedupe (partial unique index +
 * 409 ALREADY_CLOCKED_IN) makes the two paths safe to run simultaneously.
 *
 * Background location strategy:
 *  - expo-location foreground + background location (startLocationUpdatesAsync)
 *  - expo-task-manager background task processes location fixes while suspended
 *  - Local notifications confirm auto clock-in / clock-out events
 *
 * Network resilience (added after closed-test net::ERR_NAME_NOT_RESOLVED reports):
 *  - NetInfo connectivity tracking with a dedicated offline screen
 *  - Automatic reload the moment the device reconnects
 *  - Exponential backoff auto-retry (2s -> 5s -> 10s -> 30s) on WebView load errors
 *  - Strict validation of TIMETRACK_URL so it can never navigate to undefined
 *
 * Rendering philosophy (added after closed-test "stuck on Loading TimeTrack…"
 * reports): the WebView is mounted VISIBLE from the first frame and no native
 * view ever covers it. The web app renders its own UI (login page, spinners);
 * the shell only draws a thin, non-interactive top progress bar while the
 * document loads. Error/offline screens replace the WebView only on genuine,
 * confirmed load failures — so the web page can never be hidden by the shell.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
  Text,
  Platform,
  AppState,
  Linking,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const NOTIFICATION_CHANNEL_ID = 'geofence-events';

// Foreground notifications are hidden by default unless an explicit handler
// opts into displaying them. Use the same channel and sound for every
// automatic punch, whether the app is foregrounded or backgrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function configureNotifications() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
    name: 'Geofence events',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

async function registerPushTokenWithServer() {
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') return;
    const token = await Notifications.getExpoPushTokenAsync();
    const accessToken = await AsyncStorage.getItem(TOKEN_KEY);
    if (!accessToken || !token?.data) return;
    await fetch(`${TIMETRACK_URL}/api/auth/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token: token.data, platform: Platform.OS }),
    });
  } catch (error) {
    console.warn('[TimeTrack] Could not register push token:', error?.message || error);
  }
}

// Production TimeTrack web app URL
const TIMETRACK_URL = 'https://time-track.tech';

// Fail fast on a malformed/missing URL — a bad value would otherwise surface
// inside the WebView as a confusing net::ERR_* load failure.
if (
  typeof TIMETRACK_URL !== 'string' ||
  !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/|$)/i.test(TIMETRACK_URL)
) {
  throw new Error(`TIMETRACK_URL is invalid: ${String(TIMETRACK_URL)}`);
}

// Auto-retry schedule (ms) applied when the WebView fails to load:
// 2s -> 5s -> 10s -> 30s (capped). Manual retry resets the schedule.
const RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];

// Background task identifier
const BACKGROUND_LOCATION_TASK = 'timetrack-background-location-task';

// AsyncStorage keys (populated by the web app via postMessage bridge)
const GEOFENCE_KEY = 'timetrack_geofence';
/** Multi-location: JSON array of ALL assigned geofences (new builds). */
const GEOFENCE_LIST_KEY = 'timetrack_geofences';
const CLOCKED_IN_KEY = 'timetrack_clocked_in';
/** Mirrored web setting: false disables native automatic punches. */
const AUTO_CLOCK_ENABLED_KEY = 'timetrack_auto_clock_enabled';
const TOKEN_KEY = 'timetrack_auth_token';
const REFRESH_TOKEN_KEY = 'timetrack_native_refresh_token';
/** Employee email of the current native session (per-user state guard). */
const SESSION_EMAIL_KEY = 'timetrack_session_email';
/** Persisted boundary state machine (zone, confirmation counters, cooldown). */
const GEOFENCE_STATE_KEY = 'timetrack_geofence_state';
/** Sanitised diagnostics only — never store tokens or API response bodies here. */
const AUTO_CLOCK_DIAGNOSTICS_KEY = 'timetrack_auto_clock_diagnostics';
/** Timestamp of the last background-permission guidance alert (24 h throttle). */
const BG_PERMISSION_PROMPTED_KEY = 'timetrack_bg_permission_prompted';
/** Re-surface the background-permission guidance at most once per day. */
const BG_PERMISSION_REPROMPT_MS = 24 * 60 * 60 * 1000;

/**
 * Read ALL monitored geofences. Prefers the multi-location list; falls back
 * to the legacy single-geofence key for older web-build bridges.
 */
async function readGeofences() {
  try {
    const listRaw = await AsyncStorage.getItem(GEOFENCE_LIST_KEY);
    if (listRaw) {
      const list = JSON.parse(listRaw);
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch {
    /* fall through to legacy key */
  }
  try {
    const raw = await AsyncStorage.getItem(GEOFENCE_KEY);
    if (raw) return [JSON.parse(raw)];
  } catch {
    /* ignore */
  }
  return [];
}

// ── Geofence hysteresis constants (mirrors src/services/AutoGeofenceService.ts) ──
// Keep in sync with the web implementation (src/constants/geofence.ts).
// NOTE: the web watcher is continuous and clocks in on the FIRST accepted fix
// (isInitialFix bypass); native background wakes are sparse, so every crossing
// here requires CONFIRMATIONS consecutive samples. Only the tuning constants
// are shared — that asymmetry is intentional.
const EXIT_BUFFER_METERS = 200; // grace distance outside radius before clock-out
const MAX_ACCURACY_METERS = 150; // fixes worse than this are ignored
const CONFIRMATIONS = 3; // consecutive samples required to confirm a crossing (mirrors src/constants/geofence.ts GEOFENCE_CONFIRMATIONS)
const EVENT_COOLDOWN_MS = 60_000; // minimum time between clock events
/** Safety expiry for the clockedOutInside suppression (mirrors web AWAITING_EXIT_TTL_MS). */
const CLOCKED_OUT_INSIDE_TTL_MS = 12 * 60 * 60 * 1000;

// Haversine distance in metres
function distanceMetres(a, b) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ── API helpers: actually clock in/out against the TimeTrack backend ──
async function requestClock(kind, pos, idempotencyKey, offlineInfo) {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return { status: 401, data: {} };

  const isClockIn = kind === 'in';
  const url = `${TIMETRACK_URL}/api/time-entries/${isClockIn ? 'clock-in' : 'clock-out'}`;
  // The caller persists this key before sending the request. If the OS
  // interrupts the task after the server commits, the next invocation replays
  // the same mutation instead of creating a second attendance record.
  const requestKey =
    idempotencyKey || `native-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = isClockIn
    ? // Native punches are ALWAYS geofence automation — the automatic flag
      // subjects them to the server's once-per-working-day limit after a
      // system (cron) working-end close (409 DAILY_SESSION_LIMIT).
      { latitude: pos.latitude, longitude: pos.longitude, automatic: true }
    : { breakMinutes: 0, latitude: pos.latitude, longitude: pos.longitude };
  if (offlineInfo && typeof offlineInfo.capturedAt === 'number') {
    // Offline outbox replay: the server stamps the entry at the ORIGINAL
    // capture instant within its bounded acceptance window and flags it
    // isOfflineSynced (422 OFFLINE_PUNCH_EXPIRED beyond the window).
    body.offline = true;
    body.capturedAt = new Date(offlineInfo.capturedAt).toISOString();
  }

  let res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': requestKey,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 && (await refreshNativeAccessToken())) {
    const nextToken = await AsyncStorage.getItem(TOKEN_KEY);
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nextToken}`,
        'Idempotency-Key': requestKey,
      },
      body: JSON.stringify(body),
    });
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function updateAutoClockDiagnostics(patch) {
  try {
    const raw = await AsyncStorage.getItem(AUTO_CLOCK_DIAGNOSTICS_KEY);
    await AsyncStorage.setItem(
      AUTO_CLOCK_DIAGNOSTICS_KEY,
      JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), ...patch }),
    );
  } catch {
    // Diagnostics must not interrupt attendance processing.
  }
}

async function apiClock(kind, pos, idempotencyKey, offlineInfo) {
  try {
    const result = await requestClock(kind, pos, idempotencyKey, offlineInfo);
    const failure =
      result.status === 401
        ? 'auth'
        : result.data?.code === 'RECLOCK_GUARD'
          ? 'reclock'
          : result.status >= 500
            ? 'server'
            : result.status >= 400
              ? 'rejected'
              : null;
    await updateAutoClockDiagnostics({ failure });
    return result;
  } catch {
    await updateAutoClockDiagnostics({ failure: 'network' });
    // Offline punch outbox: the punch could not reach the server. Queue it
    // with its idempotency key and capture time so it replays (server-side
    // deduped) when connectivity returns — punches are never silently lost.
    await enqueuePunchOutbox({
      kind,
      pos: { latitude: pos.latitude, longitude: pos.longitude },
      capturedAt:
        offlineInfo && typeof offlineInfo.capturedAt === 'number'
          ? offlineInfo.capturedAt
          : Date.now(),
      key: idempotencyKey || `native-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    return { status: 0, data: {} };
  }
}

async function refreshNativeAccessToken() {
  const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;
  const response = await fetch(`${TIMETRACK_URL}/api/auth/native-token/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) return false;
  const data = await response.json();
  if (!data?.token || !data?.refreshToken) return false;
  await AsyncStorage.multiSet([
    [TOKEN_KEY, data.token],
    [REFRESH_TOKEN_KEY, data.refreshToken],
  ]);
  return true;
}

async function notify(title, body) {
  try {
    // Background tasks can start before the React component's permission
    // effect has created the Android channel. Ensure the channel exists at the
    // point of delivery as well as during app startup.
    await configureNotifications();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: { source: 'geofence' },
        ...(Platform.OS === 'android' ? { channelId: NOTIFICATION_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
    return true;
  } catch (error) {
    console.warn('[TimeTrack] Could not schedule geofence notification:', error?.message || error);
    return false;
  }
}

async function retryPendingNotification() {
  try {
    const raw = await AsyncStorage.getItem(GEOFENCE_STATE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    if (!state?.pendingNotification?.title || !state?.pendingNotification?.body) return;
    if (await notify(state.pendingNotification.title, state.pendingNotification.body)) {
      state.pendingNotification = null;
      await AsyncStorage.setItem(GEOFENCE_STATE_KEY, JSON.stringify(state));
    }
  } catch {
    // Notification delivery is best effort; the next resume/location wake retries.
  }
}

// ── Background task: runs while app is suspended / closed ──
// Detects geofence boundary crossings with the same hysteresis as the web
// service (accuracy gate + confirmation samples + cooldown) and performs the
// REAL clock-in/out API call, so attendance is recorded even when the WebView
// is suspended. The web app keeps GEOFENCE(_LIST)_KEY / CLOCKED_IN_KEY /
// TOKEN_KEY fresh via the postMessage bridge.
//
// MULTI-LOCATION: employees assigned to several sites are clocked IN when
// they enter ANY assigned geofence and clocked OUT only when they leave ALL
// of them (distance > radius + 200m for every location).
//
// DOUBLE CLOCK-IN GUARD (mirrors the web "awaiting exit" flag): when the
// boundary state says the employee clocked out while still on site
// (st.clockedOutInside), auto clock-in is suppressed until a fix proves they
// left every assigned location. The suppression is armed by VOLUNTARY
// clock-outs AND by system (cron) auto-closes (CLOCK_STATE bySystem) — a
// working-end close must never be followed by an instant re-clock-in on
// site — and it expires automatically after CLOCKED_OUT_INSIDE_TTL_MS.
async function processBackgroundLocation({ data, error }) {
  if (error) {
    await updateAutoClockDiagnostics({ taskError: true });
    void syncAutoClockStatusToWebview();
    return;
  }
  if (!data?.locations?.length) return;

  // Opportunistically drain the offline punch outbox on every location wake
  // (no-op when the queue is empty; serialized by punchOutboxReplaying).
  void replayPunchOutbox();

  try {
    // The WebView owns the user-facing setting. The native task must honor the
    // same value or a disabled app can still clock the employee out in the
    // background.
    if ((await AsyncStorage.getItem(AUTO_CLOCK_ENABLED_KEY)) === 'false') return;

    const geofences = await readGeofences();
    if (geofences.length === 0) return;

    const stateRaw = await AsyncStorage.getItem(GEOFENCE_STATE_KEY);
    const st = stateRaw
      ? JSON.parse(stateRaw)
      : {
          zone: null,
          pendingEnter: 0,
          pendingExit: 0,
          lastEventAt: 0,
          clockedOutInside: false,
          clockedOutInsideSetAt: null,
          pendingAction: null,
          pendingNotification: null,
        };
    if (typeof st.clockedOutInside !== 'boolean') st.clockedOutInside = false;
    if (typeof st.clockedOutInsideSetAt !== 'number') st.clockedOutInsideSetAt = null;
    // The double clock-in suppression must never be permanent. Expire flags
    // armed more than 12h ago, and release legacy flags persisted without a
    // timestamp (older builds) — otherwise an employee who stayed on site
    // after a shift-end auto close could NEVER auto clock-in again.
    if (
      st.clockedOutInside &&
      (st.clockedOutInsideSetAt === null ||
        Date.now() - st.clockedOutInsideSetAt > CLOCKED_OUT_INSIDE_TTL_MS)
    ) {
      console.info('[TimeTrack] clockedOutInside suppression expired (12h TTL) — releasing.');
      st.clockedOutInside = false;
      st.clockedOutInsideSetAt = null;
    }
    if (!st.pendingAction || typeof st.pendingAction !== 'object') st.pendingAction = null;
    if (!st.pendingNotification || typeof st.pendingNotification !== 'object')
      st.pendingNotification = null;

    let clockedIn = (await AsyncStorage.getItem(CLOCKED_IN_KEY)) === 'true';
    // Seed the zone from clock state (mirrors web syncClockedIn). A clocked-in
    // user is treated as INSIDE so clock-out can fire on the first crossing.
    // A NOT-clocked-in user with fresh state remains unseeded so the first
    // confirmed inside fix can perform a legitimate auto clock-in. The
    // clockedOutInside flag is armed by the explicit CLOCK_STATE
    // true -> false transition (voluntary AND system/cron closes) while the
    // employee may still be on site, and it expires
    // after CLOCKED_OUT_INSIDE_TTL_MS.
    if (!st.zone) {
      st.zone = clockedIn ? 'inside' : null;
    }

    const now = Date.now();

    // A successful attendance mutation must still produce its user-visible
    // notification. Retry notification scheduling on the next location wake
    // if the OS temporarily rejected the first scheduling attempt.
    if (st.pendingNotification?.title && st.pendingNotification?.body) {
      if (await notify(st.pendingNotification.title, st.pendingNotification.body)) {
        st.pendingNotification = null;
        await AsyncStorage.setItem(GEOFENCE_STATE_KEY, JSON.stringify(st));
      }
    }

    for (const loc of data.locations) {
      // Use the OS fix timestamp, not the time a batched task happens to wake.
      const sampleAt = Number.isFinite(loc.timestamp) ? loc.timestamp : null;
      await updateAutoClockDiagnostics({ lastSampleAt: sampleAt, taskError: false });
      const accuracy = loc.coords?.accuracy;
      const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };

      // ── Distance profile across ALL assigned geofences ──
      let nearest = geofences[0];
      let nearestDist = Infinity;
      let inside = false; // inside ANY geofence
      let outside = true; // outside ALL geofences (radius + exit buffer)
      for (const gf of geofences) {
        const radius = gf.radiusMeters || 300;
        const d = distanceMetres(pos, gf);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = gf;
        }
        if (d <= radius) inside = true;
        if (d <= radius + EXIT_BUFFER_METERS) outside = false;
      }

      // ── Accuracy gate ──
      // Coarse fixes (> MAX_ACCURACY_METERS) are normally dropped, BUT are
      // accepted when they clearly prove the user is far away from EVERY
      // assigned location (distance − accuracy > radius + exit buffer). This
      // makes auto clock-out reliable while driving away even when only
      // coarse network fixes arrive (GPS radio sleeping).
      const coarseFix =
        typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_METERS;
      if (coarseFix) {
        const clearlyFarEverywhere = geofences.every((gf) => {
          const radius = gf.radiusMeters || 300;
          return distanceMetres(pos, gf) - accuracy > radius + EXIT_BUFFER_METERS;
        });
        if (!clearlyFarEverywhere) {
          await updateAutoClockDiagnostics({ poorSignal: true });
          continue;
        }
        // Coarse-but-clearly-far fix: treat as an outside signal only.
        inside = false;
        outside = true;
      }

      await updateAutoClockDiagnostics({
        lastAcceptedAt: sampleAt,
        sampleZone: inside ? 'inside' : outside ? 'outside' : 'approaching',
        poorSignal: false,
      });

      // A clearly-outside fix releases the double-clock-in suppression.
      if (outside && st.clockedOutInside) {
        st.clockedOutInside = false;
        st.clockedOutInsideSetAt = null;
      }

      if (inside && st.zone !== 'inside') {
        st.pendingExit = 0;
        st.pendingEnter += 1;
        if (
          st.pendingEnter >= CONFIRMATIONS &&
          !clockedIn &&
          now - st.lastEventAt >= EVENT_COOLDOWN_MS
        ) {
          st.pendingEnter = 0;
          if (st.clockedOutInside) {
            // Double clock-in guard: employee clocked out while still on site.
            // Do NOT re-clock-in until they leave every assigned location.
            console.info(
              '[TimeTrack] Auto clock-in suppressed: awaiting a confirmed exit ' +
                '(clocked out while on site).',
            );
            continue;
          }
          const pendingAction =
            st.pendingAction?.kind === 'in' && typeof st.pendingAction.key === 'string'
              ? st.pendingAction
              : {
                  kind: 'in',
                  key: `native-in-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                };
          st.pendingAction = pendingAction;
          await AsyncStorage.setItem(GEOFENCE_STATE_KEY, JSON.stringify(st));
          const { status, data: resBody } = await apiClock('in', pos, pendingAction.key);
          const reclockBlocked = status === 409 && resBody?.code === 'RECLOCK_GUARD';
          const alreadyActive =
            !reclockBlocked &&
            (status === 409 ||
              resBody?.code === 'DUPLICATE_ACTIVE' ||
              String(resBody?.error || '')
                .toLowerCase()
                .includes('already clocked'));
          if (status === 201 || status === 200 || alreadyActive) {
            await updateAutoClockDiagnostics({ failure: null });
            st.zone = 'inside';
            st.lastEventAt = Date.now();
            st.pendingAction = null;
            clockedIn = true;
            await AsyncStorage.setItem(CLOCKED_IN_KEY, 'true');
            if (!alreadyActive) {
              const title = 'Auto Clock In';
              const body = `You entered \"${nearest.name}\". Shift started automatically.`;
              if (!(await notify(title, body))) st.pendingNotification = { title, body };
            }
          } else if (reclockBlocked) {
            // Server re-clock guard: too soon after the last clock-out. Leave
            // the zone unset so the next confirming sample retries naturally.
            st.lastEventAt = Date.now();
          } else if (status === 409 && resBody?.code === 'DAILY_SESSION_LIMIT') {
            // Today's session was already closed automatically at the
            // configured workday end. Arm the double clock-in guard so the
            // background task stops trying to re-clock-in on site; a
            // confirmed exit (or the 12h TTL) releases it for the next shift.
            st.clockedOutInside = true;
            st.clockedOutInsideSetAt = Date.now();
            st.lastEventAt = Date.now();
          }
          // 401 (expired token) or 403: leave state untouched — the web app
          // will re-sync the token/state next time it runs.
        } else if (st.pendingEnter >= CONFIRMATIONS && clockedIn) {
          // The employee was clocked in by a manual/remote action while the
          // native state machine was outside or unseeded. Advance the
          // boundary state even though no clock-in API call is required, so a
          // later exit can be detected normally.
          st.pendingEnter = 0;
          st.zone = 'inside';
        }
      } else if (outside && st.zone !== 'outside') {
        st.pendingEnter = 0;
        st.pendingExit += 1;
        if (
          st.pendingExit >= CONFIRMATIONS &&
          clockedIn &&
          now - st.lastEventAt >= EVENT_COOLDOWN_MS
        ) {
          st.pendingExit = 0;
          const pendingAction =
            st.pendingAction?.kind === 'out' && typeof st.pendingAction.key === 'string'
              ? st.pendingAction
              : {
                  kind: 'out',
                  key: `native-out-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                };
          st.pendingAction = pendingAction;
          await AsyncStorage.setItem(GEOFENCE_STATE_KEY, JSON.stringify(st));
          const { status, data: resBody } = await apiClock('out', pos, pendingAction.key);
          const noActive =
            status === 404 ||
            String(resBody?.error || '')
              .toLowerCase()
              .includes('no active');
          if (status === 200 || noActive) {
            await updateAutoClockDiagnostics({ failure: null });
            st.zone = 'outside';
            st.lastEventAt = Date.now();
            st.pendingAction = null;
            clockedIn = false;
            await AsyncStorage.setItem(CLOCKED_IN_KEY, 'false');
            if (!noActive) {
              const title = 'Auto Clock Out';
              const body = `You left \"${nearest.name}\". Shift ended automatically.`;
              if (!(await notify(title, body))) st.pendingNotification = { title, body };
            }
          }
        } else if (st.pendingExit >= CONFIRMATIONS && !clockedIn) {
          // A signed-out employee can leave the site without needing an API
          // call. Still commit the outside boundary so returning later is a
          // real outside -> inside transition and can auto clock in.
          st.pendingExit = 0;
          st.zone = 'outside';
        }
      } else {
        // Approaching zone or no crossing in progress — reset pending counters.
        st.pendingEnter = 0;
        st.pendingExit = 0;
      }
    }

    await AsyncStorage.setItem(GEOFENCE_STATE_KEY, JSON.stringify(st));
    // Let the open WebView explain the current auto-clock situation.
    void syncAutoClockStatusToWebview();
  } catch {
    // Never crash the background task
  }
}

// Expo may invoke a background task again before a previous invocation has
// finished its network request. Serialize invocations so the persisted state
// machine and its idempotency key are updated in order.
let backgroundTaskQueue = Promise.resolve();
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, (payload) => {
  const next = backgroundTaskQueue.then(() => processBackgroundLocation(payload));
  backgroundTaskQueue = next.catch(() => undefined);
  return next;
});

/**
 * Start native background updates whenever permissions become available.
 * Android/iOS may require the user to grant "Always"/background location from
 * system Settings after the initial foreground permission prompt; callers
 * retry this helper when the app returns to the foreground.
 */
async function ensureBackgroundLocationUpdates() {
  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (started) return;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    // High accuracy: Balanced (network-only) fixes frequently exceed
    // the 150m accuracy gate, which previously prevented auto
    // clock-out detection while driving away from the site.
    accuracy: Location.Accuracy.High,
    timeInterval: 30000,
    distanceInterval: 50,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'TimeTrack',
      notificationBody: 'Monitoring work location for auto clock-in/out',
    },
    pausesUpdatesAutomatically: false,
  });
}

// ── Native → WebView auto-clock observability bridge ──
// Hybrid model: the web geofence monitor is the PRIMARY foreground punch path
// (even inside the WebView) and this native background task is the BACKUP for
// closed/locked states. Employee-facing screens still need to see WHY a
// background punch has not fired. Publish a compact status snapshot —
// suppression flag, boundary zone, confirmation progress and whether the OS
// background task is actually running — using the same injectJavaScript
// pattern as the auth-token bridge. Observability only: failures are silent.
const NATIVE_AUTO_CLOCK_EVENT = 'timetrack-native-auto-clock';
let webviewBridgeRef = null; // set to the <App> webview ref while mounted
let autoClockSessionGeneration = 0;

async function syncAutoClockStatusToWebview(requestId) {
  const bridge = webviewBridgeRef ? webviewBridgeRef.current : null;
  if (!bridge) return;
  const generation = autoClockSessionGeneration;
  try {
    const [backgroundStarted, permission, token, enabled, geofences, diagnosticsRaw] =
      await Promise.all([
        Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => null),
        Location.getBackgroundPermissionsAsync().catch(() => null),
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(AUTO_CLOCK_ENABLED_KEY),
        readGeofences(),
        AsyncStorage.getItem(AUTO_CLOCK_DIAGNOSTICS_KEY),
      ]);
    const diagnostics = diagnosticsRaw ? JSON.parse(diagnosticsRaw) : {};
    let st = null;
    try {
      const stateRaw = await AsyncStorage.getItem(GEOFENCE_STATE_KEY);
      st = stateRaw ? JSON.parse(stateRaw) : null;
    } catch {
      st = null;
    }
    const detail = {
      requestId: typeof requestId === 'string' ? requestId : null,
      suppressed: Boolean(st && st.clockedOutInside),
      suppressedSetAt:
        st && typeof st.clockedOutInsideSetAt === 'number' ? st.clockedOutInsideSetAt : null,
      zone: st && (st.zone === 'inside' || st.zone === 'outside') ? st.zone : null,
      pendingEnter: st && typeof st.pendingEnter === 'number' ? st.pendingEnter : 0,
      backgroundStarted,
      backgroundPermission: permission?.status ?? null,
      enabled: enabled !== 'false',
      hasToken: Boolean(token),
      monitoredCount: geofences.length,
      lastSampleAt: diagnostics.lastSampleAt ?? null,
      lastAcceptedAt: diagnostics.lastAcceptedAt ?? null,
      sampleZone: diagnostics.sampleZone ?? null,
      poorSignal: diagnostics.poorSignal === true,
      taskError: diagnostics.taskError === true,
      failure: diagnostics.failure ?? null,
      outboxCount:
        typeof diagnostics.outboxCount === 'number' && diagnostics.outboxCount >= 0
          ? Math.min(Math.floor(diagnostics.outboxCount), PUNCH_OUTBOX_MAX_ITEMS)
          : 0,
      cooldownUntil: st?.lastEventAt ? st.lastEventAt + EVENT_COOLDOWN_MS : null,
      at: Date.now(),
    };
    if (generation !== autoClockSessionGeneration || bridge !== webviewBridgeRef?.current) return;
    bridge.injectJavaScript(`
      try {
        window.dispatchEvent(new CustomEvent('${NATIVE_AUTO_CLOCK_EVENT}', { detail: ${JSON.stringify(detail)} }));
      } catch (_) {}
      true;
    `);
  } catch {
    /* observability only — never break the background pipeline */
  }
}

// ── Offline punch outbox ─────────────────────────────────────────────────
// Punches that could not reach the server (offline / DNS failure) are queued
// here with their ORIGINAL capture timestamp and idempotency key. Replayed on
// reconnect / app resume / next background location wake with offline:true so
// the server stamps the entry at capturedAt within its bounded acceptance
// window. Terminal server responses (expired window, already clocked, reclock
// guard, rejected) DROP the item; only network/5xx failures keep it queued.
const PUNCH_OUTBOX_KEY = 'timetrack_punch_outbox';
const PUNCH_OUTBOX_MAX_ITEMS = 20;
// Mirrors the server OFFLINE_PUNCH_WINDOW_HOURS default (4h). Older items are
// dropped locally — the server would reject them with OFFLINE_PUNCH_EXPIRED.
const PUNCH_OUTBOX_TTL_MS = 4 * 60 * 60 * 1000;
let punchOutboxReplaying = false;

async function readPunchOutbox() {
  try {
    const raw = await AsyncStorage.getItem(PUNCH_OUTBOX_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function writePunchOutbox(items) {
  try {
    await AsyncStorage.setItem(PUNCH_OUTBOX_KEY, JSON.stringify(items));
  } catch {
    // Storage failure must never interrupt attendance processing.
  }
}

async function enqueuePunchOutbox(item) {
  if (!item || typeof item.key !== 'string' || !item.pos) return;
  const items = await readPunchOutbox();
  if (items.some((i) => i && i.key === item.key)) return; // already queued
  items.push(item);
  while (items.length > PUNCH_OUTBOX_MAX_ITEMS) items.shift();
  await writePunchOutbox(items);
  await updateAutoClockDiagnostics({ outboxCount: items.length });
  void syncAutoClockStatusToWebview();
}

async function replayPunchOutbox() {
  if (punchOutboxReplaying) return;
  punchOutboxReplaying = true;
  try {
    const queued = await readPunchOutbox();
    if (queued.length === 0) return;
    const now = Date.now();
    const fresh = queued.filter(
      (i) => i && typeof i.capturedAt === 'number' && now - i.capturedAt <= PUNCH_OUTBOX_TTL_MS,
    );
    const remaining = [];
    for (const item of fresh) {
      const { status } = await apiClock(item.kind, item.pos, item.key, {
        capturedAt: item.capturedAt,
      });
      if (status === 0 || status >= 500 || status === 401) {
        // Network / server / transient-auth failure: keep queued for the next
        // replay opportunity (reconnect, resume, next background wake).
        remaining.push(item);
        continue;
      }
      if (status === 200 || status === 201) {
        const clockedInNow = item.kind === 'in';
        await AsyncStorage.setItem(CLOCKED_IN_KEY, String(clockedInNow));
        await updateAutoClockDiagnostics({ failure: null, taskError: false });
        const title = clockedInNow ? 'Clocked in (synced)' : 'Clocked out (synced)';
        const body = clockedInNow
          ? 'Your offline auto clock-in was recorded with its original timestamp.'
          : 'Your offline auto clock-out was recorded with its original timestamp.';
        await notify(title, body);
        if (!clockedInNow) {
          // Mirror the voluntary clock-out double-punch guard: the offline
          // clock-out may have happened while still on site, so suppress an
          // instant re-clock-in until a confirmed exit (12h TTL applies).
          try {
            const stateRaw = await AsyncStorage.getItem(GEOFENCE_STATE_KEY);
            const st = stateRaw ? JSON.parse(stateRaw) : {};
            st.clockedOutInside = true;
            st.clockedOutInsideSetAt = Date.now();
            await AsyncStorage.setItem(GEOFENCE_STATE_KEY, JSON.stringify(st));
          } catch {
            // State repair is best-effort.
          }
        }
      }
      // Any other 4xx (OFFLINE_PUNCH_EXPIRED, ALREADY_CLOCKED_IN, RECLOCK_GUARD,
      // GEOFENCE_VIOLATION, NO_ACTIVE_SESSION, ...) is terminal: drop the item.
    }
    await writePunchOutbox(remaining);
    await updateAutoClockDiagnostics({ outboxCount: remaining.length });
    void syncAutoClockStatusToWebview();
  } catch {
    // Replay is best-effort; the next wake retries.
  } finally {
    punchOutboxReplaying = false;
  }
}

// ── iOS BGTaskScheduler watchdog ───────────────────────────────────────────
// Even with "Always" location permission, iOS can terminate the app and stop
// the location task (memory pressure, OS updates, long idle). This
// BGAppRefreshTask periodically wakes the app in the background to RE-ARM
// startLocationUpdatesAsync and drain the offline punch outbox. The identifier
// is whitelisted in app.json (BGTaskSchedulerPermittedIdentifiers). Android is
// covered by the location foreground service + AppState retries, so the
// watchdog is registered on iOS only. Requires a native build (EAS) to run.
const BACKGROUND_SYNC_TASK = 'com.timetrack.workforce.background-sync';

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    await ensureBackgroundLocationUpdates().catch(() => undefined);
    await replayPunchOutbox();
    await syncAutoClockStatusToWebview();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

async function registerBackgroundSyncWatchdog() {
  if (Platform.OS !== 'ios') return;
  try {
    const registered = await BackgroundFetch.isRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (!registered) {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
        minimumInterval: 15 * 60, // 15 min requested; iOS owns the real cadence
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch {
    // Watchdog is best-effort: the primary background task, the AppState
    // retry loop and the location-wake outbox drain all remain active.
  }
}

export default function App() {
  const webviewRef = useRef(null);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [disclosureVisible, setDisclosureVisible] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [webviewKey, setWebviewKey] = useState(0);
  const [webError, setWebError] = useState(null);
  const [netInfo, setNetInfo] = useState({ connected: null });
  const isConnected = netInfo.connected;

  // Mirrors of component state for use inside event callbacks
  const webErrorRef = useRef(null);
  const prevConnectedRef = useRef(null);
  const retryTimerRef = useRef(null);
  const retryAttemptRef = useRef(0);

  // True when NetInfo has reported the device is offline
  const isAppOffline = isConnected === false;

  useEffect(() => {
    webErrorRef.current = webError;
  }, [webError]);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // Full WebView reload — resets the backoff schedule and any pending retry
  const reloadWebView = useCallback(() => {
    clearRetryTimer();
    retryAttemptRef.current = 0;
    setWebError(null);
    setLoadProgress(0);
    setWebviewKey((k) => k + 1);
  }, [clearRetryTimer]);

  // Exponential backoff auto-retry: 2s -> 5s -> 10s -> 30s (capped)
  const scheduleRetry = useCallback(() => {
    clearRetryTimer();
    const attempt = Math.min(retryAttemptRef.current, RETRY_DELAYS_MS.length - 1);
    retryAttemptRef.current = attempt + 1;
    retryTimerRef.current = setTimeout(reloadWebView, RETRY_DELAYS_MS[attempt]);
  }, [clearRetryTimer, reloadWebView]);

  // Cancel any pending retry timer on unmount
  useEffect(() => () => clearRetryTimer(), [clearRetryTimer]);

  // Publish the ref object (not .current) so module-level background code can
  // inject status snapshots whenever the WebView happens to be mounted.
  useEffect(() => {
    webviewBridgeRef = webviewRef;
    return () => {
      webviewBridgeRef = null;
    };
  }, []);

  // ── Connectivity awareness: offline screen + auto-reload on reconnect ──
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = !!(state.isConnected && state.isInternetReachable !== false);
      const wasConnected = prevConnectedRef.current;
      prevConnectedRef.current = connected;
      setNetInfo({ connected });

      // Device just came back online while an error screen is up -> reload now
      if (connected && wasConnected === false && webErrorRef.current) {
        reloadWebView();
      }
      // Offline punch outbox: replay queued punches the moment the device
      // reconnects, independent of the WebView error state.
      if (connected && wasConnected === false) {
        void replayPunchOutbox();
      }
    });
    return () => unsubscribe();
  }, [reloadWebView]);

  const renderErrorScreen = ({ heading, message, detailLine, hintText }) => {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>{heading}</Text>
        <Text style={styles.errorText}>{message}</Text>
        {detailLine ? <Text style={styles.errorDetail}>{detailLine}</Text> : null}
        {hintText ? <Text style={styles.errorHint}>{hintText}</Text> : null}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.retryButton} onPress={reloadWebView}>
            <Text style={styles.retryButtonText}>Retry Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderWebViewError = () => {
    if (isAppOffline) {
      return renderErrorScreen({
        heading: "You're Offline",
        message:
          'No internet connection was detected. TimeTrack will load automatically as soon as your device is back online.',
      });
    }
    const code = webError && webError.code != null ? webError.code : 'N/A';
    const desc = (webError && (webError.description || webError.title)) || 'Unknown network error';
    return renderErrorScreen({
      heading: 'Unable to Connect',
      message:
        "We couldn't reach the TimeTrack server. The app will keep retrying automatically, or you can retry now.",
      detailLine: `${desc} (code ${code})\nURL: ${(webError && webError.url) || TIMETRACK_URL}`,
    });
  };

  // ── Request location (incl. background) + notification permissions with Prominent Disclosure ──
  useEffect(() => {
    (async () => {
      try {
        const fgStatus = await Location.getForegroundPermissionsAsync();
        const bgStatus = await Location.getBackgroundPermissionsAsync();
        if (fgStatus.status === 'granted' && bgStatus.status === 'granted') {
          // Both already granted, configure notifications and mark ready.
          try {
            await configureNotifications();
          } catch {}
          try {
            await Notifications.requestPermissionsAsync();
            await registerPushTokenWithServer();
          } catch {}
          setPermissionsReady(true);
        } else {
          // Present Prominent Disclosure first.
          setDisclosureVisible(true);
        }
      } catch {
        setDisclosureVisible(true);
      }
    })();
  }, []);

  const handleAgreeDisclosure = async () => {
    setDisclosureVisible(false);
    try {
      const { status: fg } = await Location.requestForegroundPermissionsAsync();
      if (fg === 'granted') {
        const { status: bg } = await Location.requestBackgroundPermissionsAsync();
        if (bg !== 'granted') {
          const lastPromptedAt =
            Number(await AsyncStorage.getItem(BG_PERMISSION_PROMPTED_KEY)) || 0;
          if (Date.now() - lastPromptedAt >= BG_PERMISSION_REPROMPT_MS) {
            await AsyncStorage.setItem(BG_PERMISSION_PROMPTED_KEY, String(Date.now()));
            Alert.alert(
              'Auto clock-in/out needs background location',
              'TimeTrack clocks you automatically while the app is open. To also clock you in/out when the app is closed or the phone is locked, set location access to "Allow all the time" (Android) or "Always" (iOS).',
              [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ],
            );
          }
        }
      }
      try {
        await configureNotifications();
      } catch (error) {
        console.warn(
          '[TimeTrack] Could not configure notification channel:',
          error?.message || error,
        );
      }
      try {
        await Notifications.requestPermissionsAsync();
        await registerPushTokenWithServer();
      } catch (error) {
        console.warn(
          '[TimeTrack] Could not request notification permission:',
          error?.message || error,
        );
      }
    } catch {
      // Continue regardless; WebView still functions
    }
    setPermissionsReady(true);
  };

  const handleDeclineDisclosure = () => {
    setDisclosureVisible(false);
    setPermissionsReady(true);
  };

  const restoreNativeSession = useCallback(async () => {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token || !webviewRef.current) return;
    const script = `
      try {
        sessionStorage.setItem('timetrack_native_token', ${JSON.stringify(token)});
        window.dispatchEvent(new Event('timetrack-native-token'));
      } catch (_) {}
      true;
    `;
    webviewRef.current.injectJavaScript(script);
  }, []);

  // ── Start native background location updates ──
  useEffect(() => {
    if (!permissionsReady) return;
    let cancelled = false;
    const start = () => {
      if (!cancelled) {
        void ensureBackgroundLocationUpdates()
          .catch(() => {
            // Background updates unavailable (e.g. simulator or permission not
            // granted yet). The app-resume listener below retries automatically.
          })
          .finally(() => syncAutoClockStatusToWebview());
      }
    };

    start();
    // iOS: register the BGAppRefreshTask watchdog that re-arms the background
    // location task after the OS kills the app (no-op on Android).
    void registerBackgroundSyncWatchdog();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        start();
        void retryPendingNotification();
        void restoreNativeSession();
        void syncAutoClockStatusToWebview();
        void replayPunchOutbox();
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [permissionsReady, restoreNativeSession]);

  // ── Bridge messages from the web app (geofence assignment, clock state, auth token) ──
  const processWebViewMessage = async (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data || '{}');
      if (msg.type === 'OPEN_NATIVE_SETTINGS') {
        // Web UI deep-link into the OS permission screens — the recovery path
        // for "Never"/"Don't allow": the OS never lets the app re-prompt.
        Linking.openSettings().catch(() => undefined);
        return;
      }
      if (msg.type === 'AUTO_CLOCK_STATUS_REQUEST' && typeof msg.requestId === 'string') {
        await syncAutoClockStatusToWebview(msg.requestId);
        return;
      }
      if (msg.type === 'GEOFENCE_ASSIGNED') {
        // Multi-location builds send `geofences` (array); older builds send a
        // single `geofence` object. An empty/null assignment means the
        // employee is unassigned → stop monitoring (clear stored locations).
        const list = Array.isArray(msg.geofences)
          ? msg.geofences
          : msg.geofence
            ? [msg.geofence]
            : [];
        const nextList = JSON.stringify(list);
        const nextSingle = list.length > 0 ? JSON.stringify(list[0]) : null;
        const prevList = await AsyncStorage.getItem(GEOFENCE_LIST_KEY);
        const prevSingle = await AsyncStorage.getItem(GEOFENCE_KEY);

        if (list.length === 0) {
          await AsyncStorage.multiRemove([GEOFENCE_LIST_KEY, GEOFENCE_KEY]);
        } else {
          await AsyncStorage.setItem(GEOFENCE_LIST_KEY, nextList);
          await AsyncStorage.setItem(GEOFENCE_KEY, nextSingle);
        }
        // Reset the boundary state machine when the assignment changes so
        // stale zone/counters from a previous location can't misfire.
        // (clockedOutInside + lastClockedIn survive: they belong to the
        // employee, not to a specific location.)
        if (prevList !== nextList || prevSingle !== nextSingle) {
          await AsyncStorage.removeItem(AUTO_CLOCK_DIAGNOSTICS_KEY);
          const stateRaw = await AsyncStorage.getItem(GEOFENCE_STATE_KEY);
          if (stateRaw) {
            try {
              const st = JSON.parse(stateRaw);
              await AsyncStorage.setItem(
                GEOFENCE_STATE_KEY,
                JSON.stringify({
                  zone: null,
                  pendingEnter: 0,
                  pendingExit: 0,
                  lastEventAt: 0,
                  clockedOutInside: Boolean(st.clockedOutInside),
                  clockedOutInsideSetAt:
                    typeof st.clockedOutInsideSetAt === 'number' ? st.clockedOutInsideSetAt : null,
                  lastClockedIn: st.lastClockedIn,
                  pendingAction: st.pendingAction ?? null,
                  pendingNotification: st.pendingNotification ?? null,
                }),
              );
            } catch {
              await AsyncStorage.removeItem(GEOFENCE_STATE_KEY);
            }
          }
        }
        // Assignment messages arrive after the WebView has authenticated and
        // are another safe opportunity to recover a background task that was
        // blocked by a temporary permission/provider failure.
        void ensureBackgroundLocationUpdates()
          .catch(() => undefined)
          .finally(() => syncAutoClockStatusToWebview());
      }
      if (msg.type === 'AUTO_CLOCK_ENABLED' && typeof msg.enabled === 'boolean') {
        await AsyncStorage.setItem(AUTO_CLOCK_ENABLED_KEY, String(msg.enabled));
        void syncAutoClockStatusToWebview();
      }
      if (msg.type === 'CLOCK_STATE' && typeof msg.clockedIn === 'boolean') {
        await AsyncStorage.setItem(CLOCKED_IN_KEY, String(msg.clockedIn));
        // Double clock-in guard (mirrors the web awaiting-exit flag): when a
        // clocked-in → clocked-out transition happens, arm the native
        // suppression so the background task never instantly re-clocks-in an
        // employee who is still on site. Cleared on the next clock-in or by a
        // clearly-outside location fix in the background task, and expired
        // after CLOCKED_OUT_INSIDE_TTL_MS. System (cron) auto-closes arrive
        // with bySystem: true and ALSO arm the guard (stakeholder report
        // 2026-09): a working-end close while the employee is still on site
        // must not be followed by an instant automatic re-clock-in — the 12h
        // TTL releases it before the next shift (mirrors the web behaviour).
        try {
          const stateRaw = await AsyncStorage.getItem(GEOFENCE_STATE_KEY);
          const st = stateRaw
            ? JSON.parse(stateRaw)
            : {
                zone: null,
                pendingEnter: 0,
                pendingExit: 0,
                lastEventAt: 0,
                clockedOutInside: false,
                clockedOutInsideSetAt: null,
                pendingAction: null,
                pendingNotification: null,
              };
          if (st.lastClockedIn === true && msg.clockedIn === false) {
            st.clockedOutInside = true;
            st.clockedOutInsideSetAt = Date.now();
          }
          if (msg.clockedIn === true) {
            await updateAutoClockDiagnostics({ failure: null });
            st.clockedOutInside = false;
            st.clockedOutInsideSetAt = null;
            // Hybrid model: the punch may have been performed by the FOREGROUND
            // WEB MONITOR inside the WebView (the primary path). Drop any
            // in-flight native entry confirmation so the background task does
            // not fire a redundant punch on its next fix — the server 409
            // would contain it, but this keeps the state machine coherent.
            // Deliberately NOT forcing st.zone = 'inside': the clock-in could
            // be remote (supervisor / bulk clock-in), and forcing the zone
            // would mis-fire an auto clock-out on the first confirmed outside
            // fix.
            st.pendingEnter = 0;
          }
          st.lastClockedIn = msg.clockedIn;
          await AsyncStorage.setItem(GEOFENCE_STATE_KEY, JSON.stringify(st));
          void syncAutoClockStatusToWebview();
        } catch {
          /* non-fatal */
        }
      }
      if (msg.type === 'AUTH_TOKEN' && typeof msg.token === 'string' && msg.token.length > 0) {
        // Per-user state guard: AsyncStorage is device-wide. If a DIFFERENT
        // employee signs in on this device (shared device, or a previous
        // session that never delivered SESSION_ENDED), the persisted boundary
        // state (zone, pending counters, clockedOutInside suppression) belongs
        // to the PREVIOUS user and must never leak into this session — a stale
        // zone of 'inside' would permanently block the new employee's auto
        // clock-in because the outside → inside transition could never fire.
        const incomingEmail =
          typeof msg.email === 'string' && msg.email.length > 0 ? msg.email.toLowerCase() : '';
        const previousEmail = (await AsyncStorage.getItem(SESSION_EMAIL_KEY)) || '';
        if (incomingEmail && previousEmail && incomingEmail !== previousEmail) {
          await AsyncStorage.multiRemove([
            GEOFENCE_STATE_KEY,
            CLOCKED_IN_KEY,
            AUTO_CLOCK_DIAGNOSTICS_KEY,
          ]);
        }
        if (incomingEmail) {
          await AsyncStorage.setItem(SESSION_EMAIL_KEY, incomingEmail);
        }
        await AsyncStorage.setItem(TOKEN_KEY, msg.token);
        await updateAutoClockDiagnostics({ failure: null });
        if (typeof msg.refreshToken === 'string' && msg.refreshToken.length > 0) {
          await AsyncStorage.setItem(REFRESH_TOKEN_KEY, msg.refreshToken);
        }
        if (webviewRef.current) {
          // Inject WITHOUT dispatching 'timetrack-native-token': the web app
          // just handed us this token, so its session is already live and a
          // re-probe would only churn (mint → inject → probe → mint loop).
          // The event is reserved for cold restore (restoreNativeSession),
          // where the WebView must re-probe with the recovered bearer.
          webviewRef.current.injectJavaScript(`
            try {
              sessionStorage.setItem('timetrack_native_token', ${JSON.stringify(msg.token)});
            } catch (_) {}
            true;
          `);
        }
      }
      if (msg.type === 'SESSION_ENDED') {
        autoClockSessionGeneration += 1;
        // Sign-out: wipe everything so the next session starts clean.
        await AsyncStorage.multiRemove([
          TOKEN_KEY,
          REFRESH_TOKEN_KEY,
          SESSION_EMAIL_KEY,
          GEOFENCE_KEY,
          GEOFENCE_LIST_KEY,
          CLOCKED_IN_KEY,
          GEOFENCE_STATE_KEY,
          AUTO_CLOCK_ENABLED_KEY,
          AUTO_CLOCK_DIAGNOSTICS_KEY,
        ]);
      }
    } catch {
      // Ignore malformed bridge messages
    }
  };

  // WebView messages are delivered independently and each handler performs
  // asynchronous storage writes. Serialize them so CLOCK_STATE transitions
  // (especially true -> false after clock-out) cannot commit out of order.
  const onWebViewMessage = (event) => {
    // Share the background queue: sign-out/assignment resets must not race an
    // in-flight punch and let it restore the previous employee's diagnostics.
    const next = backgroundTaskQueue.then(() => processWebViewMessage(event));
    backgroundTaskQueue = next.catch(() => undefined);
    return next;
  };

  if (disclosureVisible) {
    return (
      <SafeAreaView style={styles.disclosureContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        <View style={styles.disclosureContent}>
          <Text style={styles.disclosureTitle}>Location Permission Disclosure</Text>
          <Text style={styles.disclosureSubtitle}>
            TimeTrack requests location access to automate your shift clock-in and clock-out.
          </Text>

          <View style={styles.disclosureCard}>
            <Text style={styles.disclosureCardHeader}>📍 Background Location Usage</Text>
            <Text style={styles.disclosureCardBody}>
              TimeTrack collects location data to automatically clock you in when entering your
              assigned work location geofence and clock you out when leaving,{' '}
              <Text style={styles.boldText}>
                even when the app is closed, running in the background, or not in use
              </Text>
              .
            </Text>
          </View>

          <View style={styles.disclosureCard}>
            <Text style={styles.disclosureCardHeader}>🔒 Privacy & Compliance Guarantee</Text>
            <Text style={styles.disclosureCardBody}>
              This data is strictly used to record your hours of work. We do not track you
              continuously, store your location history, or share this data with third parties.
            </Text>
          </View>

          <Text style={styles.disclosureFooterText}>
            To enable automatic hands-free time-tracking, please click{' '}
            <Text style={styles.boldText}>Agree & Continue</Text> and select "Allow all the time" or
            "Always" in the following permission request.
          </Text>

          <View style={styles.disclosureButtonContainer}>
            <TouchableOpacity style={styles.declineButton} onPress={handleDeclineDisclosure}>
              <Text style={styles.declineButtonText}>Not Now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptButton} onPress={handleAgreeDisclosure}>
              <Text style={styles.acceptButtonText}>Agree & Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      {/* Thin, non-interactive load indicator. It never covers or blocks the
          WebView — the web app's own UI is visible from the first frame. */}
      {!webError && loadProgress > 0 && loadProgress < 1 && (
        <View style={styles.progressTrack} pointerEvents="none">
          <View
            style={[
              styles.progressBar,
              { width: `${Math.max(4, Math.round(loadProgress * 100))}%` },
            ]}
          />
        </View>
      )}
      {webError ? (
        renderWebViewError()
      ) : (
        <WebView
          key={webviewKey}
          ref={webviewRef}
          source={{ uri: TIMETRACK_URL }}
          style={styles.webview}
          onLoadStart={() => {
            clearRetryTimer();
            retryAttemptRef.current = 0;
            setWebError(null);
            setLoadProgress(0.08);
          }}
          onLoadProgress={({ nativeEvent }) => {
            setLoadProgress(nativeEvent.progress);
          }}
          onLoad={() => setLoadProgress(1)}
          onLoadEnd={() => {
            setLoadProgress(0);
            void restoreNativeSession();
            // First opportunity to explain the auto-clock situation to the
            // freshly loaded Time tab (e.g. an armed on-site suppression).
            void syncAutoClockStatusToWebview();
          }}
          onMessage={onWebViewMessage}
          javaScriptEnabled
          domStorageEnabled
          allowsBackForwardNavigationGestures
          geolocationEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          startInLoadingState={false}
          originWhitelist={['*']}
          setSupportMultipleWindows={false}
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          cacheEnabled
          mixedContentMode="always"
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            setLoadProgress(0);
            setWebError({
              title: nativeEvent.title || 'Network Error',
              // Surface the REAL code/description/URL from the WebView.
              // Never fabricate a fallback description — a hardcoded string
              // previously masked the true cause of connection failures.
              code: nativeEvent.code != null ? nativeEvent.code : undefined,
              description: nativeEvent.description,
              url: nativeEvent.url || TIMETRACK_URL,
            });
            if (!isAppOffline) scheduleRetry();
          }}
          onHttpError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            if (nativeEvent.statusCode >= 500) {
              setLoadProgress(0);
              setWebError({
                title: `Server Error (${nativeEvent.statusCode})`,
                code: nativeEvent.statusCode,
                description: nativeEvent.description || `HTTP ${nativeEvent.statusCode}`,
                url: nativeEvent.url || TIMETRACK_URL,
              });
              scheduleRetry();
            }
          }}
          onOpenWindow={(e) => {
            // Open external links in the system browser
            const url = e?.nativeEvent?.targetUrl;
            if (url && !url.startsWith(TIMETRACK_URL)) Linking.openURL(url);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webview: {
    flex: 1,
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    zIndex: 5,
  },
  progressBar: {
    height: 3,
    backgroundColor: '#2563eb',
  },
  errorContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  errorDetail: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#94a3b8',
    backgroundColor: '#f1f5f9',
    padding: 8,
    borderRadius: 4,
    textAlign: 'center',
    marginBottom: 24,
    width: '100%',
  },
  errorHint: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 16,
    width: '100%',
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
  },
  retryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  disclosureContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  disclosureContent: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  disclosureTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
    textAlign: 'center',
  },
  disclosureSubtitle: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  disclosureCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  disclosureCardHeader: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 6,
  },
  disclosureCardBody: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  boldText: {
    fontWeight: '700',
    color: '#0f172a',
  },
  disclosureFooterText: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 18,
  },
  disclosureButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  declineButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  declineButtonText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '600',
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  acceptButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
