/**
 * App Router
 * ----------
 * Route definitions with auth guards, role-based access,
 * and animated page transitions.
 */

import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Shifts from './pages/Shifts';
import TimeTracking from './pages/TimeTracking';
import Reports from './pages/Reports';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import Register from './pages/Register';
import Demo from './pages/Demo';
import ProfilePage from './pages/Profile';
import ChangePasswordModal from './components/auth/ChangePasswordModal';
import AutoGeofenceMonitor from './components/location/AutoGeofenceMonitor';
import { Spinner } from './components/ui';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, refresh } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="h-10 w-10 border-[3px]" />
          <p className="text-sm text-muted-foreground animate-pulse">Loading your workspace...</p>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return (
    <>
      {/* Auto clock-in/out monitoring — owned once at shell level so it runs
          on every page, not just the dashboard. */}
      <AutoGeofenceMonitor />
      {children}
      {/* Forced password reset for accounts still on the default password */}
      {user.mustChangePassword && (
        <ChangePasswordModal
          forced
          allowKeep={!user.usingDefaultPassword}
          onSuccess={() => refresh()}
        />
      )}
    </>
  );
}

function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Animated page wrapper for route transitions */
function SlidePage({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<SlidePage><Dashboard /></SlidePage>} />
          <Route
            path="/employees"
            element={
              <RequireRole roles={['admin', 'manager']}>
                <SlidePage><Employees /></SlidePage>
              </RequireRole>
            }
          />
          <Route
            path="/register"
            element={
              <RequireRole roles={['master']}>
                <SlidePage><Register /></SlidePage>
              </RequireRole>
            }
          />
          <Route path="/shifts" element={<SlidePage><Shifts /></SlidePage>} />
          <Route path="/time" element={<SlidePage><TimeTracking /></SlidePage>} />
          <Route path="/reports" element={<SlidePage><Reports /></SlidePage>} />
          <Route
            path="/audit"
            element={
              <RequireRole roles={['admin', 'manager']}>
                <SlidePage><AuditLog /></SlidePage>
              </RequireRole>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireRole roles={['admin', 'master']}>
                <SlidePage><Settings /></SlidePage>
              </RequireRole>
            }
          />
          <Route
            path="/demo"
            element={
              <RequireRole roles={['master']}>
                <SlidePage><Demo /></SlidePage>
              </RequireRole>
            }
          />
          <Route path="/profile" element={<SlidePage><ProfilePage /></SlidePage>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Toaster position="top-right" richColors closeButton />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="*"
              element={
                <RequireAuth>
                  <AnimatedRoutes />
                </RequireAuth>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}