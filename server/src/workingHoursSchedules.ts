/**
 * Working-hours schedules (migration 20)
 * --------------------------------------
 * Per-day working-hours slots shared by geofence "global working hours" and
 * company "default working hours". Each schedule is
 *   { days: ["Monday", ...], startTime: "HH:mm", endTime: "HH:mm" }
 * and a day may appear in only ONE schedule per parent (geofence/company) —
 * the UI grays out already-claimed days and the API rejects overlaps.
 *
 * An EMPTY list means "not explicitly configured": the cron working-end auto
 * clock-out must NOT fire (fixes the erroneous implicit-17:00 closes).
 */

export interface WorkingHoursSchedule {
  days: string[];
  startTime: string;
  endTime: string;
}

export const WORKING_DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Defensive parse of the JSONB column (never throws on malformed data). */
export function parseWorkingHoursSchedules(json: unknown): WorkingHoursSchedule[] {
  if (!Array.isArray(json)) return [];
  const out: WorkingHoursSchedule[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (
      !Array.isArray(raw.days) ||
      typeof raw.startTime !== 'string' ||
      typeof raw.endTime !== 'string'
    ) {
      continue;
    }
    const days = (raw.days as unknown[]).filter(
      (d): d is string =>
        typeof d === 'string' && (WORKING_DAY_NAMES as readonly string[]).includes(d),
    );
    if (days.length === 0) continue;
    if (!TIME_RE.test(raw.startTime) || !TIME_RE.test(raw.endTime)) continue;
    out.push({ days, startTime: raw.startTime, endTime: raw.endTime });
  }
  return out;
}

/**
 * Validate a schedule list. Returns an error message, or null when valid.
 * Rules: 1..7 schedules, valid day names, no day claimed twice, valid HH:mm.
 */
export function validateWorkingHoursSchedules(schedules: WorkingHoursSchedule[]): string | null {
  if (schedules.length > 7) return 'A maximum of 7 working-hours schedules is allowed.';
  const seen = new Set<string>();
  for (const schedule of schedules) {
    if (!Array.isArray(schedule.days) || schedule.days.length === 0) {
      return 'Each working-hours schedule must include at least one day.';
    }
    if (!TIME_RE.test(schedule.startTime) || !TIME_RE.test(schedule.endTime)) {
      return 'Working-hours start/end must be valid HH:mm times.';
    }
    for (const day of schedule.days) {
      if (!(WORKING_DAY_NAMES as readonly string[]).includes(day)) {
        return `Invalid working day: ${String(day)}.`;
      }
      if (seen.has(day)) {
        return `${day} is already covered by another working-hours schedule. Each day can only appear once.`;
      }
      seen.add(day);
    }
  }
  return null;
}

/** The schedules that cover the given day name (0 or 1 in valid data). */
export function schedulesForDay(
  schedules: WorkingHoursSchedule[],
  dayName: string,
): WorkingHoursSchedule[] {
  return schedules.filter((s) => s.days.includes(dayName));
}
