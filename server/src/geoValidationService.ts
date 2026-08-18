/**
 * Geofence Validation Service
 * ---------------------------
 * Validates that clock-in/out events originate from within assigned geofence
 * perimeters using the Haversine formula for great-circle distance calculation.
 *
 * Features:
 * - STRICT_GEOFENCE mode (production enforcement vs relaxed dev testing)
 * - Role-based manual override bypass (admin/master only)
 * - Rich error payloads with actionable troubleshooting suggestions
 * - Coordinate range validation and inactive geofence handling
 * - Assigned-geofence enforcement: employees with a geofenceId are validated
 *   ONLY against their assigned geofence. Employees without an assignment
 *   fall back to checking all active company geofences.
 * - GPS accuracy tolerance buffer to prevent false declines at boundaries
 */

import prisma from './prisma.js';

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * GPS accuracy tolerance buffer (in metres).
 * Mobile GPS typically has ±10–150m accuracy. This buffer is added to the
 * geofence radius to prevent false declines when an employee is at the
 * boundary and GPS drift pushes the reported position slightly outside.
 */
const GPS_ACCURACY_BUFFER_METERS = 150;

/**
 * STRICT_GEOFENCE environment variable controls geofence enforcement:
 * - true (default): employees with an active geofence MUST be inside it to clock in.
 * - false (testing only): relaxed mode — missing/inactive geofences pass through.
 */
const STRICT_GEOFENCE = process.env.STRICT_GEOFENCE !== 'false';

if (!STRICT_GEOFENCE) {
  console.warn(
    '[geo] ⚠️  STRICT_GEOFENCE is disabled — employees can clock in from any ' +
    'location regardless of geofence assignment. This should NEVER be used in production.',
  );
}

// ─────────────────────────────────────────────────────────────
// Haversine Distance Calculation
// ─────────────────────────────────────────────────────────────

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine distance between two (lat, lon) points in metres.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface GeoPosition {
  latitude: number;
  longitude: number;
}

export interface GeoValidationResult {
  passed: boolean;
  distanceMetres?: number;
  geofenceName?: string;
  geofenceAddress?: string;
  geofenceLatitude?: number;
  geofenceLongitude?: number;
  radiusMetres?: number;
  error?: string;
  /** Actionable troubleshooting steps for the end-user. Only populated on failure. */
  suggestions?: string[];
}

export interface GeoValidationOptions {
  /**
   * When true, validation is completely bypassed — used by admins/managers/masters
   * performing manual clock-in/clock-out on behalf of an employee (e.g. the
   * employee lost their phone or forgot it at home).
   * The caller MUST have already verified the requester's role and scope before
   * setting this flag. This is a security boundary.
   */
  isManualOverride?: boolean;
  /** The role of the user *performing* the action (for audit context). */
  requesterRole?: string;
}

// ─────────────────────────────────────────────────────────────
// Core Validation Logic
// ─────────────────────────────────────────────────────────────

/**
 * Validate that an employee's reported GPS position falls within their
 * assigned work geofence.
 *
 * Enforcement rules:
 * - If the employee HAS an assigned geofence (geofenceId), validation is
 *   performed ONLY against that geofence. This prevents employees assigned
 *   to one location (e.g. Cape Town) from clocking in at another company
 *   site (e.g. Sitari Country Estate), which would produce inaccurate
 *   attendance reporting.
 * - If the assigned geofence is inactive, clock-in is rejected in strict
 *   mode with a message asking the admin to reactivate or reassign it.
 * - If the employee has NO assigned geofence, validation falls back to
 *   checking ALL active company geofences (unassigned employees may work
 *   at any site until an admin pins them to a location).
 *
 * Validation order:
 * 1. Role-based bypass (admin/master manual override)
 * 2. Employee lookup + company resolution
 * 3. Determine allowed geofence set (assigned-only vs all active)
 * 4. If no position data → reject (strict) or pass (relaxed)
 * 5. Check distance to each allowed geofence; pass if within radius + GPS buffer
 * 6. If no geofence matched, return detailed error with closest geofence info
 */
