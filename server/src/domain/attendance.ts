/**
 * Attendance domain rules
 * ------------------------
 * Pure, dependency-free rules shared by HTTP handlers, background jobs, and
 * tests. Keeping these calculations outside route modules prevents clocking
 * behavior from drifting between self-service, proxy, native, and cron paths.
 */

import {
  ATTENDANCE_ACTION,
  ATTENDANCE_STATUS,
} from '../../../contracts/index.js';
import type { AttendanceAction, AttendanceStatus } from '../../../contracts/index.js';
import {
  calculateWorkedDuration,
  calculateWorkedHours,
  calculateWorkedMinutes,
  hoursToMinutes,
  minutesToHours,
  storedDurationHours,
} from './duration.js';

export { ATTENDANCE_ACTION, ATTENDANCE_STATUS };
export type { AttendanceAction, AttendanceStatus };
export {
  calculateWorkedDuration,
  calculateWorkedHours,
  calculateWorkedMinutes,
  hoursToMinutes,
  minutesToHours,
  storedDurationHours,
};

/**
 * Normalize an Idempotency-Key header without accepting unbounded input.
 * Keys are opaque to the domain; the server only needs a stable, bounded
 * identifier for safe retries.
 */
export function normalizeIdempotencyKey(value: string | undefined): string | null {
  if (!value) return null;
  const key = value.trim();
  if (key.length === 0 || key.length > 200) return null;
  return key;
}

/**
 * Scope a client key to the authenticated actor and mutation type. This keeps
 * the database key globally unique without allowing a client from one user to
 * replay another user's mutation if keys are ever reused accidentally.
 */
export function scopeIdempotencyKey(
  action: AttendanceAction,
  actorId: string,
  value: string | undefined,
): string | null {
  const key = normalizeIdempotencyKey(value);
  if (!key) return null;
  return `${action}:${actorId}:${key}`;
}

/** True when a time-entry transition is a supported attendance state change. */
export function isAttendanceStatus(value: string): value is AttendanceStatus {
  return value === ATTENDANCE_STATUS.ACTIVE || value === ATTENDANCE_STATUS.COMPLETED;
}