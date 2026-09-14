/**
 * Location working-hour helpers used by the auto clock-out job.
 *
 * The configured hours are wall-clock values in the business timezone. A
 * location's end time belongs to the configured working day; when end <= start
 * the workday crosses midnight (for example 22:00-06:00).
 */

import { addBusinessDays, businessNow, businessTimeToDate, timeStrToMinutes } from './timezone.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function dayName(dateStr: string): string {
  return DAY_NAMES[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
}

/**
 * Resolve the first configured location closing instant after clock-in.
 * Returns null for invalid hours or an empty working-day configuration.
 */
export function resolveLocationWorkingEnd(options: {
  clockIn: Date;
  timezone: string;
  workingStartTime: string;
  workingEndTime: string;
  workingDays: string[];
}): Date | null {
  const startMinutes = timeStrToMinutes(options.workingStartTime);
  const endMinutes = timeStrToMinutes(options.workingEndTime);
  if (startMinutes === null || endMinutes === null || options.workingDays.length === 0) return null;

  const now = businessNow(options.timezone, options.clockIn);
  const crossesMidnight = endMinutes <= startMinutes;

  // A clock-in before the end of an overnight window belongs to the previous
  // working day (e.g. Tuesday 02:00 is part of Monday 22:00–06:00).
  if (crossesMidnight && now.minutesOfDay < endMinutes) {
    const previousDate = addBusinessDays(now.dateStr, -1);
    if (options.workingDays.includes(dayName(previousDate))) {
      return businessTimeToDate(options.timezone, now.dateStr, endMinutes);
    }
  }

  // A clock-in on a configured closed day has no location-hours boundary.
  // The existing stale-entry safety close remains the final protection.
  if (!options.workingDays.includes(dayName(now.dateStr))) return null;

  const endDate = crossesMidnight ? addBusinessDays(now.dateStr, 1) : now.dateStr;
  const end = businessTimeToDate(options.timezone, endDate, endMinutes);
  return end.getTime() > options.clockIn.getTime() ? end : null;
}
