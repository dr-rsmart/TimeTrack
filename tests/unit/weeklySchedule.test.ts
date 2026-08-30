/**
 * Unit tests for the per-day "weekly schedule" support on bulk shift creation
 * (Shift Scheduler: define hours for each weekday, applied across a range.
 * e.g. Mon–Fri 08:00–16:30 / Sat 08:00–12:30 / Sunday closed).
 */

import { describe, it, expect } from 'vitest';
import { createShiftSchema } from '../../server/src/validation.js';

describe('createShiftSchema — weeklySchedule (per-day hours)', () => {
  it('accepts a full per-day schedule matching the issue example', () => {
    const weeklySchedule: Record<string, { enabled: boolean; startTime: string | null; endTime: string | null; shiftType?: string }> = {
      '1': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Mon
      '2': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Tue
      '3': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Wed
      '4': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Thu
      '5': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Fri
      '6': { enabled: true, startTime: '08:00', endTime: '12:30', shiftType: 'half_day' }, // Sat
      '0': { enabled: false, startTime: null, endTime: null },                              // Sun closed
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
        weeklySchedule: { '1': { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'night_shift' } },
      }),
    ).toThrow();
  });
});
