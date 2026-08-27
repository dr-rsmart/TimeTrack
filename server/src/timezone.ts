/**
 * Business-Timezone Helpers — Pure Logic Module
 * ==============================================
 * Timezone-safe date/time arithmetic for background jobs and stats.
 *
 * WHY: shift start times ("HH:mm") and DATE columns are wall-clock business
 * values. Comparing them against server-local time silently breaks when the
 * host moves timezone (container re-scheduling, region change). All cron and
 * "today" computations must go through these helpers with an explicit IANA
 * timezone (CRON_TIMEZONE env, default = process timezone).
 */

/** Resolve the configured business timezone (IANA name). */
export function getBusinessTimezone(): string {
  const configured = process.env.CRON_TIMEZONE?.trim();
  if (configured) return configured;
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface BusinessNow {
  /** YYYY-MM-DD in the business timezone. */
  dateStr: string;
  /** 0-23 hour in the business timezone. */
  hours: number;
  /** 0-59 minute in the business timezone. */
  minutes: number;
  /** Minutes since midnight in the business timezone. */
  minutesOfDay: number;
}

/** Decompose an instant into business-timezone wall-clock parts. */
export function businessNow(tz: string, at: Date = new Date()): BusinessNow {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;

  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  // Some engines emit hour "24" for midnight in hour12:false mode.
  const hours = parseInt(parts.hour, 10) % 24;
  const minutes = parseInt(parts.minute, 10);
  return { dateStr, hours, minutes, minutesOfDay: hours * 60 + minutes };
}

/** Parse "HH:mm" into minutes-of-day. Returns null for malformed input. */
export function timeStrToMinutes(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(timeStr.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Decide whether a shift that started at `startMinutes` on `shiftDateStr`
 * is now past its grace deadline (`graceMinutes` after start), given the
 * current business-timezone wall clock.
 *
 * Handles grace windows that cross midnight: a shift from the PREVIOUS day
 * whose deadline lands after 00:00 is still caught in the early hours of the
 * next day (via the `isPreviousDay` flag callers pass for yesterday rows).
 */
export function isPastGraceDeadline(opts: {
  nowMinutesOfDay: number;
  shiftStartMinutes: number;
  graceMinutes: number;
  /** true when the shift belongs to the previous business day. */
  isPreviousDay?: boolean;
}): boolean {
  const deadline = opts.shiftStartMinutes + opts.graceMinutes;

  if (!opts.isPreviousDay) {
    // Same-day comparison; deadlines beyond 24:00 cannot fire today.
    return deadline <= 1440 && opts.nowMinutesOfDay > deadline;
  }

  // Previous-day shift: its deadline has already shifted past midnight when
  // deadline > 1440. Elapsed minutes since midnight = 1440 - deadline.
  if (deadline <= 1440) return true; // deadline was yesterday; definitely past
  return opts.nowMinutesOfDay > deadline - 1440;
}

/** Parse a YYYY-MM-DD business date string into UTC-midnight epoch millis. */
function dateStrToUtcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map((v) => parseInt(v, 10));
  return Date.UTC(y, m - 1, d);
}

/** Shift a YYYY-MM-DD date string by whole days (may be negative). */
export function addBusinessDays(dateStr: string, days: number): string {
  const shifted = new Date(dateStrToUtcMs(dateStr) + days * 86_400_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Decide whether a shift's scheduled end has been reached, given the current
 * business-timezone wall clock.
 *
 * A shift whose endTime is at or before its startTime (e.g. 22:00–06:00)
 * crosses midnight: its end falls on the next calendar day. Dates are plain
 * YYYY-MM-DD strings, which compare correctly lexicographically.
 */
export function isShiftEndReached(opts: {
  nowDateStr: string;
  nowMinutesOfDay: number;
  shiftDateStr: string;
  endMinutes: number;
  /** true when the shift ends on the day after its date. */
  crossesMidnight?: boolean;
}): boolean {
  const effectiveEndDateStr = opts.crossesMidnight
    ? addBusinessDays(opts.shiftDateStr, 1)
    : opts.shiftDateStr;
  if (opts.nowDateStr > effectiveEndDateStr) return true;
  if (opts.nowDateStr < effectiveEndDateStr) return false;
  return opts.nowMinutesOfDay >= opts.endMinutes;
}

/**
 * Convert a business-timezone date plus minutes-of-day into the exact UTC
 * instant of that wall-clock reading in `tz`.
 *
 * Iteratively discovers the zone offset via `businessNow`: two passes converge
 * for every IANA zone; extra passes guard DST transitions where the offset at
 * the initial guess differs from the offset at the answer. Used by cron jobs
 * to stamp exact scheduled end-times (e.g. shift-end auto clock-out) without
 * depending on the server's local timezone.
 */
export function businessTimeToDate(tz: string, dateStr: string, minutesOfDay: number): Date {
  const targetDateMs = dateStrToUtcMs(dateStr);
  // Initial guess: the reading interpreted as UTC.
  let guess = new Date(targetDateMs + minutesOfDay * 60_000);
  for (let i = 0; i < 4; i++) {
    const biz = businessNow(tz, guess);
    const deltaMs =
      targetDateMs - dateStrToUtcMs(biz.dateStr) + (minutesOfDay - biz.minutesOfDay) * 60_000;
    if (deltaMs === 0) break;
    guess = new Date(guess.getTime() + deltaMs);
  }
  return guess;
}
