/**
 * API Client
 * ----------
 * Centralized fetch wrapper with credentials, error handling,
 * and typed helpers for all backend endpoints.
 */

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: { path: string; message: string }[];

  constructor(message: string, status: number, code?: string, details?: { path: string; message: string }[]) {
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
export type SessionErrorCode = 'COMPANY_SUSPENDED' | 'EMPLOYEE_TERMINATED' | 'ROLE_REVOKED' | 'UNAUTHENTICATED';
type SessionHandler = (code: SessionErrorCode, message: string) => void;
let sessionHandler: SessionHandler | null = null;

// When true, UNAUTHENTICATED (401) errors are suppressed. This prevents the
// "Session ended" banner from appearing after a voluntary sign-out, where
// in-flight requests or SSE reconnects may still return 401.
let suppressUnauthenticated = false;

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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
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
      notifySessionError('UNAUTHENTICATED', errorMsg);
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
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ── Auth ──
export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  companyProfileId: string | null;
  companyProfile?: { id: string; name: string } | null;
  branch?: string | null;
  department?: string | null;
  position?: string | null;
  employeeId?: string | null;
  /** Human-readable staff number for display (e.g. on the staff dashboard). */
  employeeNumber?: string | null;
  originalRole?: string | null;
  /** True when the account is still on the default password — user must change it. */
  mustChangePassword?: boolean;
  /** Set during a Master demo session — the email of the persona being simulated. */
  demoEmail?: string | null;
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ user: CurrentUser; token: string }>('/auth/login', { email, password }),
  logout: () => api.post<{ success: boolean }>('/auth/logout'),
  me: () => api.get<CurrentUser>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ success: boolean }>('/auth/change-password', { currentPassword, newPassword }),
  forgotPassword: (email: string) =>
    api.post<{ success: boolean; message: string; adminEmail: string | null; adminName: string | null }>(
      '/auth/forgot-password',
      { email },
    ),
  /** Keep the current password instead of setting a new one (clears mustChangePassword). */
  keepPassword: () => api.post<{ success: boolean }>('/auth/keep-password'),
};

