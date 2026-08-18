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
 * - GPS accuracy buffer awareness (150m, same as backend)
 * - Integrated "Add Location" modal for creating new geofences
 * - Live distance auto-refresh every 10 seconds
 * - SSE listener for real-time geofence updates
 */

import { useState, useEffect, useCallback } from 'react';
import { MapPin, Navigation, Radio, Plus } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Spinner } from '../ui';
import { useSSE } from '../../hooks/useSSE';
import { AddLocationModal } from './AddLocationModal';

// ── Haversine distance (same as backend geoValidationService) ───────────────
const EARTH_RADIUS_METERS = 6_371_000;

/**
 * GPS accuracy tolerance buffer (in metres).
 * Must match server/src/geoValidationService.ts GPS_ACCURACY_BUFFER_METERS.
 * Mobile GPS typically has ±10–150m accuracy. This buffer is added to the
 * geofence radius to prevent false declines when an employee is at the
 * boundary and GPS drift pushes the reported position slightly outside.
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

interface DistanceResult {
  geofence: Geofence;
  distanceMeters: number;
  withinRadius: boolean;
  isAssigned: boolean;
}

interface MyWorkLocationProps {
  /**
   * Controls whether the "Add Location" button is shown.
   * Employees should not create geofences — only admin/master/manager roles
   * have that permission. Defaults to true for backward compatibility.
   */
  canAddLocation?: boolean;
}

export function MyWorkLocation({ canAddLocation = true }: MyWorkLocationProps) {
  const [allGeofences, setAllGeofences] = useState<Geofence[]>([]);
  const [assignedGeofenceId, setAssignedGeofenceId] = useState<string | null>(null);
  const [distanceResults, setDistanceResults] = useState<DistanceResult[]>([]);
  const [closestResult, setClosestResult] = useState<DistanceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
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

      if (data.employee?.geofenceId) {
        setAssignedGeofenceId(data.employee.geofenceId);
      }
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

      const { latitude, longitude } = position.coords;

      // Determine allowed geofences (matches backend logic)
      const activeGeofences = allGeofences.filter((g) => g.isActive);
      const assignedGeofence = assignedGeofenceId
        ? activeGeofences.find((g) => g.id === assignedGeofenceId)
        : undefined;
      const allowedGeofences = assignedGeofence ? [assignedGeofence] : activeGeofences;

      const results: DistanceResult[] = allowedGeofences.map((gf) => {
        const distance = haversineDistance(latitude, longitude, gf.latitude, gf.longitude);
        const effectiveRadius = gf.radiusMeters + GPS_ACCURACY_BUFFER_METERS;
        return {
          geofence: gf,
          distanceMeters: Math.round(distance),
          withinRadius: distance <= effectiveRadius,
          isAssigned: gf.id === assignedGeofenceId,
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
  }, [allGeofences, assignedGeofenceId]);

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

  // ── Status determination ──
  const getDistanceStatus = (): 'excellent' | 'inside' | 'outside' | null => {
    if (!closestResult) return null;
    if (closestResult.withinRadius && closestResult.distanceMeters < closestResult.geofence.radiusMeters * 0.25) {
      return 'excellent';
    }
    if (closestResult.withinRadius) return 'inside';
    return 'outside';
  };

  const distanceStatus = getDistanceStatus();

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

          {/* Distance to closest geofence */}
          {closestResult && (
            <div
              className={`rounded-lg p-3 border ${
                distanceStatus === 'excellent'
                  ? 'bg-emerald-50 border-emerald-200'
                  : distanceStatus === 'inside'
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-orange-50 border-orange-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Navigation
                  className={`w-4 h-4 ${
                    distanceStatus === 'excellent'
                      ? 'text-emerald-600'
                      : distanceStatus === 'inside'
                        ? 'text-blue-600'
                        : 'text-orange-600'
                  }`}
                />
                <span className="font-medium text-sm">
                  Distance to {closestResult.geofence.name}
                  {closestResult.isAssigned && (
                    <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                      Assigned
                    </span>
                  )}
                </span>
              </div>
              <p
                className={`text-2xl font-bold tabular-nums ${
                  distanceStatus === 'excellent'
                    ? 'text-emerald-700'
                    : distanceStatus === 'inside'
                      ? 'text-blue-700'
                      : 'text-orange-700'
                }`}
              >
                {formatDistance(closestResult.distanceMeters)}
              </p>
              <div className="flex items-center gap-2 text-xs mt-1">
                {distanceStatus === 'excellent' && (
                  <>
                    <span className="text-emerald-600 font-medium">Excellent position!</span>
                    <span className="text-slate-400">You're very close to the centre.</span>
                  </>
                )}
                {distanceStatus === 'inside' && (
                  <>
                    <span className="text-blue-600 font-medium">Inside geofence</span>
                    <span className="text-slate-400">You're within the allowed area.</span>
                  </>
                )}
                {distanceStatus === 'outside' && (
                  <>
                    <span className="text-orange-600 font-medium">Outside geofence</span>
                    <span className="text-slate-400">
                      Move ~{formatDistance(closestResult.distanceMeters - closestResult.geofence.radiusMeters)} closer.
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Allowed geofences with distances */}
          {distanceResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                {assignedGeofenceId ? 'Your Assigned Work Location' : `All Company Work Locations (${distanceResults.length})`}
              </p>
              {distanceResults.map((r) => (
                <div
                  key={r.geofence.id}
                  className={`flex items-center justify-between rounded-lg border p-2.5 text-sm ${
                    r.withinRadius ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${r.withinRadius ? 'bg-emerald-500' : 'bg-orange-400'}`} />
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
                    <span className={`font-medium tabular-nums ${r.withinRadius ? 'text-emerald-700' : 'text-orange-600'}`}>
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