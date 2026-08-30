/**
 * TimeTrack Native Shell
 * ----------------------
 * React Native / Expo shell that hosts the production TimeTrack web app
 * in a WebView and runs NATIVE background geofence location monitoring so
 * employees are automatically clocked in / out when they enter or leave
 * their assigned work location — even when the app is closed or the device
 * is locked.
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
  Linking,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

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
const CLOCKED_IN_KEY = 'timetrack_clocked_in';
const TOKEN_KEY = 'timetrack_auth_token';
/** Persisted boundary state machine (zone, confirmation counters, cooldown). */
const GEOFENCE_STATE_KEY = 'timetrack_geofence_state';

// ── Geofence hysteresis constants (mirrors src/services/AutoGeofenceService.ts) ──
// Keep in sync with the web implementation.
const EXIT_BUFFER_METERS = 200; // grace distance outside radius before clock-out
const MAX_ACCURACY_METERS = 150; // fixes worse than this are ignored
const CONFIRMATIONS = 2; // consecutive samples required to confirm a crossing
const EVENT_COOLDOWN_MS = 60_000; // minimum time between clock events

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
async function apiClock(kind, pos) {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return { status: 401, data: {} };

  const isClockIn = kind === 'in';
  const url = `${TIMETRACK_URL}/api/time-entries/${isClockIn ? 'clock-in' : 'clock-out'}`;
  const body = isClockIn
    ? { latitude: pos.latitude, longitude: pos.longitude }
    : { breakMinutes: 0, latitude: pos.latitude, longitude: pos.longitude };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function notify(title, body) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {
    // Never crash the background task on notification failures.
  }
}

// ── Background task: runs while app is suspended / closed ──
// Detects geofence boundary crossings with the same hysteresis as the web
// service (accuracy gate + confirmation samples + cooldown) and performs the
// REAL clock-in/out API call, so attendance is recorded even when the WebView
// is suspended. The web app keeps GEOFENCE_KEY / CLOCKED_IN_KEY / TOKEN_KEY
// fresh via the postMessage bridge.
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  if (!data?.locations?.length) return;

  try {
    const geofenceRaw = await AsyncStorage.getItem(GEOFENCE_KEY);
    if (!geofenceRaw) return;
    const geofence = JSON.parse(geofenceRaw);
    const radius = geofence.radiusMeters || 300;

    const stateRaw = await AsyncStorage.getItem(GEOFENCE_STATE_KEY);
    const st = stateRaw
      ? JSON.parse(stateRaw)
      : { zone: null, pendingEnter: 0, pendingExit: 0, lastEventAt: 0 };

    let clockedIn = (await AsyncStorage.getItem(CLOCKED_IN_KEY)) === 'true';
    // Seed the zone from clock state (mirrors web syncClockedIn): a clocked-in
    // user is treated as INSIDE so clock-out can fire on the first crossing.
    if (!st.zone) st.zone = clockedIn ? 'inside' : 'outside';

    const now = Date.now();

    for (const loc of data.locations) {
      const accuracy = loc.coords?.accuracy;
      // Accuracy gate — unstable fixes are never used for zone decisions.
      if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_METERS) {
        continue;
      }

      const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      const dist = distanceMetres(pos, geofence);
      const inside = dist <= radius;
      const outside = dist > radius + EXIT_BUFFER_METERS;

      if (inside && st.zone !== 'inside') {
        st.pendingExit = 0;
        st.pendingEnter += 1;
        if (st.pendingEnter >= CONFIRMATIONS && !clockedIn && now - st.lastEventAt >= EVENT_COOLDOWN_MS) {
          st.pendingEnter = 0;
          const { status, data: resBody } = await apiClock('in', pos);
          const alreadyActive =
            status === 409 ||
            resBody?.code === 'DUPLICATE_ACTIVE' ||
            String(resBody?.error || '').toLowerCase().includes('already clocked');
          if (status === 201 || status === 200 || alreadyActive) {
            st.zone = 'inside';
            st.lastEventAt = Date.now();
            clockedIn = true;
            await AsyncStorage.setItem(CLOCKED_IN_KEY, 'true');
            if (!alreadyActive) {
              await notify('Auto Clock In', `You entered "${geofence.name}". Shift started automatically.`);
            }
          }
          // 401 (expired token) or 403: leave state untouched — the web app
          // will re-sync the token/state next time it runs.
        }
      } else if (outside && st.zone !== 'outside') {
        st.pendingEnter = 0;
        st.pendingExit += 1;
        if (st.pendingExit >= CONFIRMATIONS && clockedIn && now - st.lastEventAt >= EVENT_COOLDOWN_MS) {
          st.pendingExit = 0;
          const { status, data: resBody } = await apiClock('out', pos);
          const noActive =
            status === 404 || String(resBody?.error || '').toLowerCase().includes('no active');
          if (status === 200 || noActive) {
            st.zone = 'outside';
            st.lastEventAt = Date.now();
            clockedIn = false;
            await AsyncStorage.setItem(CLOCKED_IN_KEY, 'false');
            if (!noActive) {
              await notify('Auto Clock Out', `You left "${geofence.name}". Shift ended automatically.`);
            }
          }
        }
      } else {
        // Approaching zone or no crossing in progress — reset pending counters.
        st.pendingEnter = 0;
        st.pendingExit = 0;
      }
    }

    await AsyncStorage.setItem(GEOFENCE_STATE_KEY, JSON.stringify(st));
  } catch {
    // Never crash the background task
  }
});

