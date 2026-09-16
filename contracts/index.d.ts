export type Role = 'master' | 'admin' | 'manager' | 'employee';
export type EmployeeStatus = 'active' | 'suspended' | 'terminated';
export type ShiftStatus = 'scheduled' | 'active' | 'completed' | 'cancelled' | 'no_show';
export type ShiftType = 'full_day' | 'half_day' | 'Holiday' | 'Leave' | 'Sick' | 'PTO' | 'Unpaid';
export type AttendanceStatus = 'active' | 'completed';
export type AttendanceAction =
  'clock_in' | 'clock_out' | 'force_clock_out' | 'manual_create' | 'manual_adjust' | 'delete';

export declare const ROLE: Readonly<{
  MASTER: 'master';
  ADMIN: 'admin';
  MANAGER: 'manager';
  EMPLOYEE: 'employee';
}>;

export declare const EMPLOYEE_STATUS: Readonly<{
  ACTIVE: 'active';
  SUSPENDED: 'suspended';
  TERMINATED: 'terminated';
}>;

export declare const SHIFT_STATUS: Readonly<{
  SCHEDULED: 'scheduled';
  ACTIVE: 'active';
  COMPLETED: 'completed';
  CANCELLED: 'cancelled';
  NO_SHOW: 'no_show';
}>;

export declare const SHIFT_TYPE: Readonly<{
  FULL_DAY: 'full_day';
  HALF_DAY: 'half_day';
  HOLIDAY: 'Holiday';
  LEAVE: 'Leave';
  SICK: 'Sick';
  PTO: 'PTO';
  UNPAID: 'Unpaid';
}>;

export declare const ATTENDANCE_STATUS: Readonly<{
  ACTIVE: 'active';
  COMPLETED: 'completed';
}>;

export declare const ATTENDANCE_ACTION: Readonly<{
  CLOCK_IN: 'clock_in';
  CLOCK_OUT: 'clock_out';
  FORCE_CLOCK_OUT: 'force_clock_out';
  MANUAL_CREATE: 'manual_create';
  MANUAL_ADJUST: 'manual_adjust';
  DELETE: 'delete';
}>;

export type ApiErrorCode =
  | 'ACCESS_DENIED'
  | 'ALREADY_CLOCKED_IN'
  | 'AUTH_CHECK_UNAVAILABLE'
  | 'BAD_GATEWAY'
  | 'BAD_REQUEST'
  | 'BULK_ALL_SKIPPED'
  | 'COMPANY_SUSPENDED'
  | 'CSRF_REJECTED'
  | 'CURRENT_PASSWORD_INCORRECT'
  | 'DEFAULT_PASSWORD_RETAINED'
  | 'DUPLICATE_RECORD'
  | 'EMPLOYEE_TERMINATED'
  | 'GEOFENCE_VIOLATION'
  | 'INTERNAL_ERROR'
  | 'NO_ACTIVE_SESSION'
  | 'NOT_FOUND'
  | 'OFFLINE_PUNCH_EXPIRED'
  | 'OUT_OF_SCOPE'
  | 'PASSWORD_CHANGED'
  | 'RATE_LIMITED'
  | 'ROLE_REVOKED'
  | 'SERVICE_UNAVAILABLE'
  | 'SESSION_REVOKED'
  | 'SHIFT_OVERLAP'
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'VERSION_CONFLICT';

export declare const API_ERROR_CODE: Readonly<Record<ApiErrorCode, ApiErrorCode>>;

export type SessionErrorCode =
  | 'COMPANY_SUSPENDED'
  | 'EMPLOYEE_TERMINATED'
  | 'ROLE_REVOKED'
  | 'UNAUTHENTICATED'
  | 'PASSWORD_CHANGED';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ApiErrorResponse {
  error: string;
  code?: ApiErrorCode | string;
  details?: Record<string, unknown> | ValidationIssue[];
  suggestions?: string[];
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  companyProfileId: string | null;
  companyProfile?: { id: string; name: string } | null;
  branch?: string | null;
  department?: string | null;
  position?: string | null;
  employeeId?: string | null;
  employeeNumber?: string | null;
  originalRole?: Role | null;
  mustChangePassword?: boolean;
  usingDefaultPassword?: boolean;
  demoEmail?: string | null;
  businessTimezone?: string;
}

export interface TimeEntry {
  id: string;
  employeeId: string | null;
  geofenceId?: string | null;
  employeeEmail: string;
  employeeName: string | null;
  branch: string | null;
  department: string | null;
  clockIn: string;
  clockOut: string | null;
  date: string;
  /** Exact persisted payable duration, populated during Phase 3 backfill. */
  totalMinutes?: number | null;
  totalHours: number | null;
  status: AttendanceStatus;
  breakMinutes: number | null;
  isManualOverride: boolean;
  isManuallyAdjusted: boolean;
  adjustedByName: string | null;
  adjustmentReason: string | null;
  geofenceName: string | null;
}

export interface ClockInRequest {
  latitude?: number;
  longitude?: number;
  employee_email?: string;
  justification?: string;
  /** Offline outbox replay: device capture instant (ISO-8601) of the punch. */
  capturedAt?: string;
  /** True when this punch was queued offline and replayed on reconnect. */
  offline?: boolean;
}

export interface ClockOutRequest {
  breakMinutes?: number;
  latitude?: number;
  longitude?: number;
  employee_email?: string;
  /** Offline outbox replay: device capture instant (ISO-8601) of the punch. */
  capturedAt?: string;
  /** True when this punch was queued offline and replayed on reconnect. */
  offline?: boolean;
}

export interface ManualTimeEntryRequest {
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  breakMinutes?: number | null;
  notes?: string | null;
}

export interface BulkClockInRequest {
  employeeEmails: string[];
  justification?: string;
}

export interface BulkClockOutRequest {
  employeeEmails: string[];
  breakMinutes?: number | null;
}

export interface BulkPunchSkipped {
  email: string;
  reason: string;
}

export interface BulkClockInResponse {
  success: boolean;
  clockedIn: Array<{ email: string; id: string; employeeName: string | null }>;
  skipped: BulkPunchSkipped[];
}

export interface BulkClockOutResponse {
  success: boolean;
  clockedOut: Array<{
    email: string;
    id: string;
    employeeName: string | null;
    totalHours: number | null;
  }>;
  skipped: BulkPunchSkipped[];
}

export interface UpdateTimeEntryRequest {
  date?: string;
  clockIn?: string;
  clockOut?: string;
  breakMinutes?: number | null;
  reason: string;
}

export interface DeleteResponse {
  success: boolean;
  deleted?: string;
}
