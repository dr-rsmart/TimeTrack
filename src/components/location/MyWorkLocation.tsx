/**
 * MyWorkLocation — Employee-facing location dashboard
 * ----------------------------------------------------
 * Shows employee's assigned work geofence, live distance to it,
 * and "Use My Current Location" functionality.
 *
 * Features:
 * - Accurate Haversine distance calculation (matches backend geoValidationService)
 * - Assigned-geofence enforcement: employees with an assigned geofence are
 *   validated ONLY against that geofence (matches backend). Unassigned
 *   employees see all active company geofences.
 * - GPS accuracy buffer awareness (150m, same as backend) for clock-in validation
 * - 3-tier proximity zone colours based on 200m auto clock-out buffer:
 *     🟢 Green  — inside geofence (distance <= radius)
 *     🟠 Orange — approaching boundary (radius < distance <= radius + 200m)
 *     🔴 Red    — outside / auto-clock-out zone (distance > radius + 200m)
 * - Integrated "Add Location" modal for creating new geofences
 * - Live distance auto-refresh every 10 seconds
 * - SSE listener for real-time geofence updates
 * - Admin/master roles see the GeofenceManager component instead of the
 *   distance list (avoids a messy "All Company Work Locations" list)
 */

import { useState, useEffect, useCallback } from 'react';
import { MapPin, Navigation, Radio, Plus } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Spinner } from '../ui';
import { useSSE } from '../../hooks/useSSE';
import { AddLocationModal } from './AddLocationModal';
import { GeofenceManager } from '../settings/GeofenceManager';
import { EXIT_BUFFER_METERS } from '../../services/AutoGeofenceService';

// ── Haversine distance (same as backend geoValidationService) ───────────────
const EARTH_RADIUS_METERS = 6_371_000;

/**
 * GPS accuracy tolerance buffer (in metres) used for manual clock-in validation.
 * Must match server/src/geoValidationService.ts GPS_ACCURACY_BUFFER_METERS.
 * Mobile GPS typically has ±10–150m accuracy. This buffer is added to the
 * geofence radius to prevent false declines when an employee is at the
 * boundary and GPS drift pushes the reported position slightly outside.
 *
 * NOTE: This is separate from EXIT_BUFFER_METERS (200m) which governs the
 * auto clock-out grace zone and the proximity colour states.
 */
const GPS_ACCURACY_BUFFER_METERS = 150;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

interface Geofence {
  id: string;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
  employeeCount?: number;
}

/** Proximity zone relative to the geofence, based on the 200m auto clock-out buffer. */
type ProximityZone = 'inside' | 'approaching' | 'outside';

interface DistanceResult {
  geofence: Geofence;
  distanceMeters: number;
  /** True when within the manual clock-in validation radius (radius + 150m GPS buffer). */
  withinRadius: boolean;
  /** Proximity zone used for colour display (based on 200m auto clock-out buffer). */
  zone: ProximityZone;
  isAssigned: boolean;
}

interface MyWorkLocationProps {
  /**
   * Controls whether the "Add Location" button is shown.
   * Employees should not create geofences — only admin/master/manager roles
   * have that permission. Defaults to true for backward compatibility.
   *
   * When true (admin/master), the GeofenceManager component is rendered
   * instead of the distance list to avoid a messy "All Company Work
   * Locations" list.
   */
  canAddLocation?: boolean;
}

/** Determine the proximity zone for a given distance and geofence radius. */
function getZone(distanceMeters: number, radiusMeters: number): ProximityZone {
  if (distanceMeters <= radiusMeters) return 'inside';
  if (distanceMeters <= radiusMeters + EXIT_BUFFER_METERS) return 'approaching';
  return 'outside';
}

