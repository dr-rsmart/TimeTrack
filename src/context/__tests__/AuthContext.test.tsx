import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ────────────────────────────────────────────────────────────────
const { meMock, loginMock, logoutMock, registerMock, suppressMock, nativeTokenMock } = vi.hoisted(
  () => ({
    meMock: vi.fn(),
    loginMock: vi.fn(),
    logoutMock: vi.fn(),
    registerMock: vi.fn(),
    suppressMock: vi.fn(() => () => undefined),
    nativeTokenMock: vi.fn(),
  }),
);

vi.mock('../../services/api', () => ({
  authApi: {
    me: meMock,
    login: loginMock,
    logout: logoutMock,
    nativeToken: nativeTokenMock,
  },
  registerSessionHandler: registerMock,
  suppressUnauthenticatedErrors: suppressMock,
}));

vi.mock('../../hooks/useAutoGeofence', () => ({
  postToNativeShell: vi.fn(),
  isNativeShellPresent: () => false,
  isAutoClockEligible: () => false,
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
      <button onClick={() => void auth.endSessionAfterPasswordChange()}>pw-change</button>
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

  it('endSessionAfterPasswordChange shows the friendly PASSWORD_CHANGED notice', async () => {
    meMock.mockResolvedValue(employeeUser);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('lerato@'));
    await userEvent.click(screen.getByRole('button', { name: 'pw-change' }));
    await waitFor(() =>
      expect(screen.getByTestId('session-error')).toHaveTextContent('PASSWORD_CHANGED'),
    );
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    await userEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.getByTestId('session-error')).toHaveTextContent('none');
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

describe('useAuth', () => {
  it('throws when used outside an AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/useAuth must be used within AuthProvider/);
    spy.mockRestore();
  });
});
