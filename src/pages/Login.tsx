/**
 * Login Page
 * ----------
 * Modern split-screen layout with premium blue branding panel on the left,
 * bulleted workforce management features, and a sleek sign-in form on the right.
 * Includes a Forgot Password flow that directs users to contact their company
 * admin (the email the company was registered with) for a password reset.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clock, BarChart3, ShieldCheck, Eye, EyeOff, ArrowRight, KeyRound, ArrowLeft, CheckCircle2, AlertTriangle, Ban, UserX, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Label, Spinner } from '../components/ui';
import { authApi, ApiError } from '../services/api';

export default function Login() {
  const { login, sessionError, clearSessionError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Forgot password state
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);
  const [forgotAdminEmail, setForgotAdminEmail] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please enter email and password');
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) {
      toast.error('Please enter your email address');
      return;
    }
    setForgotSubmitting(true);
    try {
      const res = await authApi.forgotPassword(forgotEmail);
      setForgotSuccess(res.message);
      setForgotAdminEmail(res.adminEmail);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Password reset failed');
    } finally {
      setForgotSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-[#f8fafc] text-slate-900">
      
      {/* ────────────────── LEFT BRANDING PANEL (BLUE) ────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#2563eb] text-white p-16 flex-col justify-between relative overflow-hidden">
        {/* Background Decorative Circles */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/25 rounded-full translate-x-1/3 -translate-y-1/3" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-500/25 rounded-full -translate-x-1/4 translate-y-1/4" />
        
        {/* Top Branding Header */}
        <div className="flex items-center gap-2.5 relative z-10">
          <img
            src="/TimeTrack Icon.png"
            alt="TimeTrack Logo"
            className="w-10 h-10 rounded-xl object-cover shadow-lg bg-white"
          />
          <span className="text-xl font-bold tracking-tight">TimeTrack</span>
        </div>

        {/* Center Bullet Features */}
        <div className="space-y-8 relative z-10 my-auto max-w-lg">
          <div className="space-y-4">
            <h1 className="text-4xl font-extrabold tracking-tight leading-tight">
              Smart Workforce<br />Management Starts Here
            </h1>
            <p className="text-blue-100 text-base leading-relaxed">
              Track time, manage shifts, and optimize your team's productivity with real-time insights.
            </p>
          </div>

          <div className="space-y-5 pt-4">
            {[
              { text: 'Real-time attendance tracking', icon: Clock },
              { text: 'Advanced analytics & reporting', icon: BarChart3 },
              { text: 'Enterprise-grade security', icon: ShieldCheck },
            ].map((feature, idx) => (
              <div key={idx} className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                  <feature.icon className="w-4 h-4 text-white" />
                </div>
                <span className="font-semibold text-sm text-blue-50">{feature.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-xs text-blue-200 relative z-10">
          © 2026 TimeTrack™. All rights reserved.
        </div>
      </div>

      {/* ────────────────── RIGHT LOGIN FORM PANEL ────────────────── */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-slate-50 relative">
        {/* Subtle grid pattern background */}
        <div className="absolute inset-0 pointer-events-none opacity-5"
          style={{
            backgroundImage: 'radial-gradient(hsl(var(--border) / 0.75) 1px, transparent 1px)',
            backgroundSize: '20px 24px',
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-[440px] bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-100/40 p-8 sm:p-10 relative z-10"
        >
          {forgotMode ? (
            <>
              {/* ── Forgot Password Flow ── */}
              <div className="text-center space-y-2 mb-8">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mb-3">
                  <KeyRound className="w-6 h-6 text-blue-600" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                  Forgot password?
                </h2>
                <p className="text-sm text-slate-500 font-medium">
                  Enter your email and we'll show you who to contact for a reset
                </p>
              </div>

              {forgotSuccess ? (
                <div className="space-y-5">
                  <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-900 font-medium leading-relaxed">
                      {forgotSuccess}
                      {forgotAdminEmail && (
                        <div className="mt-3 rounded-lg bg-white border border-blue-200 p-3">
                          <p className="text-xs uppercase font-extrabold tracking-wider text-slate-400 mb-1">
                            Your company admin
                          </p>
                          <a
                            href={`mailto:${forgotAdminEmail}?subject=Password Reset Request`}
                            className="text-sm font-bold text-blue-600 hover:text-blue-700 hover:underline break-all"
                          >
                            {forgotAdminEmail}
                          </a>
                        </div>
                      )}
                      <p className="mt-3 text-xs text-blue-700/80 font-medium">
                        Once your admin resets your password, you can log in with the temporary
                        password <span className="font-bold">Password123</span> and choose a new
                        password or keep it.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => { setForgotMode(false); setForgotSuccess(null); setForgotAdminEmail(null); }}
                    className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back to Sign In
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="forgot-email" className="text-xs uppercase font-extrabold tracking-wider text-slate-500">
                      Email
                    </Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      placeholder="you@company.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      autoComplete="email"
                      required
                      className="h-11 rounded-xl border-slate-200 focus:ring-brand focus:border-brand"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={forgotSubmitting}
                    className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all"
                  >
                    {forgotSubmitting ? (
                      <>
                        <Spinner className="h-4 w-4 border-white/30 border-t-white" />
                        Looking up…
                      </>
                    ) : (
                      <>
                        <KeyRound className="w-4 h-4" />
                        <span>Find My Admin</span>
                      </>
                    )}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setForgotMode(false)}
                    className="w-full text-center text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    ← Back to Sign In
                  </button>
                </form>
              )}
            </>
          ) : (
            <>
              {/* Friendly notice after a successful password rotation */}
              {sessionError && sessionError.code === 'PASSWORD_CHANGED' && (
                <div className="mb-6 rounded-xl border p-4 flex items-start gap-3 bg-emerald-50 border-emerald-200">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-emerald-900 font-medium leading-relaxed flex-1">
                    <p className="font-bold mb-0.5">Password updated</p>
                    <p>{sessionError.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearSessionError}
                    className="text-emerald-400 hover:text-emerald-600 transition-colors text-lg leading-none"
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Session-ended banner (suspension / termination / role revocation / expiry) */}
              {sessionError && sessionError.code !== 'PASSWORD_CHANGED' && (
                <div className="mb-6 rounded-xl border p-4 flex items-start gap-3 bg-red-50 border-red-200">
                  {sessionError.code === 'COMPANY_SUSPENDED' ? (
                    <Ban className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  ) : sessionError.code === 'EMPLOYEE_TERMINATED' ? (
                    <UserX className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  ) : sessionError.code === 'ROLE_REVOKED' ? (
                    <ShieldX className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div className="text-sm text-red-900 font-medium leading-relaxed flex-1">
                    <p className="font-bold mb-0.5">
                      {sessionError.code === 'COMPANY_SUSPENDED'
                        ? 'Company account suspended'
                        : sessionError.code === 'EMPLOYEE_TERMINATED'
                          ? 'Account terminated'
                          : sessionError.code === 'ROLE_REVOKED'
                            ? 'Your access level was changed'
                            : 'Session ended'}
                    </p>
                    <p>{sessionError.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearSessionError}
                    className="text-red-400 hover:text-red-600 transition-colors text-lg leading-none"
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Header */}
              <div className="text-center space-y-2 mb-8">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                  Welcome back
                </h2>
                <p className="text-sm text-slate-500 font-medium">
                  Sign in to your account to continue
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs uppercase font-extrabold tracking-wider text-slate-500">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    className="h-11 rounded-xl border-slate-200 focus:ring-brand focus:border-brand"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-xs uppercase font-extrabold tracking-wider text-slate-500">
                      Password
                    </Label>
                    <button
                      type="button"
                      onClick={() => { setForgotMode(true); setForgotSuccess(null); setForgotEmail(email); }}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      className="h-11 rounded-xl border-slate-200 pr-10 focus:ring-brand focus:border-brand"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                </div>

                {/* Remember Me */}
                <div className="flex items-center gap-2.5 pt-1">
                  <input
                    id="remember"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4.5 h-4.5 rounded-md border-slate-300 text-blue-600 focus:ring-blue-500 transition-colors"
                  />
                  <label htmlFor="remember" className="text-sm font-semibold text-slate-600 select-none cursor-pointer">
                    Remember me for 30 days
                  </label>
                </div>

                {/* Sign In Button */}
                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all"
                >
                  {submitting ? (
                    <>
                      <Spinner className="h-4 w-4 border-white/30 border-t-white" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      <span>Sign In</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </form>

              {/* Form Footer */}
              <div className="mt-8 text-center text-xs text-slate-400 leading-relaxed font-semibold max-w-[280px] mx-auto">
                Don't have an account? Contact your administrator to get started.
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}