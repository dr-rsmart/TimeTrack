/**
 * Auth Context
 * ------------
 * Session state, login/logout, and role helpers.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { authApi, registerSessionHandler, suppressUnauthenticatedErrors, type CurrentUser, type SessionErrorCode } from '../services/api';

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  /** Set when the session was forcibly ended by the server (suspension, termination, role revocation). */
  sessionError: { code: SessionErrorCode; message: string } | null;
  clearSessionError: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * End the session after a successful password rotation. The rotation bumps
   * pwdEpoch, revoking the current cookie on the next request; instead of
   * letting that surface as a red "Session ended" banner, sign out voluntarily
   * and show a friendly "password updated — sign in again" notice.
   */
  endSessionAfterPasswordChange: () => Promise<void>;
  refresh: () => Promise<void>;
  isAdmin: boolean;
  isManager: boolean;
  isEmployee: boolean;
  isMaster: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<{ code: SessionErrorCode; message: string } | null>(null);

  // Track whether a session is (or was) active so the global 401 handler can
  // distinguish "session forcibly ended" from "no session to begin with".
  const hadSessionRef = useRef(false);
  // True while a voluntary logout is in progress — 401s from in-flight
  // requests must not surface the "Session ended" banner.
  const loggingOutRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me();
      hadSessionRef.current = true;
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  // Register the global session handler: when the API returns 403
  // COMPANY_SUSPENDED / EMPLOYEE_TERMINATED / ROLE_REVOKED or 401, force
  // logout and surface the reason so the UI can show the correct screen.
  useEffect(() => {
    registerSessionHandler((code, message) => {
      // A 401 when no session was ever active (e.g. the initial /auth/me
      // probe on the login page, or arriving signed-out) is expected — it is
      // not a "session ended" event, so do not show the banner.
      if (code === 'UNAUTHENTICATED' && !hadSessionRef.current) return;
      // A 401 during a voluntary sign-out is also expected.
      if (code === 'UNAUTHENTICATED' && loggingOutRef.current) return;
      setSessionError({ code, message });
      hadSessionRef.current = false;
      setUser(null);
    });
    return () => registerSessionHandler(null);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    hadSessionRef.current = true;
    setSessionError(null);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    // Voluntary sign-out: suppress 401-driven "Session ended" notifications
    // from the logout request itself and any in-flight calls, and clear any
    // stale banner so the login page renders clean.
    loggingOutRef.current = true;
    const restore = suppressUnauthenticatedErrors();
    try {
      await authApi.logout();
    } catch {
      // Logout endpoint failure is non-fatal — the client session ends anyway.
    } finally {
      hadSessionRef.current = false;
      setSessionError(null);
      setUser(null);
      restore();
      // Allow in-flight requests to settle before re-arming the 401 handler.
      setTimeout(() => {
        loggingOutRef.current = false;
      }, 1500);
    }
  }, []);

  const endSessionAfterPasswordChange = useCallback(async () => {
    // Same suppression choreography as a voluntary logout: the just-rotated
    // session's cookie is epoch-stale, so in-flight requests / SSE reconnects
    // will 401 SESSION_REVOKED — expected, not a "session ended" event.
    loggingOutRef.current = true;
    const restore = suppressUnauthenticatedErrors();
    try {
      await authApi.logout();
    } catch {
      // Logout endpoint failure is non-fatal — the client session ends anyway.
    } finally {
      hadSessionRef.current = false;
      setSessionError({
        code: 'PASSWORD_CHANGED',
        message: 'Your password was updated. Please sign in with your new password.',
      });
      setUser(null);
      restore();
      // Allow in-flight requests to settle before re-arming the 401 handler.
      setTimeout(() => {
        loggingOutRef.current = false;
      }, 1500);
    }
  }, []);

  const clearSessionError = useCallback(() => setSessionError(null), []);

  const value: AuthContextValue = {
    user,
    loading,
    sessionError,
    clearSessionError,
    login,
    logout,
    endSessionAfterPasswordChange,
    refresh,
    isAdmin: user?.role === 'admin' || user?.role === 'master',
    isManager: user?.role === 'manager',
    isEmployee: user?.role === 'employee',
    isMaster: user?.role === 'master',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}