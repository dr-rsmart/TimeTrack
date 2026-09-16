/**
 * Attendance Cost Engine — Pure Logic Module
 * ===========================================
 * Quantifies the cost of late coming and early leaving in HOURS and RAND.
 *
 * Business rules (per feature request #9):
 *  - A clock-in AFTER the scheduled shift start = late minutes lost.
 *  - A clock-out BEFORE the scheduled shift end = early minutes lost.
 *  - Hours lost × employee hourly rate = Rand lost.
 *  - Shifts that cross midnight (e.g. 22:00–06:00) are supported: the end
 *    falls on the next calendar day.
 *  - Leave-type shifts (Holiday/Leave/Sick/PTO/Unpaid/Bereavement/…) never
 *    generate lateness — the employee was not expected to work.
 *  - Without a scheduled shift (or start/end time) there is nothing to be
 *    late against: the day yields zero lost minutes. (Company default hours
 *    are the notification/cron fallback, but cost attribution requires an
 *    explicit schedule so payroll disputes stay defensible.)
 *
 * All arithmetic is integer minutes; Decimal converts to Rand at the boundary.
 */

import Decimal from 'decimal.js';
import { normaliseLeaveType } from '../payroll.js';

/** Shift types that are NOT lateness-relevant (leave already covers the day). */
const NON_WORKING_SHIFT_TYPES = new Set(['half_day']);

export interface AttendanceCostInput {
  /** Scheduled shift start "HH:mm" (null when unscheduled). */
  shiftStart: string | null;
  /** Scheduled shift end "HH:mm" (null when unscheduled). */
  shiftEnd: string | null;
  /** Shift type string, e.g. "full_day", "Leave", "Sick". */
  shiftType: string | null | undefined;
  /** True when the shift ends on the day AFTER its date (crosses midnight). */
  crossesMidnight: boolean;
  /** Actual clock-in as minutes-of-day in the business timezone. */
  clockInMinutesOfDay: number;
  /** Actual clock-out as minutes-of-day (null while the entry is open). */
  clockOutMinutesOfDay: number | null;
  /** True when the clock-out happened on the following calendar day. */
  clockOutNextDay?: boolean;
}

export interface AttendanceCostResult {
  /** Minutes the employee clocked in after the scheduled start. */
  lateMinutes: number;
  /** Minutes the employee clocked out before the scheduled end. */
  earlyMinutes: number;
  /** lateMinutes + earlyMinutes. */
  totalLostMinutes: number;
}

/** Parse "HH:mm" into minutes-of-day; null for missing/malformed values. */
function parseTime(timeStr: string | null): number | null {
  if (!timeStr) return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(timeStr.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Compute late/early minutes for a single day. Pure and side-effect free —
 * route handlers supply wall-clock minutes already resolved in the business
 * timezone; this function only classifies.
 */
export function computeAttendanceCost(input: AttendanceCostInput): AttendanceCostResult {
  // Leave and half-day shifts never generate lateness/early-leave cost.
  const leaveType = normaliseLeaveType(input.shiftType);
  if (leaveType || (input.shiftType && NON_WORKING_SHIFT_TYPES.has(input.shiftType))) {
    return { lateMinutes: 0, earlyMinutes: 0, totalLostMinutes: 0 };
  }

  const start = parseTime(input.shiftStart);
  const end = parseTime(input.shiftEnd);

  let lateMinutes = 0;
  let earlyMinutes = 0;

  // Late clock-in: actual start after the scheduled start (same-day compare;
  // a clock-in on the NEXT day is treated as a full-day absence, not lateness
  // — the no-show cron owns that classification).
  if (start !== null && input.clockInMinutesOfDay > start) {
    lateMinutes = input.clockInMinutesOfDay - start;
  }

  // Early clock-out: actual out before the scheduled end. Midnight-crossing
  // shifts normalise the out-time onto the shift's day axis (+1440).
  if (end !== null && input.clockOutMinutesOfDay !== null) {
    const outOnShiftAxis = input.clockOutNextDay
      ? input.clockOutMinutesOfDay + 1440
      : input.clockOutMinutesOfDay;
    const endOnShiftAxis = input.crossesMidnight ? end + 1440 : end;
    if (outOnShiftAxis < endOnShiftAxis) {
      earlyMinutes = endOnShiftAxis - outOnShiftAxis;
    }
  }

  return { lateMinutes, earlyMinutes, totalLostMinutes: lateMinutes + earlyMinutes };
}

/**
 * Convert lost minutes to Rand using the employee's hourly rate.
 * Decimal keeps payroll-grade precision; result rounds to 2dp at the boundary.
 * A missing/zero rate yields 0 — hours lost are still reported.
 */
export function computeRandLost(
  totalLostMinutes: number,
  hourlyRate: number | string | null | undefined,
): number {
  if (hourlyRate === null || hourlyRate === undefined || totalLostMinutes <= 0) return 0;
  const rate = new Decimal(hourlyRate);
  if (rate.isZero()) return 0;
  const hours = new Decimal(totalLostMinutes).div(60);
  return parseFloat(hours.times(rate).toFixed(2));
}

/** Minutes → decimal hours, rounded to 2dp (report display convention). */
export function minutesToHours(minutes: number): number {
  return parseFloat(new Decimal(minutes).div(60).toFixed(2));
}