// ── Dashboard ──
export interface DashboardSummary {
  totalEmployees: number;
  activeClockIns: number;
  totalHoursToday: number;
  attendanceRate: number;
  shifts: { scheduled: number; active: number; completed: number; cancelled: number; no_show: number };
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

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary'),
  hoursTrend: (days = 14) => api.get<{ trend: { date: string; hours: number }[] }>(`/dashboard/hours-trend?days=${days}`),
  branchDistribution: () => api.get<{ distribution: { branch: string; count: number }[] }>('/dashboard/branch-distribution'),
  departmentDistribution: () => api.get<{ distribution: { department: string; count: number }[] }>('/dashboard/department-distribution'),
  departmentPerformance: () => api.get<{ departments: DepartmentPerformance[] }>('/dashboard/department-performance'),
  recentActivity: (limit = 20) =>
    api.get<{ activity: Array<Record<string, unknown>> }>(`/dashboard/recent-activity?limit=${limit}`),
  attendanceTrend: (days = 14) =>
    api.get<{ trend: AttendanceTrendPoint[]; totalEmployees: number }>(`/dashboard/attendance-trend?days=${days}`),
  overtimeAlerts: (days = 7) =>
    api.get<{
      alerts: OvertimeAlert[];
      thresholds: { daily: number; monthly: number; useMonthly: boolean };
      periodDays: number;
    }>(`/dashboard/overtime-alerts?days=${days}`),
  overtimeForecast: () =>
    api.get<{ forecast: OvertimeForecastPoint[]; summary: OvertimeForecastSummary }>('/dashboard/overtime-forecast'),
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
  managerId: string | null;
  geofenceId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  geofence?: { id: string; name: string } | null;
  manager?: { id: string; firstName: string; surname: string; role?: string; branch?: string } | null;
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

export const employeeApi = {
  list: (params: { search?: string; branch?: string; department?: string; limit?: number; offset?: number } = {}) => {
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
    api.post<{ success: boolean; message: string; employee: Employee }>(`/employees/${id}/reactivate`),
  /** Admin only: list all active manager/admin employees available for assignment. */
  listManagers: () => api.get<{ managers: ManagerOption[] }>('/employees/managers'),
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
  skippedDetails: Array<{ employeeId: string; employeeName: string; reason: string }>;
  shiftIds: string[];
}

export const shiftApi = {
  list: (params: { date?: string; from?: string; to?: string; employeeId?: string; status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.date) qs.set('date', params.date);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.employeeId) qs.set('employeeId', params.employeeId);
    if (params.status) qs.set('status', params.status);
    if (params.limit) qs.set('limit', String(params.limit));
    return api.get<{ items: Shift[]; total: number }>(`/shifts?${qs.toString()}`);
  },
  create: (data: Record<string, unknown>) => api.post<Shift>('/shifts', data),
  update: (id: string, data: Record<string, unknown>) => api.put<Shift>(`/shifts/${id}`, data),
  remove: (id: string) => api.delete<{ success: boolean }>(`/shifts/${id}`),
  bulkCreate: (data: {
    employeeIds: string[];
    date: string;
    startTime?: string;
    endTime?: string;
    shiftType?: string;
    location?: string;
    notes?: string;
    skipOverlaps?: boolean;
  }) => api.post<BulkShiftResult>('/shifts/bulk', data),
};

// ── Time Entries ──
export interface TimeEntry {
  id: string;
  employeeId: string | null;
  employeeEmail: string;
  employeeName: string | null;
  branch: string | null;
  department: string | null;
  clockIn: string;
  clockOut: string | null;
  date: string;
  totalHours: number | null;
  status: string;
  breakMinutes: number | null;
  isManualOverride: boolean;
  geofenceName: string | null;
}

export const timeEntryApi = {
  list: (params: { date?: string; from?: string; to?: string; employeeEmail?: string; status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.date) qs.set('date', params.date);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.employeeEmail) qs.set('employeeEmail', params.employeeEmail);
    if (params.status) qs.set('status', params.status);
    if (params.limit) qs.set('limit', String(params.limit));
    return api.get<{ items: TimeEntry[]; total: number }>(`/time-entries?${qs.toString()}`);
  },
  active: (employeeEmail?: string) => {
    const qs = employeeEmail ? `?employeeEmail=${encodeURIComponent(employeeEmail)}` : '';
    return api.get<{ active: TimeEntry | null }>(`/time-entries/active${qs}`);
  },
  clockIn: (latitude?: number, longitude?: number, employeeEmail?: string, justification?: string) =>
    api.post<TimeEntry>('/time-entries/clock-in', {
      latitude,
      longitude,
      employee_email: employeeEmail,
      justification,
    }),
  clockOut: (breakMinutes?: number, latitude?: number, longitude?: number, employeeEmail?: string) =>
    api.post<TimeEntry>('/time-entries/clock-out', {
      breakMinutes,
      latitude,
      longitude,
      employee_email: employeeEmail,
    }),
  manual: (data: Record<string, unknown>) => api.post<TimeEntry>('/time-entries/manual', data),
  remove: (id: string) => api.delete<{ success: boolean }>(`/time-entries/${id}`),
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

export const reportApi = {
  payroll: (params: { from?: string; to?: string; branch?: string; department?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.branch) qs.set('branch', params.branch);
    if (params.department) qs.set('department', params.department);
    return api.get<{ from: string; to: string; rows: PayrollRow[]; settings: Record<string, unknown> }>(
      `/reports/payroll?${qs.toString()}`,
    );
  },
  attendance: (from: string, to: string) =>
    api.get<{ entries: Array<Record<string, unknown>> }>(`/reports/attendance?from=${from}&to=${to}`),
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
}

export interface Geofence {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
}

export const settingsApi = {
  getSettings: () => api.get<{ settings: CompanySettings | null }>('/settings/settings'),
  updateSettings: (data: Partial<CompanySettings>) => api.put<{ settings: CompanySettings }>('/settings/settings', data),
  listGeofences: () => api.get<{ geofences: Geofence[] }>('/settings/geofences'),
  createGeofence: (data: Partial<Geofence>) => api.post<{ geofence: Geofence }>('/settings/geofences', data),
  updateGeofence: (id: string, data: Partial<Geofence>) => api.put<{ geofence: Geofence }>(`/settings/geofences/${id}`, data),
  deleteGeofence: (id: string) => api.delete<{ success: boolean }>(`/settings/geofences/${id}`),
  // Holiday management
  getHolidays: () => api.get<{ systemHolidays: string[]; companyHolidays: string[] }>('/settings/holidays'),
  addHoliday: (date: string, scope?: 'system' | 'company') =>
    api.post<{ success: boolean; date: string; scope: string }>('/settings/holidays', { date, scope }),
  removeHoliday: (date: string, scope?: 'system' | 'company') =>
    api.delete<{ success: boolean; removed: string }>(`/settings/holidays/${date}${scope ? `?scope=${scope}` : ''}`),
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
  list: (params: { entity?: string; action?: string; limit?: number; offset?: number; cursor?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.entity) qs.set('entity', params.entity);
    if (params.action) qs.set('action', params.action);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.cursor) qs.set('cursor', params.cursor);
    return api.get<{ items: AuditEntry[]; total: number; nextCursor?: string | null; hasMore?: boolean }>(`/audit?${qs.toString()}`);
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
  onboardCompany: (data: Partial<CompanyDetail> & { adminEmail: string; adminFirstName: string; adminSurname: string }) =>
    api.post<{ success: boolean; companyId: string }>('/master/companies', data),
  updateCompany: (id: string, data: Partial<CompanyDetail> & { adminEmail: string; adminFirstName: string; adminSurname: string }) =>
    api.put<{
      success: boolean;
      /** Present when the admin was reassigned to a brand-new account. */
      temporaryPassword?: string;
      adminEmail?: string;
      note?: string;
    }>(`/master/companies/${id}`, data),
  toggleCompany: (id: string) => api.post<{ success: boolean; isActive: boolean; message: string }>(`/master/companies/${id}/toggle`),
  deleteCompany: (id: string) => api.delete<{ success: boolean }>(`/master/companies/${id}`),
  listOperators: () => api.get<{ items: MasterOperator[] }>('/master/operators'),
  createOperator: (data: Partial<MasterOperator>) =>
    api.post<{ success: boolean; operator: MasterOperator; temporaryPassword: string; note: string }>('/master/operators', data),
  resetOperatorPassword: (id: string) =>
    api.post<{ success: boolean; temporaryPassword: string; note: string }>(`/master/operators/${id}/reset-password`),
  impersonate: (id: string) => api.post<{ success: boolean; token: string }>(`/master/impersonate/${id}`),
  stopImpersonation: () => api.post<{ success: boolean; token: string }>('/master/stop-impersonation'),
  /** Launch a demo persona session (Master simulator). */
  demoLogin: (email: string) => api.post<{ success: boolean; token: string; message: string }>('/master/demo-login', { email }),
};
