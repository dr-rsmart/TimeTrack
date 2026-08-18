/**
 * GeofenceManager — Enhanced "Add Location" component
 * ----------------------------------------------------
 * Features (matching TimeTrack + improvements):
 * - Address search via OpenStreetMap Nominatim geocoding
 * - Location presets (Sitari Country Estate, Sandton HQ, etc.)
 * - "Use My Current Location" GPS capture
 * - Radius slider (10m – 50,000m / 50km)
 * - Distance tester tool (test coordinates against geofences)
 * - Employee assignment to geofences
 * - Active/Inactive toggle
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface Geofence {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
  employeeCount: number;
}

interface EmployeeLite {
  id: string;
  firstName: string;
  surname: string;
  email: string;
  branch: string;
  department: string;
  geofenceId: string | null;
}

interface GeocodeResult {
  displayName: string;
  latitude: number;
  longitude: number;
  type: string;
}

interface DistanceTestResult {
  passed: boolean;
  message: string;
  distanceMetres?: number;
  radiusMetres?: number;
  geofenceName?: string;
  results?: Array<{
    geofenceId: string;
    geofenceName: string;
    distanceMetres: number;
    radiusMetres: number;
    withinRange: boolean;
  }>;
}

// ── Location Preset Type (company-specific, fetched from API) ──
interface LocationPreset {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export function GeofenceManager({ hideAssignEmployees = false }: { hideAssignEmployees?: boolean }) {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [presets, setPresets] = useState<LocationPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    address: '',
    latitude: -26.2041,
    longitude: 28.0473,
    radiusMeters: 200,
    isActive: true,
  });

  // ── Preset Management State ──
  const [savingPreset, setSavingPreset] = useState(false);
  const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null);

  // ── Address Search State ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedResult, setSelectedResult] = useState<GeocodeResult | null>(null);

  // ── Distance Tester State ──
  const [showDistanceTester, setShowDistanceTester] = useState(false);
  const [testLat, setTestLat] = useState('');
  const [testLng, setTestLng] = useState('');
  const [testGeofenceId, setTestGeofenceId] = useState('');
  const [testResult, setTestResult] = useState<DistanceTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  // ── Employee Assignment State ──
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [assignGeofenceId, setAssignGeofenceId] = useState('');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);

  // ── GPS State ──
  const [locating, setLocating] = useState(false);

  // ── Quick Presets filter (keeps preset list manageable as it grows) ──
  const [presetFilter, setPresetFilter] = useState('');
  const filteredPresets = presets.filter((p) => {
    if (!presetFilter.trim()) return true;
    const q = presetFilter.trim().toLowerCase();
    return `${p.name} ${p.address ?? ''}`.toLowerCase().includes(q);
  });

  // ── Fetch geofences, employees and company-specific presets ──
  const loadData = useCallback(async () => {
    try {
      const [geoRes, empRes, presetRes] = await Promise.all([
        fetch('/api/settings/geofences'),
        fetch('/api/settings/employees-for-geofence'),
        fetch('/api/settings/location-presets'),
      ]);
      const geoData = await geoRes.json();
      const empData = await empRes.json();
      const presetData = await presetRes.json();
      setGeofences(geoData.geofences || []);
      setEmployees(empData.employees || []);
      setPresets(presetData.presets || []);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Address Search (Nominatim via server proxy) with retry logic ──
  const searchAddress = async () => {
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    setSearchError('');
    setSearchResults([]);
    setSelectedResult(null);

    try {
      const res = await fetch(`/api/settings/geocode?q=${encodeURIComponent(searchQuery.trim())}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Search failed' }));
        setSearchError(errData.error || 'Geocoding service unavailable.');
        return;
      }
      const data = await res.json();
      setSearchResults(data.results || []);
      if ((data.results || []).length === 0) {
        setSearchError('No results found. Try a different search term.');
      }
    } catch {
      setSearchError('Search failed. Check your connection.');
    } finally {
      setSearching(false);
    }
  };

  const selectSearchResult = (r: GeocodeResult) => {
    setForm({
      ...form,
      latitude: r.latitude,
      longitude: r.longitude,
      address: r.displayName,
      name: form.name || r.displayName.split(',')[0],
    });
    setSearchResults([]);
    setSearchQuery(r.displayName.split(',')[0]);
  };

  // ── Use My Current Location ──
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm({ ...form, latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        alert('Unable to get your location. Please enable GPS and try again.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // ── Apply Preset ──
  const applyPreset = (preset: LocationPreset) => {
    setForm({
      name: preset.name,
      address: preset.address ?? '',
      latitude: preset.latitude,
      longitude: preset.longitude,
      radiusMeters: preset.radiusMeters,
      isActive: true,
    });
    setSearchQuery(preset.name);
  };

  // ── Save Current Form as Preset (company-specific) ──
  const saveAsPreset = async () => {
    if (!form.name.trim()) {
      alert('Location name is required to save a preset.');
      return;
    }
    setSavingPreset(true);
    try {
      const res = await fetch('/api/settings/location-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          address: form.address || null,
          latitude: form.latitude,
          longitude: form.longitude,
          radiusMeters: form.radiusMeters,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to save preset');
        return;
      }
      await loadData();
      alert(`✅ Preset "${form.name.trim()}" saved for your company.`);
    } catch {
      alert('Failed to save preset. Check your connection.');
    } finally {
      setSavingPreset(false);
    }
  };

  // ── Delete Preset ──
  const deletePreset = async (preset: LocationPreset) => {
    if (!confirm(`Delete preset "${preset.name}"? This only removes the quick-fill preset, not any created locations.`)) return;
    setDeletingPresetId(preset.id);
    try {
      const res = await fetch(`/api/settings/location-presets/${preset.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to delete preset');
        return;
      }
      await loadData();
    } catch {
      alert('Failed to delete preset. Check your connection.');
    } finally {
      setDeletingPresetId(null);
    }
  };

  // ── Save Geofence ──
  const save = async () => {
    if (!form.name.trim()) {
      alert('Location name is required.');
      return;
    }
    const body = {
      name: form.name.trim(),
      address: form.address || null,
      latitude: form.latitude,
      longitude: form.longitude,
      radiusMeters: form.radiusMeters,
      isActive: form.isActive,
    };
    const url = editingId ? `/api/settings/geofences/${editingId}` : '/api/settings/geofences';
    const method = editingId ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Save failed');
        return;
      }
      setShowForm(false);
      loadData();
    } catch {
      alert('Save failed. Check your connection.');
    }
  };

  // ── Toggle Active ──
  const toggleActive = async (g: Geofence) => {
    await fetch(`/api/settings/geofences/${g.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !g.isActive }),
    });
    loadData();
  };

  // ── Delete ──
  const remove = async (id: string) => {
    if (!confirm('Delete this geofence? Employees assigned to it will lose their work location.')) return;
    await fetch(`/api/settings/geofences/${id}`, { method: 'DELETE' });
    loadData();
  };

  // ── Distance Tester ──
  const runDistanceTest = async () => {
    const lat = parseFloat(testLat);
    const lng = parseFloat(testLng);
    if (isNaN(lat) || isNaN(lng)) {
      alert('Please enter valid coordinates.');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = { latitude: lat, longitude: lng };
      if (testGeofenceId) {
        body.geofenceId = testGeofenceId;
      } else {
        body.radiusMeters = form.radiusMeters;
      }
      const res = await fetch('/api/settings/geofences/test-distance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ passed: false, message: 'Test failed. Check your connection.' });
    } finally {
      setTesting(false);
    }
  };

  const useTestMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setTestLat(pos.coords.latitude.toFixed(6));
        setTestLng(pos.coords.longitude.toFixed(6));
      },
      () => alert('Unable to get location.'),
      { enableHighAccuracy: true },
    );
  };

  // ── Employee Assignment ──
  const toggleEmployeeSelection = (empId: string) => {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(empId)) next.delete(empId);
      else next.add(empId);
      return next;
    });
  };

  const assignEmployees = async () => {
    if (!assignGeofenceId || selectedEmployeeIds.size === 0) return;
    setAssigning(true);
    try {
      const res = await fetch(`/api/settings/geofences/${assignGeofenceId}/assign-employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds: [...selectedEmployeeIds] }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ Assigned ${data.assignedCount} employee(s) to "${data.geofenceName}".`);
        setSelectedEmployeeIds(new Set());
        loadData();
      } else {
        alert(data.error || 'Assignment failed.');
      }
    } catch {
      alert('Assignment failed. Check your connection.');
    } finally {
      setAssigning(false);
    }
  };

  // ── Format radius for display ──
  const formatRadius = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m}m`);

  if (loading) return <div className="p-6 text-slate-500">Loading geofences...</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Work Locations (Geofences)</h2>
          <p className="text-sm text-slate-500 mt-0.5">Clock-in validation zones. Employees with an assigned location can only clock in at their assigned geofence; unassigned employees may clock in at any active geofence.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowDistanceTester(!showDistanceTester); setShowAssignPanel(false); }}
            className={`px-3 py-2 text-sm rounded-lg border ${showDistanceTester ? 'bg-blue-50 border-blue-300 text-blue-700' : 'hover:bg-slate-50'}`}
          >
            📏 Distance Tester
          </button>
          {!hideAssignEmployees && (
            <button
              onClick={() => { setShowAssignPanel(!showAssignPanel); setShowDistanceTester(false); }}
              className={`px-3 py-2 text-sm rounded-lg border ${showAssignPanel ? 'bg-green-50 border-green-300 text-green-700' : 'hover:bg-slate-50'}`}
            >
              👥 Assign Employees
            </button>
          )}
          <button onClick={() => { setForm({ name: '', address: '', latitude: -26.2041, longitude: 28.0473, radiusMeters: 200, isActive: true }); setEditingId(null); setShowForm(true); setSearchQuery(''); setSearchResults([]); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
            + Add Location
          </button>
        </div>
      </div>

      {/* ── Distance Tester Panel ── */}
      {showDistanceTester && (
        <div className="border border-blue-200 bg-blue-50/50 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-blue-800 text-sm">📏 Distance Tester — Check if a position is within range</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input type="number" step="any" placeholder="Latitude" value={testLat} onChange={(e) => setTestLat(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
            <input type="number" step="any" placeholder="Longitude" value={testLng} onChange={(e) => setTestLng(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
            <select value={testGeofenceId} onChange={(e) => setTestGeofenceId(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="">All geofences</option>
              {geofences.map((g) => <option key={g.id} value={g.id}>{g.name} ({formatRadius(g.radiusMeters)})</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={useTestMyLocation} className="px-3 py-2 text-xs border rounded-lg hover:bg-white" title="Use my GPS">📍 My Location</button>
              <button onClick={runDistanceTest} disabled={testing} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {testing ? 'Testing...' : 'Test'}
              </button>
            </div>
          </div>
          {testResult && (
            <div className={`p-3 rounded-lg text-sm ${testResult.passed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              <p className="font-medium">{testResult.message}</p>
              {testResult.results && testResult.results.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {testResult.results.map((r) => (
                    <li key={r.geofenceId} className={r.withinRange ? 'text-green-700' : 'text-red-600'}>
                      {r.withinRange ? '✅' : '❌'} {r.geofenceName}: {r.distanceMetres >= 1000 ? `${(r.distanceMetres / 1000).toFixed(2)} km` : `${r.distanceMetres}m`} away (radius: {formatRadius(r.radiusMetres)})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Employee Assignment Panel ── */}
      {!hideAssignEmployees && showAssignPanel && (
        <div className="border border-green-200 bg-green-50/50 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-green-800 text-sm">👥 Assign Employees to a Work Location</h3>
          <div className="flex gap-3 items-center flex-wrap">
            <select value={assignGeofenceId} onChange={(e) => setAssignGeofenceId(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="">Select geofence...</option>
              {geofences.map((g) => <option key={g.id} value={g.id}>{g.name} ({formatRadius(g.radiusMeters)})</option>)}
            </select>
            <button
              onClick={assignEmployees}
              disabled={assigning || !assignGeofenceId || selectedEmployeeIds.size === 0}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {assigning ? 'Assigning...' : `Assign ${selectedEmployeeIds.size} selected`}
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
            {employees.map((emp) => (
              <label key={emp.id} className="flex items-center gap-3 px-3 py-2 hover:bg-green-50 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={selectedEmployeeIds.has(emp.id)}
                  onChange={() => toggleEmployeeSelection(emp.id)}
                  className="rounded"
                />
                <span className="font-medium">{emp.firstName} {emp.surname}</span>
                <span className="text-slate-400 text-xs">{emp.email}</span>
                <span className="ml-auto text-xs text-slate-400">
                  {emp.geofenceId ? `Assigned: ${geofences.find((g) => g.id === emp.geofenceId)?.name || 'Unknown'}` : '⚠️ No geofence'}
                </span>
              </label>
            ))}
            {employees.length === 0 && <p className="p-3 text-sm text-slate-400">No employees found.</p>}
          </div>
        </div>
      )}

      {/* ── Form Modal ── portaled to document.body so ancestor CSS transforms
          (page animations) don't break fixed positioning / force scrolling */}
      {showForm && createPortal(
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50">
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{editingId ? 'Edit Location' : 'Add New Location'}</h3>

            {/* Quick Presets — company-specific presets (private to your company) */}
            <div className="mb-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Quick Presets</label>
                <span className="text-[10px] text-slate-400">🔒 Private to your company</span>
              </div>
              <input
                placeholder="Filter presets by name or address…"
                value={presetFilter}
                onChange={(e) => setPresetFilter(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-xs mt-1 mb-1.5"
              />
              <div className="max-h-36 overflow-y-auto border rounded-lg divide-y">
                {filteredPresets.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">
                    {presets.length === 0
                      ? 'No presets saved yet. Fill in a location below and click "Save as Preset".'
                      : 'No presets match your filter.'}
                  </p>
                ) : (
                  filteredPresets.map((p) => (
                    <div
                      key={p.id}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-2 ${
                        form.name === p.name
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <button
                        onClick={() => applyPreset(p)}
                        className="flex-1 min-w-0 text-left flex items-center justify-between gap-2"
                      >
                        <span className="min-w-0">
                          <span className="font-medium block truncate">📍 {p.name}</span>
                          <span className="text-slate-400 truncate block text-[11px]">{p.address}</span>
                        </span>
                        <span className="text-slate-400 shrink-0">{formatRadius(p.radiusMeters)}</span>
                      </button>
                      <button
                        onClick={() => deletePreset(p)}
                        disabled={deletingPresetId === p.id}
                        className="text-slate-300 hover:text-red-500 shrink-0 ml-1 disabled:opacity-50"
                        title="Delete preset"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

              {/* Address Search with OpenStreetMap Attribution and Highlight */}
              <div className="mb-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Search Address / Place Name</label>
                <div className="flex gap-2 mt-1">
                  <input
                    placeholder="e.g. Sitari Country Estate, Cape Town"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchAddress()}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm"
                  />
                  <button onClick={searchAddress} disabled={searching} className="px-3 py-2 text-sm bg-slate-100 border rounded-lg hover:bg-slate-200 disabled:opacity-50">
                    {searching ? '...' : '🔍'}
                  </button>
                </div>
                {searchError && <p className="text-xs text-red-500 mt-1">{searchError}</p>}
                {searchResults.length > 0 && (
                  <div className="mt-2 border rounded-lg divide-y max-h-40 overflow-y-auto">
                    {searchResults.map((r, i) => {
                      const isSelected = form.latitude === r.latitude && form.longitude === r.longitude;
                      return (
                        <button
                          key={i}
                          onClick={() => selectSearchResult(r)}
                          className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-start justify-between gap-2 ${
                            isSelected ? 'bg-blue-50 border-l-4 border-l-blue-600 font-medium' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div>
                            <span className="font-medium text-slate-800">{r.displayName.split(',')[0]}</span>
                            <span className="text-slate-400 block truncate text-[11px]">{r.displayName}</span>
                            <span className="text-slate-400 font-mono text-[10px]">{r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}</span>
                          </div>
                          {isSelected && <span className="text-blue-600 font-bold shrink-0">✓ Selected</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-[10px] text-slate-400 mt-1">
                  Search powered by <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">OpenStreetMap</a> contributors
                </p>
              </div>

            {/* Form Fields */}
            <div className="space-y-4">
              <input placeholder="Location Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
              <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-500">Latitude</label>
                  <input type="number" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Longitude</label>
                  <input type="number" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg" />
                </div>
              </div>

              {/* Use My Location */}
              <button onClick={useMyLocation} disabled={locating} className="w-full px-3 py-2 text-sm border rounded-lg hover:bg-slate-50 disabled:opacity-50">
                {locating ? '📡 Acquiring GPS...' : '📍 Use My Current Location'}
              </button>

              {/* Radius Slider */}
              <div>
                <label className="text-sm text-slate-600 flex justify-between">
                  <span>Radius</span>
                  <span className="font-semibold text-blue-600">{formatRadius(form.radiusMeters)}</span>
                </label>
                <input
                  type="range"
                  min="10"
                  max="50000"
                  step="10"
                  value={form.radiusMeters}
                  onChange={(e) => setForm({ ...form, radiusMeters: parseInt(e.target.value) })}
                  className="w-full mt-1"
                />
                <div className="flex justify-between text-xs text-slate-400">
                  <span>10m</span>
                  <span>1km</span>
                  <span>5km</span>
                  <span>10km</span>
                  <span>50km</span>
                </div>
                {/* Quick radius buttons */}
                <div className="flex gap-2 mt-2">
                  {[100, 250, 500, 1000, 2000, 5000, 10000].map((r) => (
                    <button
                      key={r}
                      onClick={() => setForm({ ...form, radiusMeters: r })}
                      className={`px-2 py-1 text-xs border rounded ${form.radiusMeters === r ? 'bg-blue-100 border-blue-400 text-blue-700' : 'hover:bg-slate-50'}`}
                    >
                      {r >= 1000 ? `${r / 1000}km` : `${r}m`}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                <span className="text-sm">Active (employees can clock in here)</span>
              </label>
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">Cancel</button>
              <button
                onClick={saveAsPreset}
                disabled={savingPreset || !form.name.trim()}
                className="px-4 py-2 text-sm border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                title="Save these details as a reusable preset (visible only to your company)"
              >
                {savingPreset ? 'Saving…' : '💾 Save as Preset'}
              </button>
              <button onClick={save} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                {editingId ? 'Update Location' : 'Create Location'}
              </button>
            </div>
          </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Geofence List ── */}
      {geofences.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <p className="text-lg mb-2">No work locations configured</p>
          <p className="text-sm">Click "Add Location" to create your first geofence. You can save frequently used locations as company presets.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {geofences.map((g) => (
            <div key={g.id} className={`border rounded-xl p-4 ${g.isActive ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                    {g.name}
                    {g.isActive ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
                    ) : (
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Inactive</span>
                    )}
                  </h4>
                  <p className="text-sm text-slate-500">{g.address || 'No address set'}</p>
                  <div className="flex gap-4 mt-2 text-xs text-slate-400">
                    <span>📍 {g.latitude.toFixed(5)}, {g.longitude.toFixed(5)}</span>
                    <span>⌀ {formatRadius(g.radiusMeters)}</span>
                    <span>👥 {g.employeeCount} employee{g.employeeCount !== 1 ? 's' : ''} assigned</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => toggleActive(g)} className={`px-3 py-1 text-xs rounded-full border ${g.isActive ? 'hover:bg-orange-50 text-orange-600 border-orange-200' : 'hover:bg-green-50 text-green-600 border-green-200'}`}>
                    {g.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => { setForm({ name: g.name, address: g.address ?? '', latitude: g.latitude, longitude: g.longitude, radiusMeters: g.radiusMeters, isActive: g.isActive }); setEditingId(g.id); setShowForm(true); setSearchQuery(g.name); }} className="px-3 py-1 text-xs rounded-full border hover:bg-slate-50">Edit</button>
                  <button onClick={() => remove(g.id)} className="px-3 py-1 text-xs rounded-full border border-red-200 text-red-600 hover:bg-red-50">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
