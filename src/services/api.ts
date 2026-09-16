/**
 * API Client
 * ----------
 * Centralized fetch wrapper with credentials, error handling,
 * and typed helpers for all backend endpoints.
 */

import type {
  ApiErrorCode,
  BulkClockInResponse,
  BulkClockOutResponse,
  CurrentUser,
  SessionErrorCode,
  TimeEntry,
  UpdateTimeEntryRequest,
} from '../../contracts/index.js';

export type {
  ApiErrorCode,
  BulkClockInResponse,
  BulkClockOutResponse,
  CurrentUser,
  SessionErrorCode,
  TimeEntry,
  UpdateTimeEntryRequest,
} from '../../contracts/index.js';

export class ApiError extends Error {
  status: number;
  code?: ApiErrorCode | string;
  details?: { path: string; message: string }[];

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ── Global session-state interceptor ──
// When the server returns 403 COMPANY_SUSPENDED / EMPLOYEE_TERMINATED /
// ROLE_REVOKED or 401 (expired/invalid token), the user's session is no
// longer viable. We notify a registered handler (AuthContext) so the UI can
// force logout and show the appropriate screen instead of leaving the user
// stranded with failing widgets.
type SessionHandler = (code: SessionErrorCode, message: string) => void;
let sessionHandler: SessionHandler | null = null;

// When true, UNAUTHENTICATED (401) errors are suppressed. This prevents the
// "Session ended" banner from appearing after a voluntary sign-out, where
// in-flight requests or SSE reconnects may still return 401.
let suppressUnauthenticated = false;

/** Generate a unique key for one logical clocking request. */
function createIdempotencyKey(action: 'clock-in' | 'clock-out'): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return `${action}-${cryptoApi.randomUUID()}`;
  return `${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function registerSessionHandler(handler: SessionHandler | null): void {
  sessionHandler = handler;
}

/**
 * Temporarily suppress UNAUTHENTICATED session-error notifications.
 * Call this before a voluntary logout to prevent the "Session ended" banner.
 * Returns a function to restore normal behaviour.
 */
export function suppressUnauthenticatedErrors(): () => void {
  suppressUnauthenticated = true;
  return () => {
    suppressUnauthenticated = false;
  };
}

function notifySessionError(code: SessionErrorCode, message: string): void {
  if (code === 'UNAUTHENTICATED' && suppressUnauthenticated) return;
  if (sessionHandler) sessionHandler(code, message);
}

// ── Native shell bridged bearer ──────────────────────────────────────────
// The shell bridge stores its bearer token in sessionStorage. Current tokens
// are persistent (no `exp` claim), but LEGACY builds stored 15-minute tokens.
// Attaching an expired bearer would override the still-valid httpOnly cookie
// (the server prefers Bearer), kicking the user out of a live session — so
// expired stored tokens are dropped on read.
const NATIVE_TOKEN_KEY = 'timetrack_native_token';

function isNativeShell(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView !==
      'undefined'
  );
}

/** Decode a JWT payload WITHOUT verification (client-side expiry check only). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** True when the shell bridge has a bearer token stored for this WebView. */
export function hasStoredNativeToken(): boolean {
  if (!isNativeShell()) return false;
  try {
    return Boolean(sessionStorage.getItem(NATIVE_TOKEN_KEY));
  } catch {
    return false;
  }
}

/** Drop the bridged bearer (login, logout, server-forced session end). */
export function clearStoredNativeToken(): void {
  try {
    sessionStorage.removeItem(NATIVE_TOKEN_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

/**
 * Read the bridged bearer for a request. Returns null — and deletes the
 * stored value — when the token is a LEGACY short-lived JWT past its `exp`,
 * so the request falls back to the httpOnly cookie. Malformed/opaque values
 * are passed through for the server to reject.
 */
function readNativeToken(): string | null {
  if (!isNativeShell()) return null;
  let token: string | null = null;
  try {
    token = sessionStorage.getItem(NATIVE_TOKEN_KEY);
  } catch {
    return null;
  }
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp === 'number' && exp * 1000 <= Date.now()) {
    clearStoredNativeToken();
    return null;
  }
  return token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { headers: optionHeaders, ...requestOptions } = options;
  // The native shell supplies its bearer token through the bridge only. Never
  // read the fallback token from browser localStorage: that would turn an
  // httpOnly-cookie session into an XSS-readable credential. Expired LEGACY
  // bearers are dropped (readNativeToken) so they can never override a valid
  // cookie session.
  const nativeToken = readNativeToken();
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(nativeToken ? { Authorization: `Bearer ${nativeToken}` } : {}),
      ...(optionHeaders || {}),
    },
    ...requestOptions,
  });

  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = await res.json();
    } catch {
      // non-JSON error
    }

    // Global session-state interception: surface suspension / termination /
    // role-revocation / auth-expiry to the registered handler so the app can
    // force logout and show the correct screen.
    const code = body.code as string | undefined;
    const errorMsg = (body.error as string) || `Request failed (${res.status})`;
    if (res.status === 401) {
      // Credential-verification endpoints reject bad input with 401-style
      // payloads (login: wrong email/password; change-password: wrong current
      // password). Those are form errors rendered inline by their screens —
      // NOT session events. Surfacing them as "Session ended" would kill a
      // perfectly valid session on a simple typo.
      const isCredentialCheck =
        path.startsWith('/auth/login') || path.startsWith('/auth/change-password');
      if (!isCredentialCheck) {
        notifySessionError('UNAUTHENTICATED', errorMsg);
      }
    } else if (res.status === 403 && code === 'COMPANY_SUSPENDED') {
      notifySessionError('COMPANY_SUSPENDED', errorMsg);
    } else if (res.status === 403 && code === 'EMPLOYEE_TERMINATED') {
      notifySessionError('EMPLOYEE_TERMINATED', errorMsg);
    } else if (res.status === 403 && code === 'ROLE_REVOKED') {
      notifySessionError('ROLE_REVOKED', errorMsg);
    }

    throw new ApiError(
      errorMsg,
      res.status,
      code,
      body.details as { path: string; message: string }[] | undefined,
    );
  }

  // 204 no content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, headers?: HeadersInit) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers,
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ── Auth ──

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ user: CurrentUser; token: string }>('/auth/login', { email, password }),
  logout: () => api.post<{ success: boolean }>('/auth/logout').finally(clearStoredNativeToken),
  /**
   * Mint a persistent bearer token for the current session (mobile native
   * shell bridge). `expiresIn` is null: the token carries no `exp` claim and
   * lives until server-side revocation, exactly like the httpOnly cookie.
   */
  nativeToken: () =>
    api.post<{ token: string; refreshToken: string; expiresIn: number | null }>(
      '/auth/native-token',
    ),
  refreshNativeToken: (refreshToken: string) =>
    api.post<{ token: string; refreshToken: string; expiresIn: number | null }>(
      '/auth/native-token/refresh',
      {
        refreshToken,
      },
    ),
  registerPushToken: (token: string, platform: 'ios' | 'android' | 'web') =>
    api.post<{ success: boolean }>('/auth/push-token', { token, platform }),
  me: () => api.get<CurrentUser>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ success: boolean }>('/auth/change-password', { currentPassword, newPassword }),
  forgotPassword: (email: string) =>
    api.post<{
      success: boolean;
      message: string;
      adminEmail: string | null;
      adminName: string | null;
    }>('/auth/forgot-password', { email }),
  /** Keep the current password instead of setting a new one (clears mustChangePassword). */
  keepPassword: () => api.post<{ success: boolean }>('/auth/keep-password'),
};

// ── Dashboard ──
export interface DashboardSummary {
  totalEmployees: number;
  activeClockIns: number;
  totalHoursToday: number;
  attendanceRate: number;
  shifts: {
    scheduled: number;
    active: number;
    completed: number;
    cancelled: number;
    no_show: number;
  };
  date: string;
}

export interface DepartmentPerformance {
  department: string;
  totalEmployees: number;
  clockedIn: number;
  hoursToday: number;
  shiftsScheduled: number;
  shiftsCompleted: number;
  attendanceRate: number;
}

export interface AttendanceTrendPoint {
  date: string;
  attendanceRate: number;
  presentCount: number;
}

export interface OvertimeAlert {
  employeeEmail: string;
  employeeName: string | null;
  branch: string | null;
  department: string | null;
  type: 'daily_overtime' | 'monthly_projection';
  severity: 'warning' | 'critical';
  totalHours: number;
  overtimeHours: number;
  threshold: number;
  message: string;
}

export interface OvertimeForecastPoint {
  date: string;
  totalHours: number;
  overtimeHours: number;
  employeeCount: number;
  isProjected: boolean;
}

export interface OvertimeForecastSummary {
  avgDailyOvertime: number;
  avgDailyHours: number;
  projectedWeeklyOvertime: number;
  dailyThreshold: number;
}

/** Per-employee row returned by GET /dashboard/attendance-detail (KPI drill-down). */
export interface AttendanceDetailEmployee {
  employeeId: string;
  name: string;
  email: string;
  position: string | null;
  branch: string;
  department: string;
  /** Right now: active session vs none. */
  status: 'clocked_in' | 'not_clocked_in';
  /** Has any time entry today (active or completed). */
  presentToday: boolean;
  /** Start of the current active session (ISO), null when not clocked in now. */
  clockIn: string | null;
  /** Earliest clock-in today regardless of status (ISO), null when absent. */
  firstClockIn: string | null;
  /** Latest clock-out today (ISO), null when still clocked in or absent. */
  clockOut: string | null;
  /** Sum of completed hours today. */
  hoursToday: number;
}

export interface AttendanceDetailSummary {
  totalEmployees: number;
  clockedInNow: number;
  presentTodayCount: number;
  notClockedInCount: number;
  attendanceRate: number;
  totalHoursToday: number;
  date: string;
}

export interface AttendanceDetailResponse {
  summary: AttendanceDetailSummary;
  employees: AttendanceDetailEmployee[];
}

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary'),
  /** Per-employee clock-in drill-down backing the dashboard KPI detail modal. */
  attendanceDetail: () => api.get<AttendanceDetailResponse>('/dashboard/attendance-detail'),
  hoursTrend: (days = 14) =>
    api.get<{ trend: { date: string; hours: number }[] }>(`/dashboard/hours-trend?days=${days}`),
  branchDistribution: () =>
    api.get<{ distribution: { branch: string; count: number }[] }>(
      '/dashboard/branch-distribution',
    ),
  departmentDistribution: () =>
    api.get<{ distribution: { department: string; count: number }[] }>(
      '/dashboard/department-distribution',
    ),
  departmentPerformance: () =>
    api.get<{ departments: DepartmentPerformance[] }>('/dashboard/department-performance'),
  recentActivity: (limit = 20) =>
    api.get<{ activity: Array<Record<string, unknown>> }>(
      `/dashboard/recent-activity?limit=${limit}`,
    ),
  attendanceTrend: (days = 14) =>
    api.get<{ trend: AttendanceTrendPoint[]; totalEmployees: number }>(
      `/dashboard/attendance-trend?days=${days}`,
    ),
  overtimeAlerts: (days = 7) =>
    api.get<{
      alerts: OvertimeAlert[];
      thresholds: { daily: number; monthly: number; useMonthly: boolean };
      periodDays: number;
    }>(`/dashboard/overtime-alerts?days=${days}`),
  overtimeForecast: () =>
    api.get<{ forecast: OvertimeForecastPoint[]; summary: OvertimeForecastSummary }>(
      '/dashboard/overtime-forecast',
    ),
};

// ── Employees ──
export interface Employee {
  id: string;
  firstName: string;
  surname: string;
  email: string;
  position: string | null;
  role: string;
  status: string;
  branch: string;
  department: string;
  employeeNumber: string | null;
  phone: string | null;
  hireDate: string | null;
  /** Hourly rate (ZAR) used by the Cost-of-Late-Coming report. */
  hourlyRate?: number | null;
  managerId: string | null;
  geofenceId: string | null;
  geofenceIds?: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  geofence?: { id: string; name: string } | null;
  employeeGeofences?: Array<{ geofence: { id: string; name: string } }>;
  manager?: {
    id: string;
    firstName: string;
    surname: string;
    role?: string;
    branch?: string;
  } | null;
  /** Present on list responses: false = employee is visible in Workforce but has no login account. */
  hasLoginAccount?: boolean;
}

export interface ManagerOption {
  id: string;
  firstName: string;
  surname: string;
  email: string;
  role: string;
  branch: string;
  department: string;
  position: string | null;
}

/** Per-row error returned by the bulk import endpoint. `row` is the 1-based position in the submitted rows array. */
export interface BulkImportError {
  row: number;
  message: string;
}

/** Response payload for POST /employees/bulk. */
export interface BulkImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: BulkImportError[];
}

export const employeeApi = {
  list: (
    params: {
      search?: string;
      branch?: string;
      department?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.branch) qs.set('branch', params.branch);
    if (params.department) qs.set('department', params.department);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    return api.get<{ items: Employee[]; total: number }>(`/employees?${qs.toString()}`);
  },
  get: (id: string) => api.get<Employee>(`/employees/${id}`),
  create: (data: Partial<Employee>) => api.post<Employee>('/employees', data),
  update: (id: string, data: Partial<Employee>) => api.put<Employee>(`/employees/${id}`, data),
  remove: (id: string) => api.delete<{ success: boolean }>(`/employees/${id}`),
  resetPassword: (id: string) =>
    api.post<{ success: boolean; message: string }>(`/employees/${id}/reset-password`),
  /** Reactivate a terminated employee (admin/manager). */
  reactivate: (id: string) =>
    api.post<{ success: boolean; message: string; employee: Employee }>(
      `/employees/${id}/reactivate`,
    ),
  /** Admin only: list all active manager/admin employees available for assignment. */
  listManagers: () => api.get<{ managers: ManagerOption[] }>('/employees/managers'),
  /** Bulk onboarding: import many employees at once (CSV-parsed on the client). */
  bulkCreate: (rows: Record<string, unknown>[], companyProfileId?: string) =>
    api.post<BulkImportResult>('/employees/bulk', {
      rows,
      ...(companyProfileId ? { companyProfileId } : {}),
    }),
};

// ── Shifts ──
export interface Shift {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  shiftType: string;
  employeeId: string | null;
  employeeEmail: string | null;
  employeeName: string | null;
  branch: string | null;
  department: string | null;
  location: string | null;
  notes: string | null;
  employee?: { id: string; firstName: string; surname: string; email: string } | null;
}

export interface BulkShiftResult {
  success: boolean;
  created: number;
  skipped: number;
  skippedDetails: Array<{
    employeeId: string;
    employeeName: string;
    date?: string;
    reason: string;
  }>;
  shiftIds: string[];
}

export const shiftApi = {
  list: (
    params: {
      date?: string;
      from?: string;
      to?: string;
      employeeId?: string;
      status?: string;
      branch?: string;
      limit?: number;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.date) qs.set('date', params.date);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.employeeId) qs.set('employeeId', params.employeeId);
    if (params.status) qs.set('status', params.status);
    if (params.branch) qs.set('branch', params.branch);
    if (params.limit) qs.set('limit', String(params.limit));
    return api.get<{ items: Shift[]; total: number }>(`/shifts?${qs.toString()}`);
  },
  create: (data: Record<string, unknown>) => api.post<Shift>('/shifts', data),
  update: (id: string, data: Record<string, unknown>) => api.put<Shift>(`/shifts/${id}`, data),
  remove: (id: string) => api.delete<{ success: boolean }>(`/shifts/${id}`),
  bulkCreate: (data: {
    employeeIds: string[];
    date: string;
    /** Optional end date (YYYY-MM-DD): creates one shift per employee for every day in [date, endDate]. */
    endDate?: string;
    startTime?: string;
    endTime?: string;
    shiftType?: string;
    location?: string;
    notes?: string;
    skipOverlaps?: boolean;
    weeklySchedule?: Record<
      string,
      { enabled?: boolean; startTime?: string; endTime?: string; shiftType?: string }
    >;
  }) => api.post<BulkShiftResult>('/shifts/bulk', data),
};

// ── Time Entries ──

export const timeEntryApi = {
  list: (
    params: {
      date?: string;
      from?: string;
      to?: string;
      employeeEmail?: string;
      status?: string;
      branch?: string;
      department?: string;
      limit?: number;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.date) qs.set('date', params.date);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.employeeEmail) qs.set('employeeEmail', params.employeeEmail);
    if (params.status) qs.set('status', params.status);
    if (params.branch) qs.set('branch', params.branch);
    if (params.department) qs.set('department', params.department);
    if (params.limit) qs.set('limit', String(params.limit));
    return api.get<{ items: TimeEntry[]; total: number }>(`/time-entries?${qs.toString()}`);
  },
  active: (employeeEmail?: string) => {
    const qs = employeeEmail ? `?employeeEmail=${encodeURIComponent(employeeEmail)}` : '';
    return api.get<{ active: TimeEntry | null }>(`/time-entries/active${qs}`);
  },
  clockIn: (
    latitude?: number,
    longitude?: number,
    employeeEmail?: string,
    justification?: string,
    offlineOpts?: { capturedAt?: number; idempotencyKey?: string },
  ) =>
    api.post<TimeEntry>(
      '/time-entries/clock-in',
      {
        latitude,
        longitude,
        employee_email: employeeEmail,
        justification,
        // Offline outbox replay: the server stamps the entry at capturedAt
        // within its bounded acceptance window (see punchOutbox.ts).
        ...(offlineOpts?.capturedAt
          ? { offline: true, capturedAt: new Date(offlineOpts.capturedAt).toISOString() }
          : {}),
      },
      {
        'Idempotency-Key': offlineOpts?.idempotencyKey ?? createIdempotencyKey('clock-in'),
      },
    ),
  clockOut: (
    breakMinutes?: number,
    latitude?: number,
    longitude?: number,
    employeeEmail?: string,
    offlineOpts?: { capturedAt?: number; idempotencyKey?: string },
  ) =>
    api.post<TimeEntry>(
      '/time-entries/clock-out',
      {
        breakMinutes,
        latitude,
        longitude,
        employee_email: employeeEmail,
        // Offline outbox replay (see punchOutbox.ts).
        ...(offlineOpts?.capturedAt
          ? { offline: true, capturedAt: new Date(offlineOpts.capturedAt).toISOString() }
          : {}),
      },
      {
        'Idempotency-Key': offlineOpts?.idempotencyKey ?? createIdempotencyKey('clock-out'),
      },
    ),
  manual: (data: import('../../contracts/index.js').ManualTimeEntryRequest) =>
    api.post<TimeEntry>('/time-entries/manual', data),
  bulkClockIn: (employeeEmails: string[], justification?: string) =>
    api.post<BulkClockInResponse>('/time-entries/bulk-clock-in', { employeeEmails, justification }),
  bulkClockOut: (employeeEmails: string[], breakMinutes?: number) =>
    api.post<BulkClockOutResponse>('/time-entries/bulk-clock-out', {
      employeeEmails,
      breakMinutes,
    }),
  remove: (id: string) => api.delete<{ success: boolean }>(`/time-entries/${id}`),
  /** Admin/Manager: edit an existing time entry (manual adjustment). */
  update: (id: string, data: UpdateTimeEntryRequest) =>
    api.put<TimeEntry>(`/time-entries/${id}`, data),
};

// ── Reports ──
export interface PayrollRow {
  employeeId: string;
  name: string;
  email: string;
  branch: string;
  department: string;
  position: string | null;
  employeeNumber: string | null;
  /** Hourly rate (ZAR) — null when not set on the employee profile. */
  hourlyRate?: number | null;
  daysWorked: number;
  ordinaryHours: number;
  dailyOvertimeHours: number;
  sundayOvertimeHours: number;
  holidayOvertimeHours: number;
  monthlyOvertimeHours: number;
  totalOvertimeHours: number;
  sundayWeightedOvertime: number;
  holidayWeightedOvertime: number;
  totalWeightedOvertime: number;
  totalHours: number;
}

// ── Cost of Late Coming (Feature #9) ──
export interface AttendanceCostDay {
  date: string;
  lateMinutes: number;
  earlyMinutes: number;
  randLost: number;
}

export interface AttendanceCostRow {
  employeeId: string;
  name: string;
  email: string;
  branch: string;
  department: string;
  position: string | null;
  employeeNumber: string | null;
  hourlyRate: number | null;
  lateMinutes: number;
  earlyMinutes: number;
  totalLostMinutes: number;
  hoursLost: number;
  randLost: number;
  days: AttendanceCostDay[];
}

export interface AttendanceCostResponse {
  from: string;
  to: string;
  currency: string;
  rows: AttendanceCostRow[];
  totals: { lateMinutes: number; earlyMinutes: number; hoursLost: number; randLost: number };
}

// ── Attendance Alerts — in-app Notification Centre (Feature #3) ──
export interface AttendanceAlert {
  id: string;
  type: 'late_clock_in' | 'early_clock_out' | 'no_show' | 'absence';
  severity: 'info' | 'warning' | 'critical';
  employeeEmail: string;
  employeeName: string;
  branch: string | null;
  department: string | null;
  date: string;
  message: string;
  minutes?: number;
}

export interface AttendanceAlertsResponse {
  days: number;
  graceMinutes: number;
  today: string;
  count: number;
  alerts: AttendanceAlert[];
}

export const reportApi = {
  payroll: (
    params: {
      from?: string;
      to?: string;
      branch?: string;
      department?: string;
      employeeEmail?: string;
      employeeId?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.branch) qs.set('branch', params.branch);
    if (params.department) qs.set('department', params.department);
    if (params.employeeEmail) qs.set('employeeEmail', params.employeeEmail);
    if (params.employeeId) qs.set('employeeId', params.employeeId);
    return api.get<{
      from: string;
      to: string;
      rows: PayrollRow[];
      settings: Record<string, unknown>;
    }>(`/reports/payroll?${qs.toString()}`);
  },
  attendance: (from: string, to: string) =>
    api.get<{ entries: Array<Record<string, unknown>> }>(
      `/reports/attendance?from=${from}&to=${to}`,
    ),
  /** Cost of Late Coming: hours + Rand lost per employee for the range. */
  attendanceCost: (params: {
    from: string;
    to: string;
    branch?: string;
    department?: string;
    employeeEmail?: string;
  }) => {
    const qs = new URLSearchParams({ from: params.from, to: params.to });
    if (params.branch) qs.set('branch', params.branch);
    if (params.department) qs.set('department', params.department);
    if (params.employeeEmail) qs.set('employeeEmail', params.employeeEmail);
    return api.get<AttendanceCostResponse>(`/reports/attendance-cost?${qs.toString()}`);
  },
  /** Manager notification-centre feed: late-ins, early-outs, no-shows, absences. */
  attendanceAlerts: (days = 7, grace = 5) =>
    api.get<AttendanceAlertsResponse>(`/reports/attendance-alerts?days=${days}&grace=${grace}`),
  createPayrollSnapshot: (from: string, to: string) =>
    api.post<{ success: boolean; snapshots: number; from: string; to: string }>(
      '/reports/payroll/snapshot',
      { from, to },
    ),
  listPayrollSnapshots: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return api.get<{ snapshots: Array<Record<string, unknown>> }>(
      `/reports/payroll/snapshots?${qs.toString()}`,
    );
  },
};

// ── Settings ──
export interface CompanySettings {
  id: string;
  ordinaryHoursPerDay: number;
  overtimeThresholdHours: number;
  workDays: string[];
  useMonthlyOvertimeThreshold: boolean;
  monthlyOvertimeThresholdHours: number;
  sundayOvertimeEnabled: boolean;
  sundayOvertimeMultiplier: number;
  publicHolidayOvertimeEnabled: boolean;
  publicHolidayOvertimeMultiplier: number;
  publicHolidays: string[];
  defaultWorkingStartTime: string;
  defaultWorkingEndTime: string;
  defaultWorkingDays: string[];
}

export interface Geofence {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
  workingStartTime: string;
  workingEndTime: string;
  workingDays: string[];
}

export const settingsApi = {
  getSettings: () => api.get<{ settings: CompanySettings | null }>('/settings/settings'),
  updateSettings: (data: Partial<CompanySettings>) =>
    api.put<{ settings: CompanySettings }>('/settings/settings', data),
  listGeofences: () => api.get<{ geofences: Geofence[] }>('/settings/geofences'),
  getMyGeofences: () =>
    api.get<{
      employee: {
        id: string;
        branch: string;
        department: string;
        geofenceId: string | null;
        geofenceIds?: string[];
      } | null;
      geofences: Geofence[];
    }>('/settings/geofences/my'),
  createGeofence: (data: Partial<Geofence>) =>
    api.post<{ geofence: Geofence }>('/settings/geofences', data),
  updateGeofence: (id: string, data: Partial<Geofence>) =>
    api.put<{ geofence: Geofence }>(`/settings/geofences/${id}`, data),
  deleteGeofence: (id: string) => api.delete<{ success: boolean }>(`/settings/geofences/${id}`),
  // Holiday management
  getHolidays: () =>
    api.get<{ systemHolidays: string[]; companyHolidays: string[] }>('/settings/holidays'),
  addHoliday: (date: string, scope?: 'system' | 'company') =>
    api.post<{ success: boolean; date: string; scope: string }>('/settings/holidays', {
      date,
      scope,
    }),
  removeHoliday: (date: string, scope?: 'system' | 'company') =>
    api.delete<{ success: boolean; removed: string }>(
      `/settings/holidays/${date}${scope ? `?scope=${scope}` : ''}`,
    ),
};

// ── Audit ──
export interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  actorId: string;
  actorEmail: string;
  actorRole: string;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  justification: string | null;
  ipAddress: string | null;
  branch: string | null;
  department: string | null;
  createdAt: string;
  /** Name of the staff member affected by the audit event (resolved server-side). */
  staffName?: string | null;
  /** Full name of the user who performed the action (resolved server-side). */
  actorName?: string | null;
}

export const auditApi = {
  list: (
    params: {
      entity?: string;
      action?: string;
      limit?: number;
      offset?: number;
      cursor?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.entity) qs.set('entity', params.entity);
    if (params.action) qs.set('action', params.action);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.cursor) qs.set('cursor', params.cursor);
    return api.get<{
      items: AuditEntry[];
      total: number;
      nextCursor?: string | null;
      hasMore?: boolean;
    }>(`/audit?${qs.toString()}`);
  },
};

// ── Master ──
export interface PlatformStats {
  totalCompanies: number;
  activeCompanies: number;
  totalEmployees: number;
  totalUsers: number;
  activeClockIns: number;
  totalHoursToday: number;
}

export interface CompanyDetail {
  id: string;
  name: string;
  isActive: boolean;
  employeeCount: number;
  billingTier: string;
  phone: string;
  address: string;
  vatNumber: string;
  registrationNumber: string;
  primaryContactName: string;
  createdAt: string;
  ownerUserId?: string;
  adminEmail: string;
  adminFullName: string;
}

export interface MasterOperator {
  id: string;
  email: string;
  fullName: string;
  firstName: string;
  surname: string;
  role: string;
  createdAt: string;
}

export const masterApi = {
  getStats: () => api.get<PlatformStats>('/master/stats'),
  listCompanies: () => api.get<{ items: CompanyDetail[] }>('/master/companies'),
  onboardCompany: (
    data: Partial<CompanyDetail> & {
      adminEmail: string;
      adminFirstName: string;
      adminSurname: string;
    },
  ) => api.post<{ success: boolean; companyId: string }>('/master/companies', data),
  updateCompany: (
    id: string,
    data: Partial<CompanyDetail> & {
      adminEmail: string;
      adminFirstName: string;
      adminSurname: string;
    },
  ) =>
    api.put<{
      success: boolean;
      /** Present when the admin was reassigned to a brand-new account. */
      temporaryPassword?: string;
      adminEmail?: string;
      note?: string;
    }>(`/master/companies/${id}`, data),
  toggleCompany: (id: string) =>
    api.post<{ success: boolean; isActive: boolean; message: string }>(
      `/master/companies/${id}/toggle`,
    ),
  deleteCompany: (id: string) => api.delete<{ success: boolean }>(`/master/companies/${id}`),
  listOperators: () => api.get<{ items: MasterOperator[] }>('/master/operators'),
  createOperator: (data: Partial<MasterOperator>) =>
    api.post<{
      success: boolean;
      operator: MasterOperator;
      temporaryPassword: string;
      note: string;
    }>('/master/operators', data),
  resetOperatorPassword: (id: string) =>
    api.post<{ success: boolean; temporaryPassword: string; note: string }>(
      `/master/operators/${id}/reset-password`,
    ),
  impersonate: (id: string) =>
    api.post<{ success: boolean; token: string }>(`/master/impersonate/${id}`),
  stopImpersonation: () =>
    api.post<{ success: boolean; token: string }>('/master/stop-impersonation'),
  /** Launch a demo persona session (Master simulator). */
  demoLogin: (email: string) =>
    api.post<{ success: boolean; token: string; message: string }>('/master/demo-login', { email }),
};
