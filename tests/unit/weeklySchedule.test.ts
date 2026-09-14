/**
 * Unit tests for the per-day "weekly schedule" support on bulk shift creation
 * (Shift Scheduler: define hours for each weekday, applied across a range.
 * e.g. Mon–Fri 08:00–16:30 / Sat 08:00–12:30 / Sunday closed).
 */

import { describe, it, expect } from 'vitest';
import {
  bulkCreateShiftsSchema,
  createShiftSchema,
  expandShiftDateRange,
  resolveWeeklyScheduleDay,
  weeklyScheduleSchema,
} from '../../server/src/validation.js';

describe('createShiftSchema — weeklySchedule (per-day hours)', () => {
  it('accepts a full per-day schedule matching the issue example', () => {
    const weeklySchedule: Record<
      string,
      { enabled: boolean; startTime: string | null; endTime: string | null; shiftType?: string }
    > = {
      '1': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Mon
      '2': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Tue
      '3': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Wed
      '4': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Thu
      '5': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Fri
      '6': { enabled: true, startTime: '08:00', endTime: '12:30', shiftType: 'half_day' }, // Sat
      '0': { enabled: false, startTime: null, endTime: null }, // Sun closed
    };

    const parsed = createShiftSchema.parse({
      date: '2026-08-31',
      startTime: '08:00',
      endTime: '16:30',
      weeklySchedule,
    });

    expect(parsed.weeklySchedule?.['6']?.endTime).toBe('12:30');
    expect(parsed.weeklySchedule?.['0']?.enabled).toBe(false);
    // `enabled` defaults to true when omitted
    expect(parsed.weeklySchedule?.['1']?.enabled).toBe(true);
  });

  it('weeklySchedule is optional (plain bulk creation unchanged)', () => {
    const parsed = createShiftSchema.parse({ date: '2026-08-31' });
    expect(parsed.weeklySchedule).toBeUndefined();
  });

  it('rejects malformed times inside the schedule', () => {
    expect(() =>
      createShiftSchema.parse({
        date: '2026-08-31',
        weeklySchedule: { '1': { enabled: true, startTime: '8am', endTime: '16:30' } },
      }),
    ).toThrow();
  });

  it('rejects invalid shift types inside the schedule', () => {
    expect(() =>
      createShiftSchema.parse({
        date: '2026-08-31',
        weeklySchedule: {
          '1': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'night_shift' },
        },
      }),
    ).toThrow();
  });

  it('rejects weekday keys outside Sunday (0) through Saturday (6)', () => {
    expect(() =>
      weeklyScheduleSchema.parse({
        '7': { enabled: true, startTime: '08:00', endTime: '16:30' },
      }),
    ).toThrow();
  });

  it('rejects an open day whose end time is not after its start time', () => {
    expect(() =>
      weeklyScheduleSchema.parse({
        '1': { enabled: true, startTime: '16:30', endTime: '08:00' },
      }),
    ).toThrow();
  });
});

describe('resolveWeeklyScheduleDay', () => {
  const schedule = weeklyScheduleSchema.parse({
    '0': { enabled: false },
    '1': { enabled: true, startTime: '08:00', endTime: '16:30' },
    '2': { enabled: true, startTime: '08:00', endTime: '16:30' },
    '3': { enabled: true, startTime: '08:00', endTime: '16:30' },
    '4': { enabled: true, startTime: '08:00', endTime: '16:30' },
    '5': { enabled: true, startTime: '08:00', endTime: '16:30' },
    '6': { enabled: true, startTime: '08:00', endTime: '12:30', shiftType: 'half_day' },
  });

  it('applies the requested Monday-to-Saturday hours and skips Sunday', () => {
    expect(resolveWeeklyScheduleDay('2026-08-31', schedule, {})).toEqual({
      enabled: true,
      startTime: '08:00',
      endTime: '16:30',
      shiftType: 'full_day',
    });
    expect(resolveWeeklyScheduleDay('2026-09-05', schedule, {})).toEqual({
      enabled: true,
      startTime: '08:00',
      endTime: '12:30',
      shiftType: 'half_day',
    });
    expect(resolveWeeklyScheduleDay('2026-09-06', schedule, {})).toEqual({
      enabled: false,
      startTime: null,
      endTime: null,
      shiftType: 'full_day',
    });
  });

  it('handles an omitted weekday as closed when custom hours are enabled', () => {
    expect(resolveWeeklyScheduleDay('2026-09-06', { '1': schedule['1'] }, {})).toEqual({
      enabled: false,
      startTime: null,
      endTime: null,
      shiftType: 'full_day',
    });
  });

  it('keeps the plain bulk defaults when no weekly schedule is supplied', () => {
    expect(
      resolveWeeklyScheduleDay('2026-09-06', undefined, {
        startTime: '08:00',
        endTime: '17:00',
        shiftType: 'full_day',
      }),
    ).toEqual({
      enabled: true,
      startTime: '08:00',
      endTime: '17:00',
      shiftType: 'full_day',
    });
  });

  it('applies the schedule across a monthly range without creating Sundays', () => {
    const range = expandShiftDateRange('2026-08-01', '2026-08-31');
    expect(range.ok).toBe(true);
    if (!range.ok) return;

    const scheduledDays = range.days.filter(
      (day) => resolveWeeklyScheduleDay(day, schedule, {}).enabled,
    );
    expect(scheduledDays).toHaveLength(26);
    expect(scheduledDays).not.toContain('2026-08-02');
    expect(scheduledDays).toContain('2026-08-01');
    expect(resolveWeeklyScheduleDay('2026-08-01', schedule, {})).toMatchObject({
      startTime: '08:00',
      endTime: '12:30',
      shiftType: 'half_day',
    });
  });
});

describe('bulkCreateShiftsSchema', () => {
  it('validates a range payload with per-day hours', () => {
    const result = bulkCreateShiftsSchema.safeParse({
      employeeIds: ['employee-1'],
      date: '2026-08-31',
      endDate: '2026-09-06',
      startTime: '08:00',
      endTime: '16:30',
      weeklySchedule: {
        '0': { enabled: false },
        '1': { enabled: true, startTime: '08:00', endTime: '16:30' },
        '6': { enabled: true, startTime: '08:00', endTime: '12:30' },
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid default time range', () => {
    const result = bulkCreateShiftsSchema.safeParse({
      employeeIds: ['employee-1'],
      date: '2026-08-31',
      endDate: '2026-09-06',
      startTime: '16:30',
      endTime: '08:00',
    });

    expect(result.success).toBe(false);
  });
});