export function MyWorkLocation({ canAddLocation = true }: MyWorkLocationProps) {
  const [allGeofences, setAllGeofences] = useState<Geofence[]>([]);
  const [assignedGeofenceIds, setAssignedGeofenceIds] = useState<string[]>([]);
  const [distanceResults, setDistanceResults] = useState<DistanceResult[]>([]);
  const [closestResult, setClosestResult] = useState<DistanceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [poorSignal, setPoorSignal] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);

  // ── Fetch all geofences and employee assignment ──
  // Uses the employee-accessible /geofences/my endpoint (no admin role required)
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/geofences/my');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const geofences: Geofence[] = data.geofences || [];
      setAllGeofences(geofences);
      const assigned: string[] = data.employee?.geofenceIds ?? (data.employee?.geofenceId ? [data.employee.geofenceId] : []);
      setAssignedGeofenceIds(assigned);
    } catch (err) {
      console.error('Failed to fetch work location data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Calculate distance to allowed geofences using Haversine ──
  // Matches backend geoValidationService: assigned employees are validated
  // against their assigned geofence ONLY; unassigned employees against all
  // active company geofences.
  const calculateDistances = useCallback(async () => {
    if (allGeofences.length === 0) return;

    setLocating(true);
    setGpsError(null);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('GPS not supported on this device'));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      });

      const { latitude, longitude, accuracy } = position.coords;

      // Accuracy gate: never overwrite a good reading with an unreliable fix
      // (matches AutoGeofenceService MAX_ACCURACY_METERS = 100)
      if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 100) {
        setPoorSignal(true);
        return;
      }
      setPoorSignal(false);
      setGpsAccuracy(typeof accuracy === 'number' && Number.isFinite(accuracy) ? Math.round(accuracy) : null);

      // Determine allowed geofences (matches backend logic)
      const activeGeofences = allGeofences.filter((g) => g.isActive);
      const assignedGeofences = assignedGeofenceIds.length > 0
        ? activeGeofences.filter((g) => assignedGeofenceIds.includes(g.id))
        : [];
      const allowedGeofences = assignedGeofences.length > 0 ? assignedGeofences : activeGeofences;

      const results: DistanceResult[] = allowedGeofences.map((gf) => {
        const distance = haversineDistance(latitude, longitude, gf.latitude, gf.longitude);
        const effectiveRadius = gf.radiusMeters + GPS_ACCURACY_BUFFER_METERS;
        return {
          geofence: gf,
          distanceMeters: Math.round(distance),
          withinRadius: distance <= effectiveRadius,
          zone: getZone(Math.round(distance), gf.radiusMeters),
          isAssigned: assignedGeofenceIds.includes(gf.id),
        };
      });

      // Sort by distance — closest first
      results.sort((a, b) => a.distanceMeters - b.distanceMeters);

      setDistanceResults(results);
      setClosestResult(results.length > 0 ? results[0] : null);
    } catch (err) {
      const geoErr = err as GeolocationPositionError;
      if (geoErr.code === 1) {
        setGpsError('Location access denied. Please enable GPS in your browser/device settings.');
      } else if (geoErr.code === 2) {
        setGpsError('Unable to determine your position. Move to an area with better GPS signal.');
      } else if (geoErr.code === 3) {
        setGpsError('GPS request timed out. Please try again.');
      } else {
        setGpsError((err as Error).message || 'GPS unavailable');
      }
      setDistanceResults([]);
      setClosestResult(null);
    } finally {
      setLocating(false);
    }
  }, [allGeofences, assignedGeofenceIds]);

  // Auto-calculate on first load once geofences are available
  useEffect(() => {
    if (allGeofences.length > 0 && !loading) {
      calculateDistances();
    }
  }, [allGeofences.length, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh distance every 10 seconds
  useEffect(() => {
    if (allGeofences.length === 0) return;
    const interval = setInterval(calculateDistances, 10000);
    return () => clearInterval(interval);
  }, [calculateDistances, allGeofences.length]);

  // SSE listener for geofence updates
  useSSE(
    useCallback(
      (event: { type?: string; entity?: string }) => {
        if (event.type === 'entity_event' && event.entity === 'Geofence') {
          fetchData();
        }
      },
      [fetchData]
    )
  );

  // ── Format helpers ──
  const formatDistance = (meters: number | null): string => {
    if (meters === null || meters === undefined) return '—';
    if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
    return `${meters} m`;
  };

  const formatRadius = (meters: number | null): string => {
    if (!meters) return '—';
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${meters} m`;
  };

  // ── Zone colour helpers (green / orange / red) ──
  const zoneCardClass = (zone: ProximityZone): string => {
    switch (zone) {
      case 'inside':
        return 'bg-emerald-50 border-emerald-200';
      case 'approaching':
        return 'bg-orange-50 border-orange-200';
      case 'outside':
        return 'bg-red-50 border-red-200';
    }
  };

  const zoneIconClass = (zone: ProximityZone): string => {
    switch (zone) {
      case 'inside':
        return 'text-emerald-600';
      case 'approaching':
        return 'text-orange-600';
      case 'outside':
        return 'text-red-600';
    }
  };

  const zoneTextClass = (zone: ProximityZone): string => {
    switch (zone) {
      case 'inside':
        return 'text-emerald-700';
      case 'approaching':
        return 'text-orange-700';
      case 'outside':
        return 'text-red-700';
    }
  };

  const zoneDotClass = (zone: ProximityZone): string => {
    switch (zone) {
      case 'inside':
        return 'bg-emerald-500';
      case 'approaching':
        return 'bg-orange-400';
      case 'outside':
        return 'bg-red-500';
    }
  };

  const zoneDistanceTextClass = (zone: ProximityZone): string => {
    switch (zone) {
      case 'inside':
        return 'text-emerald-700';
      case 'approaching':
        return 'text-orange-600';
      case 'outside':
        return 'text-red-600';
    }
  };

  const zoneRowClass = (zone: ProximityZone): string => {
    switch (zone) {
      case 'inside':
        return 'border-emerald-200 bg-emerald-50/50';
      case 'approaching':
        return 'border-orange-200 bg-orange-50/50';
      case 'outside':
        return 'border-red-200 bg-red-50/50';
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="w-4 h-4 text-brand" />
            My Work Location
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center"><Spinner /></div>
        </CardContent>
      </Card>
    );
  }

  // ── No geofences configured ──
  if (allGeofences.length === 0) {
    return (
      <>
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-brand" />
                My Work Location
              </span>
              {canAddLocation && (
                <Button size="sm" variant="outline" onClick={() => setShowAddLocation(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Location
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              message={
                canAddLocation
                  ? 'No work locations configured yet. Add a location to enable GPS clock-in.'
                  : 'No work locations configured yet. Ask your administrator to add a work location to enable GPS clock-in.'
              }
            />
          </CardContent>
        </Card>
        {canAddLocation && (
          <AddLocationModal isOpen={showAddLocation} onClose={() => { setShowAddLocation(false); fetchData(); }} />
        )}
      </>
    );
  }

  return (
    <>
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-brand" />
              My Work Location
            </span>
            {canAddLocation && (
              <Button size="sm" variant="outline" onClick={() => setShowAddLocation(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Location
              </Button>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            {allGeofences.filter((g) => g.isActive).length} active location(s) — GPS validation enabled
          </p>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* GPS Error banner */}
          {gpsError && (
            <div className="rounded-lg p-3 bg-red-50 border border-red-200">
              <p className="text-sm text-red-700 font-medium">GPS Error</p>
              <p className="text-xs text-red-600 mt-1">{gpsError}</p>
            </div>
          )}

          {/* Poor GPS signal hint — unstable readings are ignored */}
          {poorSignal && !gpsError && (
            <div className="rounded-lg p-3 bg-amber-50 border border-amber-200">
              <p className="text-sm text-amber-700 font-medium">Poor GPS signal</p>
              <p className="text-xs text-amber-600 mt-1">Unstable readings are ignored — showing your last reliable position.</p>
            </div>
          )}

          {/* Distance to closest geofence — 3-tier zone colours */}
          {closestResult && (
            <div className={`rounded-lg p-3 border ${zoneCardClass(closestResult.zone)}`}>
              <div className="flex items-center gap-2 mb-1">
                <Navigation className={`w-4 h-4 ${zoneIconClass(closestResult.zone)}`} />
                <span className="font-medium text-sm">
                  Distance to {closestResult.geofence.name}
                  {closestResult.isAssigned && (
                    <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                      Assigned
                    </span>
                  )}
                </span>
              </div>
              <p className={`text-2xl font-bold tabular-nums ${zoneTextClass(closestResult.zone)}`}>
                {formatDistance(closestResult.distanceMeters)}
                {gpsAccuracy !== null && (
                  <span className="text-sm font-normal text-slate-400 ml-1.5">±{gpsAccuracy}m</span>
                )}
              </p>
              <div className="flex items-center gap-2 text-xs mt-1">
                {closestResult.zone === 'inside' && (
                  <>
                    <span className="text-emerald-600 font-medium">Inside geofence</span>
                    <span className="text-slate-400">You're within the allowed area.</span>
                  </>
                )}
                {closestResult.zone === 'approaching' && (
                  <>
                    <span className="text-orange-600 font-medium">Approaching boundary</span>
                    <span className="text-slate-400">
                      {formatDistance(closestResult.distanceMeters - closestResult.geofence.radiusMeters)} outside the geofence — auto clock-out at {EXIT_BUFFER_METERS}m.
                    </span>
                  </>
                )}
                {closestResult.zone === 'outside' && (
                  <>
                    <span className="text-red-600 font-medium">Outside geofence — auto clock-out zone</span>
                    <span className="text-slate-400">
                      {formatDistance(closestResult.distanceMeters - closestResult.geofence.radiusMeters)} outside the geofence.
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/*
            Allowed geofences with distances.
            - Hidden for admin/master roles (canAddLocation) — they see the
              GeofenceManager below instead, avoiding a messy full list.
            - Hidden when there is only a single result, since the distance
              card above already shows that information (removes duplicate).
          */}
          {!canAddLocation && distanceResults.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                {assignedGeofenceIds.length > 0 ? `Your Assigned Work Location${assignedGeofenceIds.length > 1 ? 's' : ''}` : `All Company Work Locations (${distanceResults.length})`}
              </p>
              {distanceResults.map((r) => (
                <div
                  key={r.geofence.id}
                  className={`flex items-center justify-between rounded-lg border p-2.5 text-sm ${zoneRowClass(r.zone)}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${zoneDotClass(r.zone)}`} />
                    <div>
                      <span className="font-medium text-slate-700">{r.geofence.name}</span>
                      {r.geofence.address && (
                        <span className="text-xs text-slate-400 block truncate">{r.geofence.address}</span>
                      )}
                    </div>
                    {r.isAssigned && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full shrink-0">Assigned</span>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`font-medium tabular-nums ${zoneDistanceTextClass(r.zone)}`}>
                      {formatDistance(r.distanceMeters)}
                    </span>
                    <span className="text-xs text-slate-400 ml-1">/ {formatRadius(r.geofence.radiusMeters)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Geofence details for closest */}
          {closestResult && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Geofence Centre</p>
                <p className="font-medium tabular-nums">
                  {closestResult.geofence.latitude.toFixed(6)}, {closestResult.geofence.longitude.toFixed(6)}
                </p>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Radius</p>
                <p className="font-medium">{formatRadius(closestResult.geofence.radiusMeters)}</p>
              </div>
            </div>
          )}

          {/* Refresh button */}
          <Button onClick={calculateDistances} disabled={locating} className="w-full">
            {locating ? (
              <>
                <Radio className="w-4 h-4 animate-spin mr-2" /> Acquiring GPS...
              </>
            ) : (
              <>
                <Radio className="w-4 h-4 mr-2" /> Refresh My Location
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/*
        Admin/master view: render the full GeofenceManager component (same as
        Settings > Geofences) instead of a plain distance list. This keeps the
        admin experience clean and consistent with the settings page.
      */}
      {canAddLocation && (
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <GeofenceManager hideAssignEmployees={false} />
          </CardContent>
        </Card>
      )}

      {/* Add Location Modal — only for roles allowed to create geofences */}
      {canAddLocation && (
        <AddLocationModal
          isOpen={showAddLocation}
          onClose={() => {
            setShowAddLocation(false);
            fetchData();
          }}
        />
      )}
    </>
  );
}