export async function validateClockInLocation(
  email: string,
  pos: GeoPosition | null,
  options?: GeoValidationOptions,
): Promise<GeoValidationResult> {
  // ── Role-Based Bypass (Security Boundary) ──
  // Admins, masters, and managers may clock staff in/out on their behalf
  // (e.g. staff lost or forgot their phone). Manager scope is enforced by
  // the calling route before this flag is set.
  if (
    options?.isManualOverride &&
    (options.requesterRole === 'admin' || options.requesterRole === 'master' || options.requesterRole === 'manager')
  ) {
    return { passed: true };
  }

  try {
    // ── Defensive lookup (camelCase Prisma schema) ──
    const employee = await prisma.employee.findFirst({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        geofenceId: true,
        companyProfileId: true,
        geofence: {
          select: {
            id: true,
            name: true,
            address: true,
            latitude: true,
            longitude: true,
            radiusMeters: true,
            isActive: true,
          },
        },
      },
    }).catch((lookupError: unknown) => {
      const err = lookupError as { code?: string };
      if (err.code === 'P2024' || err.code === 'P1001') {
        return null;
      }
      throw lookupError;
    });

    if (employee === null) {
      return {
        passed: false,
        error: 'Unable to reach the location service. Please try again in a moment.',
      };
    }

    type GeofenceRecord = {
      id: string;
      name: string;
      address: string | null;
      latitude: number;
      longitude: number;
      radiusMeters: number;
      isActive: boolean;
    };

    // ── Determine which geofences the employee is allowed to clock in at ──
    // Employees WITH an assigned geofence are locked to that geofence only —
    // this prevents an employee assigned to Cape Town from clocking in at
    // Sitari Country Estate (or any other company site), which would produce
    // inaccurate attendance reporting.
    // Employees WITHOUT an assignment may clock in at any active company site.
    let allowedGeofences: GeofenceRecord[];
    const hasAssignedGeofence = Boolean(employee.geofenceId && employee.geofence);

    if (hasAssignedGeofence && employee.geofence) {
      // Assigned geofence must be active to be usable
      if (!employee.geofence.isActive) {
        return {
          passed: !STRICT_GEOFENCE,
          geofenceName: employee.geofence.name,
          error: STRICT_GEOFENCE
            ? `Your assigned work location "${employee.geofence.name}" is currently inactive. Ask your administrator to reactivate it or reassign you to an active location.`
            : undefined,
          suggestions: STRICT_GEOFENCE
            ? [
                'Contact your manager or administrator.',
                'An admin can reactivate the geofence in Settings → Geofences, or assign you to a different work location in your employee profile.',
              ]
            : undefined,
        };
      }
      allowedGeofences = [employee.geofence];
    } else {
      // Unassigned employee — allow any active company geofence
      allowedGeofences = await prisma.geofence.findMany({
        where: {
          companyProfileId: employee.companyProfileId ?? undefined,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
          radiusMeters: true,
          isActive: true,
        },
      }).catch(() => [] as GeofenceRecord[]);
    }

    // No geofences available (none configured, or none active)
    if (allowedGeofences.length === 0) {
      return {
        passed: !STRICT_GEOFENCE,
        error: STRICT_GEOFENCE
          ? 'No work locations (geofences) have been configured for your company. Contact your administrator to set up work locations in Settings → Geofences.'
          : undefined,
        suggestions: STRICT_GEOFENCE
          ? [
              'Your company has no geofence locations set up. An administrator must add at least one work location in Settings → Geofences.',
              'If you believe this is an error, contact your manager or HR department.',
            ]
          : undefined,
      };
    }

    // No position data provided
    if (!pos || pos.latitude == null || pos.longitude == null) {
      const assignedName = employee.geofence?.name ?? allowedGeofences[0]?.name ?? 'your work location';
      return {
        passed: !STRICT_GEOFENCE,
        geofenceName: assignedName,
        error: STRICT_GEOFENCE
          ? `Location data is required for clock-in at "${assignedName}". Please enable GPS and try again.`
          : undefined,
        suggestions: STRICT_GEOFENCE
          ? [
              'Open your device Settings → Privacy & Security → Location Services and ensure Location Services is turned ON.',
              'Scroll down to find TimeTrack in the app list and set permission to "While Using the App" or "Always".',
              'If using a desktop browser, click the lock icon in the address bar and ensure Location is set to "Allow".',
              'Move to an area with a clear view of the sky (near a window) if indoors.',
              'After enabling GPS, refresh this page and try again.',
            ]
          : undefined,
      };
    }

    // Range check
    if (
      pos.latitude < -90 ||
      pos.latitude > 90 ||
      pos.longitude < -180 ||
      pos.longitude > 180
    ) {
      return {
        passed: false,
        error: 'Invalid GPS coordinates received. Your device reported coordinates outside valid geographic ranges.',
        suggestions: [
          'Restart your device\'s location services (toggle Location Services OFF, wait 10 seconds, then ON again).',
          'Ensure your device has a clear GPS signal — try moving to a window or outdoor area.',
          'If the problem persists, your device\'s GPS sensor may need calibration. Open a maps app to verify your location.',
        ],
      };
    }

    // ── Check distance to every ALLOWED geofence ──
    // For assigned employees this is only their assigned geofence; for
    // unassigned employees it is every active company geofence.
    let closestGeofence: GeofenceRecord | null = null;
    let closestDistance = Infinity;

    for (const gf of allowedGeofences) {
      const distance = haversineDistance(pos.latitude, pos.longitude, gf.latitude, gf.longitude);
      const effectiveRadius = gf.radiusMeters + GPS_ACCURACY_BUFFER_METERS;

      if (distance <= effectiveRadius) {
        // ✅ PASSED — employee is within this geofence
        return {
          passed: true,
          distanceMetres: Math.round(distance),
          geofenceName: gf.name,
          geofenceAddress: gf.address ?? undefined,
          geofenceLatitude: gf.latitude,
          geofenceLongitude: gf.longitude,
          radiusMetres: gf.radiusMeters,
        };
      }

      if (distance < closestDistance) {
        closestDistance = distance;
        closestGeofence = gf;
      }
    }

    // ❌ FAILED — not within any geofence
    const closest = closestGeofence!;
    const distRound = Math.round(closestDistance);
    const distKm = (closestDistance / 1000).toFixed(2);
    const radiusKm = (closest.radiusMeters / 1000).toFixed(2);

    return {
      passed: false,
      distanceMetres: distRound,
      geofenceName: closest.name,
      geofenceAddress: closest.address ?? undefined,
      geofenceLatitude: closest.latitude,
      geofenceLongitude: closest.longitude,
      radiusMetres: closest.radiusMeters,
      error: `You are approximately ${distRound >= 1000 ? distKm + ' km' : distRound + ' m'} from the "${closest.name}" geofence (allowed radius: ${closest.radiusMeters >= 1000 ? radiusKm + ' km' : closest.radiusMeters + ' m'}). Clock-in denied.`,
      suggestions: [
        `Reported GPS: ${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)} · Nearest geofence (${closest.name}): ${closest.latitude.toFixed(5)}, ${closest.longitude.toFixed(5)}`,
        `Distance: ${distRound >= 1000 ? distKm + ' km' : distRound + ' m'} away (allowed: ${closest.radiusMeters >= 1000 ? radiusKm + ' km' : closest.radiusMeters + ' m'}).`,
        `Move approximately ${Math.round(closestDistance - closest.radiusMeters)}m closer to "${closest.name}" or ask an admin to update the geofence center/radius in Settings → Geofences.`,
        'If GPS accuracy is low on your mobile device, try enabling High Accuracy GPS or reconnecting to Wi-Fi.',
      ],
    };
  } catch {
    // Fail-safe: reject the clock-in to prevent unauthorized access during degradation.
    return {
      passed: false,
      error: 'Unable to verify your location at this time. Please try again.',
    };
  }
}

/**
 * Validate clock-out location. Functionally identical to clock-in validation.
 */
export async function validateClockOutLocation(
  email: string,
  pos: GeoPosition | null,
  options?: GeoValidationOptions,
): Promise<GeoValidationResult> {
  return validateClockInLocation(email, pos, options);
}