/**
 * Exact persisted attendance duration rules.
 *
 * TimeEntry.totalMinutes is the canonical persisted duration for completed
 * entries. totalHours remains a compatibility representation at the API
 * boundary while the expand-and-contract migration is in progress.
 */

export const MINUTES_PER_HOUR = 60;

/** Convert a non-negative minute count to the existing two-decimal hour shape. */
export function minutesToHours(minutes: number | null | undefined): number | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  return Math.round((Math.max(0, minutes) / MINUTES_PER_HOUR) * 100) / 100;
}

/** Convert legacy two-decimal persisted hours to the nearest whole minute. */
export function hoursToMinutes(hours: number | null | undefined): number | null {
  if (hours == null || !Number.isFinite(hours)) return null;
  return Math.max(0, Math.round(hours * MINUTES_PER_HOUR));
}

/**
 * Read a duration from the exact minute field and fall back to legacy hours
 * for rows that predate the controlled backfill.
 */
export function storedDurationHours(
  totalMinutes: number | null | undefined,
  legacyTotalHours: number | null | undefined,
): number {
  return minutesToHours(totalMinutes) ?? legacyTotalHours ?? 0;
}

/** Calculate payable whole minutes, clamping malformed/negative durations. */
export function calculateWorkedMinutes(clockIn: Date, clockOut: Date, breakMinutes = 0): number {
  const elapsedMinutes = (clockOut.getTime() - clockIn.getTime()) / 60_000;
  if (!Number.isFinite(elapsedMinutes)) return 0;

  const safeBreakMinutes = Number.isFinite(breakMinutes) ? Math.max(0, breakMinutes) : 0;
  return Math.max(0, Math.round(elapsedMinutes - safeBreakMinutes));
}

export interface WorkedDuration {
  totalMinutes: number;
  totalHours: number;
}

export function calculateWorkedDuration(
  clockIn: Date,
  clockOut: Date,
  breakMinutes = 0,
): WorkedDuration {
  const totalMinutes = calculateWorkedMinutes(clockIn, clockOut, breakMinutes);
  return {
    totalMinutes,
    totalHours: minutesToHours(totalMinutes) ?? 0,
  };
}

/** Existing API-compatible calculation, now derived from exact minutes. */
export function calculateWorkedHours(clockIn: Date, clockOut: Date, breakMinutes = 0): number {
  return calculateWorkedDuration(clockIn, clockOut, breakMinutes).totalHours;
}