import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyWorkLocation } from '../MyWorkLocation';

const { state } = vi.hoisted(() => ({
  state: {
    autoGeofenceEnabled: true,
    nativeShell: true,
    nativeStatus: null,
    monitorState: null,
  },
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'employee@test', role: 'employee' } }),
}));
vi.mock('../../../hooks/useSSE', () => ({ useSSE: vi.fn() }));
vi.mock('../../../hooks/useAutoGeofence', () => ({
  useAutoGeofenceState: () => state,
  isAutoClockEligible: () => true,
}));
vi.mock('../../settings/GeofenceManager', () => ({ GeofenceManager: () => null }));
vi.mock('../AddLocationModal', () => ({ AddLocationModal: () => null }));

const geofences = [
  {
    id: 'office',
    name: 'Main Office',
    latitude: 0,
    longitude: 0,
    radiusMeters: 100,
    isActive: true,
  },
  { id: 'depot', name: 'Depot', latitude: 1, longitude: 1, radiusMeters: 100, isActive: true },
];
beforeEach(() => {
  state.autoGeofenceEnabled = true;
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ geofences, employee: { geofenceIds: ['office'] } }),
      }),
  );
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { latitude: 0, longitude: 0, accuracy: 24 } } as GeolocationPosition),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('MyWorkLocation status integration', () => {
  it('explains inside + not clocked in without guessing background health', async () => {
    render(<MyWorkLocation canAddLocation={false} clockedIn={false} />);
    expect(await screen.findByText('Inside geofence')).toBeInTheDocument();
    expect(
      screen.getByText('1 assigned location · 2 active company locations'),
    ).toBeInTheDocument();
    expect(screen.getByText('Background status unavailable')).toBeInTheDocument();
    expect(screen.getByText('±24 m')).toBeInTheDocument();
    expect(screen.queryByText('Depot')).not.toBeInTheDocument();
  });

  it('does not assume not-clocked-in while attendance is loading', async () => {
    render(<MyWorkLocation canAddLocation={false} />);
    await screen.findByText('Inside geofence');
    expect(screen.queryByText('Background status unavailable')).not.toBeInTheDocument();
  });

  it('explains OFF even when foreground location permission is denied', async () => {
    state.autoGeofenceEnabled = false;
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) =>
          failure({ code: 1 } as GeolocationPositionError),
      },
    });
    render(<MyWorkLocation canAddLocation={false} clockedIn={false} />);
    expect(
      await screen.findByText('Auto-Geofence OFF — no automatic clock-in'),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Location access denied/)).toBeInTheDocument();
  });
});