export default function App() {
  const webviewRef = useRef(null);
  const [permissionsReady, setPermissionsReady] = useState(false);
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
    const desc =
      (webError && (webError.description || webError.title)) || 'Unknown network error';
    return renderErrorScreen({
      heading: 'Unable to Connect',
      message:
        "We couldn't reach the TimeTrack server. The app will keep retrying automatically, or you can retry now.",
      detailLine: `${desc} (code ${code})\nURL: ${(webError && webError.url) || TIMETRACK_URL}`,
    });
  };

  // ── Request location (incl. background) + notification permissions ──
  useEffect(() => {
    (async () => {
      try {
        const { status: fg } = await Location.requestForegroundPermissionsAsync();
        if (fg === 'granted') {
          // Background permission (Always) — required for auto clock-in/out
          await Location.requestBackgroundPermissionsAsync();
        }
        await Notifications.requestPermissionsAsync();
      } catch {
        // Continue regardless; WebView still functions
      }
      setPermissionsReady(true);
    })();
  }, []);

  // ── Start native background location updates ──
  useEffect(() => {
    if (!permissionsReady) return;
    (async () => {
      try {
        const granted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        if (!granted) {
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
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
      } catch {
        // Background updates unavailable (e.g. simulator) — ignore
      }
    })();
  }, [permissionsReady]);

  // ── Bridge messages from the web app (geofence assignment, clock state, auth token) ──
  const onWebViewMessage = async (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data || '{}');
      if (msg.type === 'GEOFENCE_ASSIGNED' && msg.geofence) {
        const next = JSON.stringify(msg.geofence);
        const prev = await AsyncStorage.getItem(GEOFENCE_KEY);
        await AsyncStorage.setItem(GEOFENCE_KEY, next);
        // Reset the boundary state machine when the assignment changes so
        // stale zone/counters from a previous location can't misfire.
        if (prev !== next) {
          await AsyncStorage.removeItem(GEOFENCE_STATE_KEY);
        }
      }
      if (msg.type === 'CLOCK_STATE' && typeof msg.clockedIn === 'boolean') {
        await AsyncStorage.setItem(CLOCKED_IN_KEY, String(msg.clockedIn));
      }
      if (msg.type === 'AUTH_TOKEN' && typeof msg.token === 'string' && msg.token.length > 0) {
        await AsyncStorage.setItem(TOKEN_KEY, msg.token);
      }
      if (msg.type === 'SESSION_ENDED') {
        // Sign-out: wipe everything so the next session starts clean.
        await AsyncStorage.multiRemove([TOKEN_KEY, GEOFENCE_KEY, CLOCKED_IN_KEY, GEOFENCE_STATE_KEY]);
      }
    } catch {
      // Ignore malformed bridge messages
    }
  };

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
          onLoadEnd={() => setLoadProgress(0)}
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
});
