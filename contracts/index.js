/**
 * TimeTrack wire-contract runtime constants.
 *
 * This file intentionally has no framework or server dependencies so it can
 * be consumed by Vite, the compiled API, native tooling, and tests.
 */

export const ROLE = Object.freeze({
  MASTER: 'master',
  ADMIN: 'admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
});

export const EMPLOYEE_STATUS = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  TERMINATED: 'terminated',
});

export const SHIFT_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
});

export const SHIFT_TYPE = Object.freeze({
  FULL_DAY: 'full_day',
  HALF_DAY: 'half_day',
  HOLIDAY: 'Holiday',
  LEAVE: 'Leave',
  SICK: 'Sick',
  PTO: 'PTO',
  UNPAID: 'Unpaid',
});

export const ATTENDANCE_STATUS = Object.freeze({
  ACTIVE: 'active',
  COMPLETED: 'completed',
});

export const ATTENDANCE_ACTION = Object.freeze({
  CLOCK_IN: 'clock_in',
  CLOCK_OUT: 'clock_out',
  FORCE_CLOCK_OUT: 'force_clock_out',
  MANUAL_CREATE: 'manual_create',
  MANUAL_ADJUST: 'manual_adjust',
  DELETE: 'delete',
});

export const API_ERROR_CODE = Object.freeze({
  ACCESS_DENIED: 'ACCESS_DENIED',
  ALREADY_CLOCKED_IN: 'ALREADY_CLOCKED_IN',
  AUTH_CHECK_UNAVAILABLE: 'AUTH_CHECK_UNAVAILABLE',
  BAD_GATEWAY: 'BAD_GATEWAY',
  BAD_REQUEST: 'BAD_REQUEST',
  BULK_ALL_SKIPPED: 'BULK_ALL_SKIPPED',
  COMPANY_SUSPENDED: 'COMPANY_SUSPENDED',
  CSRF_REJECTED: 'CSRF_REJECTED',
  CURRENT_PASSWORD_INCORRECT: 'CURRENT_PASSWORD_INCORRECT',
  DEFAULT_PASSWORD_RETAINED: 'DEFAULT_PASSWORD_RETAINED',
  DUPLICATE_RECORD: 'DUPLICATE_RECORD',
  EMPLOYEE_TERMINATED: 'EMPLOYEE_TERMINATED',
  GEOFENCE_VIOLATION: 'GEOFENCE_VIOLATION',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NO_ACTIVE_SESSION: 'NO_ACTIVE_SESSION',
  NOT_FOUND: 'NOT_FOUND',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  RATE_LIMITED: 'RATE_LIMITED',
  ROLE_REVOKED: 'ROLE_REVOKED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  SESSION_REVOKED: 'SESSION_REVOKED',
  SHIFT_OVERLAP: 'SHIFT_OVERLAP',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
});
