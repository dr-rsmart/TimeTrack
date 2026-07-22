import React, { createContext, useState, useContext, useEffect } from 'react';
import { client } from '@/api/Client';

const AuthContext = createContext<any>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState<any>(null);

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);

      setAppPublicSettings({
        id: 'local',
        public_settings: {
          require_auth: false,
        },
      });

      // Check if user is already logged in via localStorage token
      const storedUser = localStorage.getItem('timetrack_user');
      const storedToken = localStorage.getItem('timetrack_token');

      if (storedToken && storedUser) {
        try {
          // Verify token is still valid by calling /api/auth/me with Bearer token
          const currentUser = await client.auth.me();
          setUser(currentUser);
          setIsAuthenticated(true);
          localStorage.setItem('timetrack_user', JSON.stringify(currentUser));
          setIsLoadingPublicSettings(false);
          setIsLoadingAuth(false);
          setAuthChecked(true);
          return;
        } catch {
          // Token expired or invalid — clear storage and fall through
          localStorage.removeItem('timetrack_token');
          localStorage.removeItem('timetrack_user');
        }
      }

      // No valid stored auth — try to auto-fetch admin (backward compat)
      try {
        const currentUser = await client.auth.me();
        setUser(currentUser);
        setIsAuthenticated(true);
        localStorage.setItem('timetrack_user', JSON.stringify(currentUser));
      } catch {
        setIsAuthenticated(false);
      }

      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    } catch (error: any) {
      console.error('Unexpected error:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'An unexpected error occurred',
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  const checkUserAuth = async () => {
    try {
      setIsLoadingAuth(true);
      const currentUser = await client.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      localStorage.setItem('timetrack_user', JSON.stringify(currentUser));
      setIsLoadingAuth(false);
      setAuthChecked(true);
    } catch (error: any) {
      console.error('User auth check failed:', error);
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      setAuthChecked(true);

      if (error.status === 401 || error.status === 403) {
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required',
        });
      }
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    client.auth.logout(shouldRedirect ? window.location.href : null);
  };

  const navigateToLogin = () => {
    const next = window.location.pathname + window.location.search;
    window.location.href = `/Login?next=${encodeURIComponent(next)}`;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        authChecked,
        logout,
        navigateToLogin,
        checkUserAuth,
        checkAppState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};