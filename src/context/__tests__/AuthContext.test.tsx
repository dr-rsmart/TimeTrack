import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ────────────────────────────────────────────────────────────────
const {
  meMock,
  loginMock,
  logoutMock,
  registerMock,
  suppressMock,
  nativeTokenMock,
  hasTokenMock,
  clearTokenMock,
  postToShellMock,
  shellPresentMock,
  eligibleMock,
} = vi.hoisted(() => ({
  meMock: vi.fn(),
  loginMock: vi.fn(),
  logoutMock: vi.fn(),
  registerMock: vi.fn(),
  suppressMock: vi.fn(() => () => undefined),
  nativeTokenMock: vi.fn(),
  hasTokenMock: vi.fn(() => false),
  clearTokenMock: vi.fn(),
  postToShellMock: vi.fn(),
  shellPresentMock: vi.fn(() => false),
  eligibleMock: vi.fn(() => false),
}));

vi.mock('../../services/api', () => ({
  authApi: {
    me: meMock,
    login: loginMock,
    logout: logoutMock,
    nativeToken: nativeTokenMock,
  },
  registerSessionHandler: registerMock,
  suppressUnauthenticatedErrors: suppressMock,
  hasStoredNativeToken: hasTokenMock,
  clearStoredNativeToken: clearTokenMock,
}));

vi.mock('../../hooks/useAutoGeofence', () => ({
  postToNativeShell: postToShellMock,
  isNativeShellPresent: shellPresentMock,
  isAutoClockEligible: eligibleMock,
}));

import { AuthProvider, useAuth } from '../AuthContext';

type SessionHandler = (code: string, message: string) => void;

const masterUser = {
  id: 'u1',
  email: 'master@timetrack.com',
  fullName: 'Master User',
  role: 'master',
} as never;

const employeeUser = {
  id: 'u2',
  email: 'lerato@timetrack.com',
  fullName: 'Lerato Employee',
  role: 'employee',
} as never;

let capturedHandler: SessionHandler | null = null;

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="user">{auth.user?.email ?? 'none'}</span>
      <span data-testid="flags">
        {`admin:${auth.isAdmin},manager:${auth.isManager},employee:${auth.isEmployee},master:${auth.isMaster}`}
      </span>
      <span data-testid="session-error">{auth.sessionError?.code ?? 'none'}</span>
      <button onClick={() => void auth.login('lerato@timetrack.com', 'Password123')}>login</button>
      <button onClick={() => void auth.logout()}>logout</button>
      <button onClick={auth.clearSessionError}>clear</button>
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedHandler = null;
  registerMock.mockImplementation((handler: SessionHandler | null) => {
    capturedHandler = handler;
  });
  suppressMock.mockReturnValue(() => undefined);
  logoutMock.mockResolvedValue({ success: true });
  hasTokenMock.mockReturnValue(false);
  shellPresentMock.mockReturnValue(false);
  eligibleMock.mockReturnValue(false);
  nativeTokenMock.mockResolvedValue({
    token: 'native-tok',
    refreshToken: 'refresh-tok',
    expiresIn: null,
  });
});

describe('AuthProvider — session probe', () => {
  it('starts loading and restores an existing session via me()', async () => {
    meMock.mockResolvedValue(employeeUser);
    renderAuth();
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('lerato@'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('flags')).toHaveTextContent('employee:true');
  });

  it('lands signed-out when me() rejects, without a session-error banner', async () => {
    meMock.mockRejectedValue(new Error('401'));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(screen.getByTestId('session-error')).toHaveTextContent('none');
  });

  it('derives master/admin flags for master accounts', async () => {
    meMock.mockResolvedValue(masterUser);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('master@'));
    expect(screen.getByTestId('flags')).toHaveTextContent('admin:true');
    expect(screen.getByTestId('flags')).toHaveTextContent('master:true');
  });
});

