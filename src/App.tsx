import { Toaster } from "@/components/ui/toaster"
import { Toaster as Sonner } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { AnimatePresence, motion } from 'framer-motion';
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import Workforce from '@/pages/Workforce';
import Reports from '@/pages/Reports';
import Settings from '@/pages/Settings';
import Help from '@/pages/Help';
import Demo from '@/pages/Demo';
import Login from '@/pages/Login';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, navigateToLogin } = useAuth();
  const location = useLocation();

  const isLoginPage = location.pathname === "/Login";

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Login page: show if not authenticated, redirect away if already logged in
  if (isLoginPage) {
    if (isAuthenticated) {
      return <Navigate to="/" replace />;
    }
    return (
      <Routes>
        <Route path="/Login" element={<Login />} />
      </Routes>
    );
  }

  // If not authenticated and not on login page, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/Login" replace />;
  }

  // Handle authentication errors for all other pages
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<SlidePage><Dashboard /></SlidePage>} />
          <Route path="/workforce" element={<SlidePage><Workforce /></SlidePage>} />
          <Route path="/reports" element={<SlidePage><Reports /></SlidePage>} />
          <Route path="/settings" element={<SlidePage><Settings /></SlidePage>} />
          <Route path="/help" element={<SlidePage><Help /></SlidePage>} />
          <Route path="/demo" element={<SlidePage><Demo /></SlidePage>} />
        </Route>
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </AnimatePresence>
  );
};


const SlidePage = ({ children }) => (
  <motion.div
    initial={{ opacity: 0, x: 16 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: -16 }}
    transition={{ duration: 0.2, ease: "easeInOut" }}
  >
    {children}
  </motion.div>
);

function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <Sonner />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App