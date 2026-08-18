/**
 * App Layout
 * ----------
 * Modern top navigation with glassmorphism, animated active pill,
 * role badges, theme toggle, SSE status, and mobile bottom nav.
 */

import { Outlet, Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Clock,
  FileBarChart,
  ScrollText,
  Settings,
  LogOut,
  Wifi,
  WifiOff,
  Moon,
  Sun,
  ShieldAlert,
  Sparkles,
  User,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useSSEStatus, useSSEConnection } from '../../hooks/useSSE';
import { cn } from '../../lib/utils';
import BrandLogo from './BrandLogo';
import { masterApi } from '../../services/api';
import { toast } from 'sonner';

// Navigation items with role-based access control
const allNavItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['master', 'admin', 'manager', 'employee'] },
  { path: '/employees', label: 'Workforce', icon: Users, roles: ['admin', 'manager'] },
  { path: '/register', label: 'Register', icon: Users, roles: ['master'] },
  { path: '/shifts', label: 'Shifts', icon: CalendarDays, roles: ['admin', 'manager', 'employee'] },
  { path: '/time', label: 'Time', icon: Clock, roles: ['admin', 'manager', 'employee'] },
  { path: '/reports', label: 'Reports', icon: FileBarChart, roles: ['admin', 'manager'] },
  { path: '/audit', label: 'Audit', icon: ScrollText, roles: ['admin', 'manager'] },
  { path: '/settings', label: 'Settings', icon: Settings, roles: ['admin', 'master'] },
  { path: '/demo', label: 'Demo', icon: Sparkles, roles: ['master'] },
  { path: '/profile', label: 'Profile', icon: User, roles: ['master', 'admin', 'manager', 'employee'] },
];


export default function AppLayout() {
  const location = useLocation();
  const { user, logout, refresh } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  // Keep the shared real-time connection alive on every page so the
  // status indicator reflects the true connection state, even on pages
  // that don't subscribe to SSE events directly.
  useSSEConnection();
  const sseStatus = useSSEStatus();

  const isDemoSession = Boolean(user?.demoEmail);

  const handleStopImpersonation = async () => {
    try {
      await masterApi.stopImpersonation();
      toast.success('Restored Master Session.');
      await refresh();
      // Demo sessions return to the Master Console dashboard; tenant
      // impersonation returns to the tenant register screen.
      window.location.href = isDemoSession ? '/' : '/register';
    } catch (err: any) {
      toast.error(err.message || 'Failed to exit impersonation');
    }
  };

  const role = user?.role ?? 'employee';
  const navItems = allNavItems.filter((item) => item.roles.includes(role));

  const getNavLabel = (item: (typeof allNavItems)[0]) => {
    return item.label;
  };

  const getTestId = (path: string) => (path === '/' ? 'dashboard' : path.slice(1));

  const initials = user?.fullName
    ? user.fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U';

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/30 relative">
      {user?.originalRole === 'master' && (
        <div className="bg-brand text-white text-xs font-semibold py-2 px-4 flex items-center justify-between shadow-md relative z-50">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
            {isDemoSession ? (
              <span>
                Demo Mode: <span className="font-bold">{user?.fullName}</span> ({user?.role})
              </span>
            ) : (
              <span>
                Impersonating: <span className="font-bold">{user?.companyProfile?.name || 'Tenant Admin'}</span>
              </span>
            )}
          </div>
          <button
            onClick={handleStopImpersonation}
            className="bg-white/10 hover:bg-white/20 text-white rounded-md px-3 py-1 font-bold border border-white/20 transition-all"
          >
            Return to Master Console
          </button>
        </div>
      )}
      {/* Background pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: 'radial-gradient(hsl(var(--border) / 0.75) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-tr from-background via-background/95 to-primary/5 pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      {/* Top Navigation */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/40 safe-top relative">
        {/* Accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand via-brand/90 to-brand-light" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <BrandLogo size="md" animated />
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1.5 p-1 rounded-xl bg-secondary/40 backdrop-blur-sm">
              {navItems.map((item) => {
                const isActive =
                  location.pathname === item.path ||
                  (item.path !== '/' && location.pathname.startsWith(item.path));
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    data-testid={`nav-${getTestId(item.path)}`}
                    aria-label={getNavLabel(item)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300',
                      isActive
                        ? 'text-primary-foreground font-semibold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40',
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeNavPill"
                        className="absolute inset-0 bg-brand rounded-lg shadow-lg shadow-brand/20"
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                    <item.icon className="w-4 h-4 relative z-10" />
                    <span className="relative z-10 hidden lg:inline">{getNavLabel(item)}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Right side controls */}
            <div className="flex items-center gap-3">
              {/* SSE Connection Status */}
              {role !== 'master' && (
                <div
                  className="hidden sm:flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground"
                  title={
                    sseStatus === 'connected'
                      ? 'Real-time connection active'
                      : sseStatus === 'connecting'
                        ? 'Connecting to real-time updates...'
                        : 'Real-time disconnected — updates may be delayed'
                  }
                >
                  {sseStatus === 'connected' ? (
                    <>
                      <Wifi className="w-3 h-3 text-emerald-500" />
                      <span className="text-emerald-500">Live</span>
                    </>
                  ) : sseStatus === 'connecting' ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-amber-500">Syncing</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-3 h-3 text-muted-foreground/60" />
                      <span className="text-muted-foreground/60">Offline</span>
                    </>
                  )}
                </div>
              )}

              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                aria-label="Toggle theme"
                data-testid="theme-toggle"
              >
                {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {/* User Profile — avatar only; clicking opens the Profile page */}
              {user && (
                <Link
                  to="/profile"
                  data-testid="nav-profile-avatar"
                  aria-label="Open my profile"
                  title="My Profile"
                  className="block pl-3 border-l border-border/40"
                >
                  <div className="relative">
                    <div
                      className={cn(
                        'w-9 h-9 rounded-full font-bold flex items-center justify-center text-xs overflow-hidden border transition-all hover:ring-2 hover:ring-brand/40',
                        role === 'master'
                          ? 'bg-brand/10 text-brand border-brand/20'
                          : role === 'admin'
                            ? 'bg-red-500/10 text-red-600 border-red-500/20'
                            : role === 'manager'
                              ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                              : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
                      )}
                    >
                      {initials}
                    </div>
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-background" />
                  </div>
                </Link>
              )}

              {/* Exit Impersonation Button (visible when master is impersonating a tenant) */}
              {/* Removed Exit Impersonation from header as requested; keeping top banner "Return to Master Console" */}

              {/* Sign Out */}
              <button
                onClick={handleLogout}
                data-testid="nav-signout"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all duration-200 px-3 py-2 rounded-lg border border-transparent hover:border-destructive/10"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline font-medium">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass-card border-t border-border/40 safe-bottom">
        <div className="flex items-center justify-around px-2 py-2" style={{ minHeight: '4rem' }}>
          {navItems.slice(0, 5).map((item) => {
            const isActive =
              location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                to={item.path}
                data-testid={`mobile-nav-${getTestId(item.path)}`}
                aria-label={getNavLabel(item)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 transition-all duration-300 min-w-[52px]',
                  isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeMobilePill"
                    className="absolute inset-0 bg-brand rounded-xl shadow-lg shadow-brand/25"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <item.icon className={cn('w-5 h-5 relative z-10', isActive && 'stroke-[2.5]')} />
                <span className="text-[10px] font-semibold relative z-10">{getNavLabel(item)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-6 animate-fade-in-up relative z-10">
        <Outlet />
      </main>
    </div>
  );
}