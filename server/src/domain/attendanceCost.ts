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
 *  - Without a scheduled shift, the Cost-of-Late report measures against the
 *    clock-in location's working hours, then company default hours
 *    (resolveExpectedWindow). Manager late/early ALERTS do not: they require an
 *    assigned shift (computeShiftDeviation — Shift Presence Rule).
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
  /**
   * Company grace (minutes, CompanySettings.lateGraceMinutes). A deviation of
   * up to `graceMinutes` is ignored; beyond it the FULL deviation counts.
   * Default 0 = strict. Shared with the attendance-alerts feed.
   */
  graceMinutes?: number;
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

  const grace = Math.max(0, Math.floor(input.graceMinutes ?? 0));
  if (lateMinutes <= grace) lateMinutes = 0;
  if (earlyMinutes <= grace) earlyMinutes = 0;

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

/**
 * Effective late-penalty rate for the Cost-of-Late report.
 * Uses the explicit `latePenaltyRate` when set, otherwise falls back to the
 * employee's regular `hourlyRate`. Returns null when neither is present so
 * callers can show "—" while still reporting hours lost.
 */
export function resolveLatePenaltyRate(
  hourlyRate: Decimal | number | string | null | undefined,
  latePenaltyRate: Decimal | number | string | null | undefined,
): number | null {
  const chosen = latePenaltyRate ?? hourlyRate;
  if (chosen === null || chosen === undefined) return null;
  const n = Number(chosen);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ── Expected working window resolution ──
// Precedence: explicit scheduled shift (with times) → working hours of the
// location the employee clocked in at → company default working hours.
// Leave-type shifts are returned as-is so computeAttendanceCost zeroes them.

export interface WindowSchedule {
  days: string[];
  startTime: string;
  endTime: string;
}

export interface ExpectedWindow {
  start: string | null;
  end: string | null;
  shiftType: string | null;
  source: 'shift' | 'location' | 'company' | 'none';
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Day name for a YYYY-MM-DD business date (UTC-noon anchored). */
export function weekdayName(dateStr: string): string {
  return WEEKDAYS[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
}

export function resolveExpectedWindow(input: {
  dateStr: string;
  shift: { startTime: string | null; endTime: string | null; shiftType: string | null } | null;
  locationSchedules: WindowSchedule[];
  companySchedules: WindowSchedule[];
}): ExpectedWindow {
  const { shift } = input;
  if (shift) {
    const leave = normaliseLeaveType(shift.shiftType);
    if (leave || shift.shiftType === 'half_day') {
      return { start: null, end: null, shiftType: shift.shiftType, source: 'shift' };
    }
    if (shift.startTime && shift.endTime) {
      return {
        start: shift.startTime,
        end: shift.endTime,
        shiftType: shift.shiftType,
        source: 'shift',
      };
    }
  }
  const day = weekdayName(input.dateStr);
  const fromList = (list: WindowSchedule[]) => list.find((s) => s.days.includes(day)) ?? null;
  const loc = fromList(input.locationSchedules);
  if (loc) return { start: loc.startTime, end: loc.endTime, shiftType: null, source: 'location' };
  const co = fromList(input.companySchedules);
  if (co) return { start: co.startTime, end: co.endTime, shiftType: null, source: 'company' };
  return { start: null, end: null, shiftType: null, source: 'none' };
}

export interface ShiftDeviationInput {
  /** Business date of the worked day (YYYY-MM-DD). */
  dateStr: string;
  shift: {
    startTime: string | null;
    endTime: string | null;
    shiftType: string | null;
    status?: string | null;
  } | null;
  /** First clock-in as minutes-of-day in the business timezone. */
  clockInMinutesOfDay: number;
  /** Last clock-out in the business timezone; null while a session is still open. */
  clockOut: { dateStr: string; minutesOfDay: number } | null;
  /** CompanySettings.lateGraceMinutes. */
  graceMinutes: number;
}

export interface ShiftDeviation {
  lateMinutes: number;
  earlyMinutes: number;
  /** Shift start/end ("HH:mm") the deviation was measured against. */
  start: string;
  end: string | null;
}

const NO_DEVIATION_SHIFT_STATUSES = new Set(['cancelled', 'no_show']);

/**
 * Shift Presence Rule (manager attendance-alert feed + real-time manager push):
 * late/early deviation is measured ONLY against an explicitly assigned working
 * shift. Returns null (never Late or Early) when the employee has no shift that
 * day, the shift is cancelled or already marked no_show (the no-show alert
 * covers it), it is a leave/half-day shift, or it has no start/end time.
 * Unscheduled days are flexible hours: location/company hours stay a reminder
 * and auto clock-out fallback only.
 *
 * The Cost-of-Late report deliberately keeps the wider shift → location →
 * company window (resolveExpectedWindow) so payroll still sees time lost
 * against business hours on unscheduled days.
 */
export function computeShiftDeviation(input: ShiftDeviationInput): ShiftDeviation | null {
  const { shift } = input;
  if (!shift || (shift.status && NO_DEVIATION_SHIFT_STATUSES.has(shift.status))) return null;
  const window = resolveExpectedWindow({
    dateStr: input.dateStr,
    shift,
    locationSchedules: [],
    companySchedules: [],
  });
  if (window.source !== 'shift' || !window.start) return null;
  const startMin = parseTime(window.start);
  const endMin = parseTime(window.end);
  const cost = computeAttendanceCost({
    shiftStart: window.start,
    shiftEnd: window.end,
    shiftType: window.shiftType,
    crossesMidnight: startMin !== null && endMin !== null && endMin <= startMin,
    clockInMinutesOfDay: input.clockInMinutesOfDay,
    clockOutMinutesOfDay: input.clockOut ? input.clockOut.minutesOfDay : null,
    clockOutNextDay: input.clockOut !== null && input.clockOut.dateStr > input.dateStr,
    graceMinutes: input.graceMinutes,
  });
  return {
    lateMinutes: cost.lateMinutes,
    earlyMinutes: cost.earlyMinutes,
    start: window.start,
    end: window.end,
  };
}

/**
 * Flatten every location schedule assigned to an employee (legacy
 * Employee.geofence + EmployeeGeofence join rows). Used when there is no
 * clock-in yet to tell us WHICH location applies (reminders, absences).
 * Raw JSON is parsed by the injected parser so this module stays pure.
 */
export function collectEmployeeLocationSchedules(
  emp: {
    geofence?: { workingHoursSchedules: unknown } | null;
    employeeGeofences?: { geofence: { workingHoursSchedules: unknown } | null }[];
  },
  parse: (raw: unknown) => WindowSchedule[] = defaultParseSchedules,
): WindowSchedule[] {
  const raws: unknown[] = [];
  if (emp.geofence) raws.push(emp.geofence.workingHoursSchedules);
  for (const eg of emp.employeeGeofences ?? []) {
    if (eg.geofence) raws.push(eg.geofence.workingHoursSchedules);
  }
  return raws.flatMap((r) => parse(r));
}

function defaultParseSchedules(raw: unknown): WindowSchedule[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is WindowSchedule =>
      !!s &&
      typeof s === 'object' &&
      Array.isArray((s as WindowSchedule).days) &&
      typeof (s as WindowSchedule).startTime === 'string' &&
      typeof (s as WindowSchedule).endTime === 'string',
  );
}

/**
 * Collapse a day's punches into ONE attendance span: earliest clock-in and
 * latest clock-out. Mid-day breaks (out 12:00 / in 12:30) therefore never
 * register as early-leave + late-arrival. Returns null for an empty list.
 */
export function collapseDayPunches<T extends { clockIn: Date; clockOut: Date | null }>(
  entries: T[],
): { first: T; clockIn: Date; clockOut: Date | null } | null {
  if (entries.length === 0) return null;
  let first = entries[0];
  let lastOut: Date | null = null;
  for (const e of entries) {
    if (e.clockIn.getTime() < first.clockIn.getTime()) first = e;
    if (e.clockOut && (!lastOut || e.clockOut.getTime() > lastOut.getTime())) lastOut = e.clockOut;
  }
  return { first, clockIn: first.clockIn, clockOut: lastOut };
}

/** Minutes → decimal hours, rounded to 2dp (report display convention). */
export function minutesToHours(minutes: number): number {
  return parseFloat(new Decimal(minutes).div(60).toFixed(2));
}
