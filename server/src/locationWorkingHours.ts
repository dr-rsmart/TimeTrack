/**
 * Location working-hour helpers used by the auto clock-out job.
 *
 * The configured hours are wall-clock values in the business timezone. A
 * location's end time belongs to the configured working day; when end <= start
 * the workday crosses midnight (for example 22:00-06:00).
 *
 * Migration 20 adds MULTIPLE per-day schedules (e.g. Mon-Thu 08:00-17:00,
 * Fri 08:00-15:00). `resolveWorkingEndFromSchedules` returns the FIRST
 * configured closing instant after clock-in across all schedules; an empty
 * schedule list means "not explicitly configured" and yields null (no
 * automatic close — fixes the erroneous implicit-17:00 clock-outs).
 */

import { addBusinessDays, businessNow, businessTimeToDate, timeStrToMinutes } from './timezone.js';
import type { WorkingHoursSchedule } from './workingHoursSchedules.js';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function dayName(dateStr: string): string {
  return DAY_NAMES[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
}

/** Closing instant for ONE schedule after clock-in (null when not applicable). */
function endForSchedule(
  schedule: WorkingHoursSchedule,
  clockIn: Date,
  timezone: string,
): Date | null {
  const startMinutes = timeStrToMinutes(schedule.startTime);
  const endMinutes = timeStrToMinutes(schedule.endTime);
  if (startMinutes === null || endMinutes === null || schedule.days.length === 0) return null;

  const now = businessNow(timezone, clockIn);
  const crossesMidnight = endMinutes <= startMinutes;

  // A clock-in before the end of an overnight window belongs to the previous
  // working day (e.g. Tuesday 02:00 is part of Monday 22:00–06:00).
  if (crossesMidnight && now.minutesOfDay < endMinutes) {
    const previousDate = addBusinessDays(now.dateStr, -1);
    if (schedule.days.includes(dayName(previousDate))) {
      return businessTimeToDate(timezone, now.dateStr, endMinutes);
    }
  }

  // A clock-in on a configured closed day has no location-hours boundary.
  // The existing stale-entry safety close remains the final protection.
  if (!schedule.days.includes(dayName(now.dateStr))) return null;

  const endDate = crossesMidnight ? addBusinessDays(now.dateStr, 1) : now.dateStr;
  const end = businessTimeToDate(timezone, endDate, endMinutes);
  return end.getTime() > clockIn.getTime() ? end : null;
}

/**
 * Resolve the first configured closing instant after clock-in across ALL
 * schedules. Returns null when no schedule applies (or none are configured).
 */
export function resolveWorkingEndFromSchedules(options: {
  clockIn: Date;
  timezone: string;
  schedules: WorkingHoursSchedule[];
}): Date | null {
  let earliest: Date | null = null;
  for (const schedule of options.schedules) {
    const end = endForSchedule(schedule, options.clockIn, options.timezone);
    if (end && (!earliest || end.getTime() < earliest.getTime())) earliest = end;
  }
  return earliest;
}

/**
 * Legacy single-hours variant (kept for existing callers/tests). Delegates to
 * the schedule resolver with a one-element list.
 */
export function resolveLocationWorkingEnd(options: {
  clockIn: Date;
  timezone: string;
  workingStartTime: string;
  workingEndTime: string;
  workingDays: string[];
}): Date | null {
  return resolveWorkingEndFromSchedules({
    clockIn: options.clockIn,
    timezone: options.timezone,
    schedules: [
      {
        days: options.workingDays,
        startTime: options.workingStartTime,
        endTime: options.workingEndTime,
      },
    ],
  });
}
