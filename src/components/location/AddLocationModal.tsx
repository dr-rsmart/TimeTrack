/**
 * AddLocationModal — Enhanced location addition (matches TimeTrack feature set)
 * ------------------------------------------------------------------------------
 * Full-featured "Add Location" modal with:
 * - Address search via OpenStreetMap Nominatim geocoding (/api/settings/geocode)
 * - Location presets (Sitari Country Estate, Sandton HQ, etc.)
 * - "Use My Current Location" GPS capture
 * - Radius slider (10m – 50km) with quick-select buttons
 * - Distance tester: test coordinates against assigned geofence
 * - Uses employee-accessible /geofences/my endpoint (no admin role required for reading)
 *
 * Note: Creating a geofence still requires admin role on the server.
 * Employees can use this modal to test their position; admins save new locations.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Navigation, Radio, Plus, Search, X, Loader2 } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '../ui';

interface Geofence {
  id: string;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
}

interface GeocodeResult {
  displayName: string;
  latitude: number;
  longitude: number;
  type: string;
}

interface TestResult {
  passed: boolean;
  distanceMetres?: number;
  radiusMetres?: number;
  geofenceName?: string;
  message?: string;
  error?: string;
}

// ── Preset locations (same as TimeTrack GeofenceManager) ──
const PRESET_LOCATIONS = [
  { name: 'Sitari Country Estate', address: 'Old Main Rd, Firgrove Rural, Somerset West, 7130', latitude: -34.0841, longitude: 18.7842, radiusMeters: 5000 },
  { name: 'Sandton HQ', address: '12 Rivonia Road, Sandton, Johannesburg', latitude: -26.1076, longitude: 28.0567, radiusMeters: 300 },
  { name: 'Cape Town Branch', address: '45 Long Street, Cape Town', latitude: -33.9249, longitude: 18.4241, radiusMeters: 250 },
  { name: 'Durban Branch', address: '100 Samora Machel St, Durban', latitude: -29.8587, longitude: 31.0218, radiusMeters: 250 },
];

const QUICK_RADII = [100, 250, 500, 1000, 2000, 5000, 10000];

export function AddLocationModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState(-34.0527); // Default to Sitari area
  const [longitude, setLongitude] = useState(18.7696);
  const [radiusMeters, setRadiusMeters] = useState(5000); // Default 5km
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Address search (Nominatim geocoding) ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Quick Presets filter (keeps preset list manageable as it grows) ──
  const [presetFilter, setPresetFilter] = useState('');
  const filteredPresets = PRESET_LOCATIONS.filter((p) => {
    if (!presetFilter.trim()) return true;
    const q = presetFilter.trim().toLowerCase();
    return `${p.name} ${p.address}`.toLowerCase().includes(q);
  });

  // ── Employee's assigned geofence (for distance testing) ──
  const [myGeofence, setMyGeofence] = useState<Geofence | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Fetch employee's assigned geofence via employee-accessible endpoint
  const fetchMyGeofence = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/geofences/my');
      if (!res.ok) return;
      const data = await res.json();

      if (data.employee?.geofenceId && data.geofences) {
        const assigned = data.geofences.find((g: Geofence) => g.id === data.employee.geofenceId);
        setMyGeofence(assigned ?? null);
      } else {
        setMyGeofence(null);
      }
    } catch (err) {
      console.error('Failed to fetch work location:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchMyGeofence();
      // Reset test result when opening
      setTestResult(null);
      setSaveError(null);
    }
  }, [isOpen, fetchMyGeofence]);

  // ── Address search with debounce ──
  const searchAddress = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/settings/geocode?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error('Geocode search failed:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchAddress(value), 500);
  };

  const selectSearchResult = (result: GeocodeResult) => {
    setLatitude(result.latitude);
    setLongitude(result.longitude);
    setAddress(result.displayName);
    if (!name.trim()) {
      // Auto-populate name from first part of address
      setName(result.displayName.split(',')[0]);
    }
    setSearchResults([]);
    setSearchQuery(result.displayName.split(',')[0]);
  };

  // ── Apply preset location ──
  const applyPreset = (preset: (typeof PRESET_LOCATIONS)[number]) => {
    setName(preset.name);
    setAddress(preset.address);
    setLatitude(preset.latitude);
    setLongitude(preset.longitude);
    setRadiusMeters(preset.radiusMeters);
    setSearchQuery('');
    setSearchResults([]);
    setTestResult(null);
  };

  // ── Use My Current Location ──
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setSaveError('Geolocation is not supported by your browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setLocating(false);
      },
      () => {
        setSaveError('Unable to get your location. Please enable GPS and try again.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  // ── Test coordinates against assigned geofence ──
  const testCoordinates = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = { latitude, longitude };
      if (myGeofence) {
        body.geofenceId = myGeofence.id;
      } else {
        body.radiusMeters = radiusMeters;
      }

      const res = await fetch('/api/settings/geofences/test-distance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ passed: false, message: data.error || 'Distance test failed.' });
      } else {
        setTestResult(data);
      }
    } catch (err) {
      console.error('Distance test failed:', err);
      setTestResult({ passed: false, message: 'Distance test failed. Check your connection.' });
    } finally {
      setTesting(false);
    }
  };

  // ── Save new geofence (requires admin role on server) ──
  const saveLocation = async () => {
    if (!name.trim()) {
      setSaveError('Location name is required.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        name: name.trim(),
        address: address || null,
        latitude,
        longitude,
        radiusMeters,
        isActive: true,
      };

      const res = await fetch('/api/settings/geofences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 403) {
          setSaveError('Only administrators can create work locations. Your position has been tested — ask an admin to add this location.');
        } else {
          setSaveError(err.error || 'Failed to create location.');
        }
        return;
      }

      onClose();
    } catch {
      setSaveError('Failed to create location. Check your connection.');
    } finally {
      setSaving(false);
    }
  };

  // ── Format helpers ──
  const formatRadius = (meters: number): string =>
    meters >= 1000 ? `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1)} km` : `${meters} m`;

  if (!isOpen) return null;

  // Portal to document.body — ancestor CSS transforms (page animations) would
  // otherwise break `position: fixed` and force the user to scroll to find the modal.
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50">
      <div className="flex min-h-full items-center justify-center p-4">
      <Card className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="w-4 h-4 text-brand" />
              Add New Work Location
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              Create a new geofence for clock-in validation
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">

          {/* ── Quick Presets — filterable list (stays manageable as presets grow) ── */}
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5 block">
              Quick Presets
            </label>
            <div className="relative mb-1.5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                placeholder="Filter presets by name or address…"
                value={presetFilter}
                onChange={(e) => setPresetFilter(e.target.value)}
                className="w-full pl-8 pr-3 py-2 border rounded-lg text-xs"
              />
            </div>
            <div className="max-h-36 overflow-y-auto border rounded-lg divide-y">
              {filteredPresets.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-400">No presets match your filter.</p>
              ) : (
                filteredPresets.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-2 ${
                      name === p.name
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="font-medium block truncate">📍 {p.name}</span>
                      <span className="text-slate-400 truncate block text-[11px]">{p.address}</span>
                    </span>
                    <span className="text-slate-400 shrink-0">{formatRadius(p.radiusMeters)}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* ── Address Search (Nominatim geocoding with OSM Attribution) ── */}
          <div className="relative">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5 block">
              Search Address
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                placeholder="e.g. Sitari Country Estate, Cape Town"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
              )}
            </div>
            {searchResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {searchResults.map((r, i) => {
                  const isSelected = latitude === r.latitude && longitude === r.longitude;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => selectSearchResult(r)}
                      className={`w-full text-left px-3 py-2 text-xs border-b last:border-b-0 transition-colors flex items-center justify-between ${
                        isSelected ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div>
                        <span className="font-medium text-slate-700 block">{r.displayName.split(',')[0]}</span>
                        <span className="text-slate-400 line-clamp-1 text-[11px]">{r.displayName}</span>
                      </div>
                      {isSelected && <span className="text-blue-600 font-bold shrink-0 ml-2">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-slate-400 mt-1">
              Search powered by <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">OpenStreetMap</a> contributors
            </p>
          </div>

          {/* ── Form Fields ── */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1 block">Location Name *</label>
              <input
                placeholder="e.g. Sitari Country Estate"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1 block">Address</label>
              <input
                placeholder="e.g. Old Main Rd, Croydon, Cape Town"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>

            {/* Coordinates */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1 block">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border rounded-lg text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1 block">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border rounded-lg text-sm tabular-nums"
                />
              </div>
            </div>

            {/* Use My Current Location */}
            <Button onClick={useMyLocation} disabled={locating} variant="outline" className="w-full">
              {locating ? (
                <>
                  <Radio className="w-3.5 h-3.5 animate-spin mr-2" /> Acquiring GPS...
                </>
              ) : (
                <>
                  <Radio className="w-3.5 h-3.5 mr-2" /> Use My Current Location
                </>
              )}
            </Button>

            {/* Radius Slider */}
            <div>
              <label className="text-sm text-slate-600 flex justify-between">
                <span>Radius</span>
                <span className="font-semibold text-blue-600">{formatRadius(radiusMeters)}</span>
              </label>
              <input
                type="range"
                min="10"
                max="50000"
                step="10"
                value={radiusMeters}
                onChange={(e) => setRadiusMeters(parseInt(e.target.value))}
                className="w-full mt-2"
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>10m</span><span>25km</span><span>50km</span>
              </div>
              {/* Quick radius buttons */}
              <div className="flex flex-wrap gap-2 mt-3">
                {QUICK_RADII.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRadiusMeters(r)}
                    className={`px-2 py-1 text-xs border rounded ${
                      radiusMeters === r ? 'bg-blue-100 border-blue-400 text-blue-700' : 'hover:bg-slate-50'
                    }`}
                  >
                    {r >= 1000 ? `${r / 1000}km` : `${r}m`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Distance Tester ── */}
          <div className="border border-blue-200 bg-blue-50/30 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-blue-700 uppercase tracking-wide flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5" />
              Distance Tester
              {myGeofence && (
                <span className="normal-case font-normal text-blue-600">
                  — vs "{myGeofence.name}" ({formatRadius(myGeofence.radiusMeters)})
                </span>
              )}
            </p>
            <Button onClick={testCoordinates} disabled={testing} size="sm" variant="outline" className="w-full">
              {testing ? 'Testing...' : 'Test Position'}
            </Button>
            {testResult && (
              <div className={`p-2 rounded text-xs ${testResult.passed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                <p className="font-medium">{testResult.message}</p>
              </div>
            )}
          </div>

          {/* Save error */}
          {saveError && (
            <div className="p-2 rounded bg-red-50 border border-red-200 text-xs text-red-700">
              {saveError}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button onClick={onClose} variant="outline" size="sm">Cancel</Button>
            <Button onClick={saveLocation} disabled={saving || !name.trim()} size="sm" className="bg-blue-600 hover:bg-blue-700">
              {saving ? 'Creating...' : 'Create Location'}
            </Button>
          </div>

        </CardContent>
      </Card>
      </div>
    </div>,
    document.body,
  );
}
