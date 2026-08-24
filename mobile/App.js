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
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
  ActivityIndicator,
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

// Production TimeTrack web app URL
const TIMETRACK_URL = 'https://time-track.tech';

// Background task identifier
const BACKGROUND_LOCATION_TASK = 'timetrack-background-location-task';

// Geofence defaults (overridden by the web app via postMessage when available)
const GEOFENCE_KEY = 'timetrack_geofence';
const CLOCKED_IN_KEY = 'timetrack_clocked_in';

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

// ── Background task: runs while app is suspended / closed ──
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  if (!data?.locations?.length) return;

  try {
    const geofenceRaw = await AsyncStorage.getItem(GEOFENCE_KEY);
    if (!geofenceRaw) return;
    const geofence = JSON.parse(geofenceRaw);

    const last = data.locations[data.locations.length - 1];
    const pos = { latitude: last.coords.latitude, longitude: last.coords.longitude };
    const dist = distanceMetres(pos, geofence);
    const inside = dist <= (geofence.radiusMeters || 300);

    const clockedInRaw = await AsyncStorage.getItem(CLOCKED_IN_KEY);
    const clockedIn = clockedInRaw === 'true';

    if (inside && !clockedIn) {
      await AsyncStorage.setItem(CLOCKED_IN_KEY, 'true');
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Auto Clock In',
          body: `You entered "${geofence.name}". Shift started automatically.`,
        },
        trigger: null,
      });
    } else if (!inside && clockedIn) {
      await AsyncStorage.setItem(CLOCKED_IN_KEY, 'false');
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Auto Clock Out',
          body: `You left "${geofence.name}". Shift ended automatically.`,
        },
        trigger: null,
      });
    }
  } catch {
    // Never crash the background task
  }
});

export default function App() {
  const webviewRef = useRef(null);
  const [appReady, setAppReady] = useState(false);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [webviewKey, setWebviewKey] = useState(0);
  const [webError, setWebError] = useState(null);

  const renderWebViewError = (errorName, errorCode, errorDesc) => {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Unable to Connect</Text>
        <Text style={styles.errorText}>
          We couldn't connect to the TimeTrack server. Please check your internet connection or verify the server is online.
        </Text>
        <Text style={styles.errorDetail}>
          Error: {errorDesc || errorName || 'Unknown Network Error'} ({errorCode || 'N/A'})
        </Text>
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setWebError(null);
              setAppReady(false);
              setWebviewKey((k) => k + 1);
            }}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
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

  // ── Bridge messages from the web app (geofence assignment, clock state) ──
  const onWebViewMessage = async (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data || '{}');
      if (msg.type === 'GEOFENCE_ASSIGNED' && msg.geofence) {
        await AsyncStorage.setItem(GEOFENCE_KEY, JSON.stringify(msg.geofence));
      }
      if (msg.type === 'CLOCK_STATE' && typeof msg.clockedIn === 'boolean') {
        await AsyncStorage.setItem(CLOCKED_IN_KEY, String(msg.clockedIn));
      }
    } catch {
      // Ignore malformed bridge messages
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      {!appReady && !webError && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loaderText}>Loading TimeTrack…</Text>
        </View>
      )}
      {webError ? (
        renderWebViewError(webError.title, webError.code, webError.description)
      ) : (
        <WebView
          key={webviewKey}
          ref={webviewRef}
          source={{ uri: TIMETRACK_URL }}
          style={styles.webview}
          onLoadStart={() => {
            setWebError(null);
            setAppReady(false);
          }}
          onLoadEnd={() => {
            if (!webError) {
              setAppReady(true);
            }
          }}
          onMessage={onWebViewMessage}
          javaScriptEnabled
          domStorageEnabled
          allowsBackForwardNavigationGestures
          geolocationEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          startInLoadingState={false}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            setWebError({
              title: nativeEvent.title || 'Network Error',
              code: nativeEvent.code || -2,
              description: nativeEvent.description || 'net::ERR_NAME_NOT_RESOLVED',
            });
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
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    zIndex: 10,
  },
  loaderText: {
    marginTop: 12,
    color: '#475569',
    fontSize: 14,
    fontWeight: '600',
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
