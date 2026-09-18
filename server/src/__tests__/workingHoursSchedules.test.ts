/**
 * Unit tests for the migration-20 working-hours schedules:
 * - parseWorkingHoursSchedules / validateWorkingHoursSchedules
 * - resolveWorkingEndFromSchedules (multi-slot, per-day, overnight windows)
 */
import { describe, it, expect } from 'vitest';
import {
  parseWorkingHoursSchedules,
  validateWorkingHoursSchedules,
  schedulesForDay,
} from '../workingHoursSchedules.js';
import {
  resolveWorkingEndFromSchedules,
  resolveLocationWorkingEnd,
} from '../locationWorkingHours.js';

const TZ = 'Africa/Johannesburg';

describe('parseWorkingHoursSchedules', () => {
  it('parses a valid JSONB array', () => {
    const parsed = parseWorkingHoursSchedules([
      { days: ['Monday', 'Friday'], startTime: '08:00', endTime: '17:00' },
    ]);
    expect(parsed).toEqual([{ days: ['Monday', 'Friday'], startTime: '08:00', endTime: '17:00' }]);
  });

  it('drops malformed entries instead of throwing', () => {
    expect(
      parseWorkingHoursSchedules([
        null,
        { days: [], startTime: '08:00', endTime: '17:00' },
        { days: ['Funday'], startTime: '08:00', endTime: '17:00' },
        { days: ['Monday'], startTime: '8am', endTime: '17:00' },
        { days: ['Monday'], startTime: '08:00', endTime: '17:00' },
      ]),
    ).toEqual([{ days: ['Monday'], startTime: '08:00', endTime: '17:00' }]);
  });

  it('returns [] for non-array JSON', () => {
    expect(parseWorkingHoursSchedules(null)).toEqual([]);
    expect(parseWorkingHoursSchedules(undefined)).toEqual([]);
    expect(parseWorkingHoursSchedules({})).toEqual([]);
  });
});

describe('validateWorkingHoursSchedules', () => {
  it('accepts disjoint day groups', () => {
    expect(
      validateWorkingHoursSchedules([
        {
          days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
          startTime: '08:00',
          endTime: '17:00',
        },
        { days: ['Friday'], startTime: '08:00', endTime: '15:00' },
        { days: ['Saturday'], startTime: '08:00', endTime: '14:00' },
      ]),
    ).toBeNull();
  });

  it('rejects a day claimed by two schedules', () => {
    const err = validateWorkingHoursSchedules([
      { days: ['Monday', 'Friday'], startTime: '08:00', endTime: '17:00' },
      { days: ['Friday'], startTime: '08:00', endTime: '15:00' },
    ]);
    expect(err).toContain('Friday');
  });

  it('rejects empty day lists and invalid times', () => {
    expect(
      validateWorkingHoursSchedules([{ days: [], startTime: '08:00', endTime: '17:00' }]),
    ).toContain('at least one day');
    expect(
      validateWorkingHoursSchedules([{ days: ['Monday'], startTime: '25:00', endTime: '17:00' }]),
    ).toContain('HH:mm');
  });
});

describe('schedulesForDay', () => {
  it('finds the covering schedule', () => {
    const schedules = [
      { days: ['Monday', 'Thursday'], startTime: '08:00', endTime: '17:00' },
      { days: ['Friday'], startTime: '08:00', endTime: '15:00' },
    ];
    expect(schedulesForDay(schedules, 'Friday')).toEqual([schedules[1]]);
    expect(schedulesForDay(schedules, 'Sunday')).toEqual([]);
  });
});

describe('resolveWorkingEndFromSchedules', () => {
  it('returns null when NO schedule is explicitly configured', () => {
    // 2026-09-15 is a Tuesday.
    const clockIn = new Date('2026-09-15T07:00:00Z');
    expect(resolveWorkingEndFromSchedules({ clockIn, timezone: TZ, schedules: [] })).toBeNull();
  });

  it('applies the per-day schedule matching the clock-in day', () => {
    // Friday 2026-09-11, clock-in 06:00 UTC (08:00 SAST) → Friday 15:00 close.
    const clockIn = new Date('2026-09-11T06:00:00Z');
    const end = resolveWorkingEndFromSchedules({
      clockIn,
      timezone: TZ,
      schedules: [
        {
          days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
          startTime: '08:00',
          endTime: '17:00',
        },
        { days: ['Friday'], startTime: '08:00', endTime: '15:00' },
      ],
    });
    expect(end?.toISOString()).toBe('2026-09-11T13:00:00.000Z'); // 15:00 SAST
  });

  it('does not close at 17:00 on a day whose schedule ends at 20:00', () => {
    // Stakeholder scenario: knock-off is 20:00 — no close may fire at 17:00.
    const clockIn = new Date('2026-09-15T07:00:00Z'); // Tue 09:00 SAST
    const end = resolveWorkingEndFromSchedules({
      clockIn,
      timezone: TZ,
      schedules: [{ days: ['Tuesday'], startTime: '09:00', endTime: '20:00' }],
    });
    expect(end?.toISOString()).toBe('2026-09-15T18:00:00.000Z'); // 20:00 SAST
  });

  it('skips days that are not configured (closed days)', () => {
    const clockIn = new Date('2026-09-13T07:00:00Z'); // Sunday
    expect(
      resolveWorkingEndFromSchedules({
        clockIn,
        timezone: TZ,
        schedules: [{ days: ['Monday'], startTime: '08:00', endTime: '17:00' }],
      }),
    ).toBeNull();
  });

  it('supports overnight windows (22:00-06:00)', () => {
    // Monday 2026-09-14 21:00 UTC (23:00 SAST) → close Tuesday 06:00 SAST.
    const clockIn = new Date('2026-09-14T21:00:00Z');
    const end = resolveWorkingEndFromSchedules({
      clockIn,
      timezone: TZ,
      schedules: [{ days: ['Monday'], startTime: '22:00', endTime: '06:00' }],
    });
    expect(end?.toISOString()).toBe('2026-09-15T04:00:00.000Z');
  });

  it('legacy single-hours resolver matches the schedule resolver', () => {
    const clockIn = new Date('2026-09-15T07:00:00Z');
    const legacy = resolveLocationWorkingEnd({
      clockIn,
      timezone: TZ,
      workingStartTime: '08:00',
      workingEndTime: '17:00',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    });
    const modern = resolveWorkingEndFromSchedules({
      clockIn,
      timezone: TZ,
      schedules: [
        {
          days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          startTime: '08:00',
          endTime: '17:00',
        },
      ],
    });
    expect(legacy?.getTime()).toBe(modern?.getTime());
    expect(legacy?.toISOString()).toBe('2026-09-15T15:00:00.000Z'); // 17:00 SAST
  });
});
