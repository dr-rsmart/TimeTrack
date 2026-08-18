/**
 * Clock-In GPS Utilities
 * ----------------------
 * Pre-flight checks for GPS availability, permission probing,
 * current position retrieval, and clock-in/out payload building.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface GpsPosition {
  latitude: number;
  longitude: number;
  accuracy: number; // in metres
  timestamp: number;
}

export interface GpsStatus {
  available: boolean;
  permission: 'granted' | 'denied' | 'unknown';
  error?: string;
  suggestions?: string[];
}

// ─────────────────────────────────────────────────────────────
// GPS Availability Check
// ─────────────────────────────────────────────────────────────

/**
 * Determine if the browser/device supports GPS location services.
 */
export function checkGpsAvailability(): GpsStatus {
  const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (!navigator.geolocation) {
    return {
      available: false,
      permission: 'unknown',
      error: 'Your device or browser does not support GPS location services.',
      suggestions: isMobile
        ? [
            'Go to your device\'s Settings → Privacy & Security → Location Services and ensure your browser has permission to access your location.',
            'Try updating your mobile browser to the latest version or using a different browser (Chrome or Safari).',
          ]
        : [
            'Ensure you are using a modern, standard browser like Google Chrome, Mozilla Firefox, Microsoft Edge, or Apple Safari.',
            'If on macOS, ensure System Settings → Privacy & Security → Location Services is enabled and allowed for your browser.',
            'If on Windows, ensure Settings → Privacy & Security → Location is enabled for desktop apps and your browser.',
          ],
    };
  }

  return {
    available: true,
    permission: 'unknown',
  };
}

// ─────────────────────────────────────────────────────────────
// Permission Probe
// ─────────────────────────────────────────────────────────────

/**
 * Async permission probe: queries the Permissions API to determine whether
 * the user has already granted or denied geolocation access.
 */
export async function queryLocationPermissions(): Promise<{
  permission: 'granted' | 'denied' | 'unknown';
  suggestions?: string[];
}> {
  const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  try {
    const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    const state = result.state;

    if (state === 'denied') {
      return {
        permission: 'denied',
        suggestions: isMobile
          ? [
              'On mobile: go to Settings → Apps → your browser → Permissions → Location → Allow (While using the app).',
              'Ensure your device\'s global Location/GPS setting is turned ON in your quick settings panel.',
              'Once you have updated the settings, refresh this page and try again.',
            ]
          : [
              'Click the lock icon (🔒) or settings icon in the browser address bar (to the left of the URL) and change Location from "Block" to "Allow".',
              'Open browser settings → Privacy & Security → Site Settings → Location, and find TimeTrack to change its permission.',
              'After changing the setting, refresh this page and try again.',
            ],
      };
    }

    return { permission: state === 'granted' ? 'granted' : 'unknown' };
  } catch {
    // Permissions API may not support 'geolocation' in all browsers.
    // Fall back to letting getCurrentPosition handle it.
    return { permission: 'unknown' };
  }
}

// ─────────────────────────────────────────────────────────────
// Current Position Retrieval
// ─────────────────────────────────────────────────────────────

const GPS_ACCURACY_THRESHOLD_METERS = 100;

/**
 * Fetches the current GPS position with high accuracy.
 * Returns null if GPS cannot be acquired within the timeout.
 */
export async function getCurrentPosition(): Promise<GpsPosition | null> {
  if (!navigator.geolocation) return null;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.warn('[gps] Timeout acquiring GPS position.');
      resolve(null);
    }, 15000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeoutId);
        if (pos.coords.accuracy > GPS_ACCURACY_THRESHOLD_METERS) {
          console.warn(`[gps] Low accuracy: ${pos.coords.accuracy.toFixed(1)}m`);
        }
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
      },
      (err) => {
        clearTimeout(timeoutId);
        // Caller can check the server's geo_validation.suggestions instead.
        console.warn('[gps] Geolocation error:', err.code, err.message);
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      },
    );
  });
}

// ─────────────────────────────────────────────────────────────
// Clock-In Payload Builder
// ─────────────────────────────────────────────────────────────

/**
 * Builds the clock-in payload for an existing active entry.
 * Captures GPS coordinates for geo-validation.
 *
 * @param employeeEmail - Email of the employee to clock in
 * @param actingUser - The authenticated admin/manager user object
 * @param isOverride - Whether this is a manual override (skips GPS)
 * @param isAutoGeofence - Whether this was triggered by auto-geofence
 * @returns Complete clock-in payload object
 */
export async function buildClockInPayload(
  employeeEmail: string,
  actingUser: Record<string, unknown> | null,
  isOverride: boolean = false,
  isAutoGeofence: boolean = false,
): Promise<Record<string, unknown>> {
  const now = new Date();
  const payload: Record<string, unknown> = {
    employee_email: employeeEmail,
    clock_in: now.toISOString(),
    date: now.toISOString().split('T')[0],
    status: 'active',
    is_manual_override: isOverride,
    is_auto_geofence: isAutoGeofence,
    ...(isOverride && actingUser
      ? {
          clocked_by_id: actingUser.id ?? null,
          clocked_by_name: (actingUser.full_name as string) || (actingUser.email as string) || 'Unknown',
        }
      : {}),
  };

  // ── GPS Capture ──
  // Required for geofence validation when not overriding
  if (!isOverride) {
    const pos = await getCurrentPosition();
    if (pos) {
      payload.latitude = pos.latitude;
      payload.longitude = pos.longitude;
    }
  }

  return payload;
}

/**
 * Builds the clock-out payload for an existing active entry.
 * Captures GPS coordinates for geo-validation (required for employee
 * self-clock-out when STRICT_GEOFENCE is enabled).
 *
 * @param activeEntry - The active time entry to clock out
 * @param actingUser - The authenticated admin/manager user object
 * @param isOverride - Whether this is a manual override (skips GPS)
 * @param isAutoGeofence - Whether this was triggered by auto-geofence
 * @returns Complete clock-out update payload
 */
export async function buildClockOutPayload(
  activeEntry: Record<string, unknown>,
  actingUser: Record<string, unknown> | null,
  isOverride: boolean = false,
  isAutoGeofence: boolean = false,
): Promise<Record<string, unknown>> {
  if (!activeEntry?.id) {
    throw new Error('No active time entry found to clock out.');
  }

  const now = new Date();
  const diffMs = now.getTime() - new Date(activeEntry.clock_in as string).getTime();
  const totalHours = Math.max(0, Math.round((diffMs / 3_600_000) * 100) / 100);

  const payload: Record<string, unknown> = {
    clock_out: now.toISOString(),
    total_hours: totalHours,
    status: 'completed',
    is_manual_override: isOverride,
    is_auto_geofence: isAutoGeofence,
    ...(isOverride && actingUser
      ? {
          clocked_by_id: actingUser.id ?? null,
          clocked_by_name: (actingUser.full_name as string) || (actingUser.email as string) || 'Unknown',
        }
      : {}),
  };

  // ── GPS Capture ──
  // Required for employee self-clock-out geo-validation.
  if (!isOverride) {
    const pos = await getCurrentPosition();
    if (pos) {
      payload.latitude = pos.latitude;
      payload.longitude = pos.longitude;
    }
  }

  return payload;
}