describe('AuthProvider — login / logout choreography', () => {
  it('login sets the user and clears any stale session error', async () => {
    meMock.mockRejectedValue(new Error('401'));
    loginMock.mockResolvedValue({ user: employeeUser, token: 'tok' });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    await userEvent.click(screen.getByRole('button', { name: 'login' }));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('lerato@'));
    expect(screen.getByTestId('session-error')).toHaveTextContent('none');
  });

  it('logout suppresses unauthenticated errors and clears the user', async () => {
    meMock.mockResolvedValue(employeeUser);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('lerato@'));
    await userEvent.click(screen.getByRole('button', { name: 'logout' }));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
    expect(suppressMock).toHaveBeenCalled();
    expect(logoutMock).toHaveBeenCalled();
  });

  it('logout is resilient to a failing logout endpoint', async () => {
    meMock.mockResolvedValue(employeeUser);
    logoutMock.mockRejectedValueOnce(new Error('network'));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('lerato@'));
    await userEvent.click(screen.getByRole('button', { name: 'logout' }));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
  });
});

describe('AuthProvider — forced session end (server-driven)', () => {
  it('a registered session handler forces logout with the reason', async () => {
    meMock.mockResolvedValue(employeeUser);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('lerato@'));
    expect(capturedHandler).toBeTypeOf('function');
    act(() => capturedHandler!('COMPANY_SUSPENDED', 'Company suspended by platform admin'));
    expect(screen.getByTestId('session-error')).toHaveTextContent('COMPANY_SUSPENDED');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('ignores UNAUTHENTICATED when no session was ever active', async () => {
    meMock.mockRejectedValue(new Error('401'));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    act(() => capturedHandler!('UNAUTHENTICATED', 'Session expired'));
    expect(screen.getByTestId('session-error')).toHaveTextContent('none');
  });
});

describe('AuthProvider — native shell bearer lifecycle', () => {
  beforeEach(() => {
    shellPresentMock.mockReturnValue(true);
    eligibleMock.mockReturnValue(true);
  });

  it('mints a native token once while the bridge stores none', async () => {
    meMock.mockResolvedValue(employeeUser);
    hasTokenMock.mockReturnValue(false);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('lerato@'));
    await waitFor(() => expect(nativeTokenMock).toHaveBeenCalledTimes(1));
    expect(postToShellMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AUTH_TOKEN',
        token: 'native-tok',
        refreshToken: 'refresh-tok',
        email: 'lerato@timetrack.com',
      }),
    );
  });

  it('does NOT re-mint when the bridge already stores a token (no mint/inject loop)', async () => {
    meMock.mockResolvedValue(employeeUser);
    hasTokenMock.mockReturnValue(true);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('lerato@'));
    // Shell cold restore: the bridge event triggers another session probe.
    act(() => {
      window.dispatchEvent(new Event('timetrack-native-token'));
    });
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(2));
    expect(nativeTokenMock).not.toHaveBeenCalled();
  });

  it('clears the bridged bearer on a server-forced session end', async () => {
    meMock.mockResolvedValue(employeeUser);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('lerato@'));
    expect(capturedHandler).toBeTypeOf('function');
    act(() => capturedHandler!('ROLE_REVOKED', 'Role revoked'));
    expect(screen.getByTestId('session-error')).toHaveTextContent('ROLE_REVOKED');
    expect(postToShellMock).toHaveBeenCalledWith({ type: 'SESSION_ENDED' });
    expect(clearTokenMock).toHaveBeenCalled();
  });

  it('clears a stale bridged bearer on login before minting a fresh one', async () => {
    meMock.mockRejectedValue(new Error('401'));
    loginMock.mockResolvedValue({ user: employeeUser, token: 'tok' });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    await userEvent.click(screen.getByRole('button', { name: 'login' }));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('lerato@'));
    expect(clearTokenMock).toHaveBeenCalled();
    await waitFor(() => expect(nativeTokenMock).toHaveBeenCalledTimes(1));
  });
});

describe('useAuth', () => {
  it('throws when used outside an AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/useAuth must be used within AuthProvider/);
    spy.mockRestore();
  });
});
