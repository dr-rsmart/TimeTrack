import { describe, expect, it } from 'vitest';
import {
  collapseDayPunches,
  computeAttendanceCost,
  resolveExpectedWindow,
} from '../../server/src/domain/attendanceCost.js';

const weekday = [
  {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    startTime: '09:00',
    endTime: '17:00',
  },
];
const MONDAY = '2026-09-28';
const SUNDAY = '2026-09-27';

describe('resolveExpectedWindow', () => {
  it('prefers an explicit shift', () => {
    const w = resolveExpectedWindow({
      dateStr: MONDAY,
      shift: { startTime: '08:00', endTime: '16:00', shiftType: 'full_day' },
      locationSchedules: weekday,
      companySchedules: [],
    });
    expect(w).toMatchObject({ start: '08:00', end: '16:00', source: 'shift' });
  });

  it('falls back to location working hours when no shift exists', () => {
    const w = resolveExpectedWindow({
      dateStr: MONDAY,
      shift: null,
      locationSchedules: weekday,
      companySchedules: [],
    });
    expect(w).toMatchObject({ start: '09:00', end: '17:00', source: 'location' });
  });

  it('falls back to company default hours, then none', () => {
    expect(
      resolveExpectedWindow({
        dateStr: MONDAY,
        shift: null,
        locationSchedules: [],
        companySchedules: weekday,
      }).source,
    ).toBe('company');
    expect(
      resolveExpectedWindow({
        dateStr: SUNDAY,
        shift: null,
        locationSchedules: weekday,
        companySchedules: weekday,
      }).source,
    ).toBe('none');
  });

  it('keeps leave shifts authoritative (no fallback lateness)', () => {
    const w = resolveExpectedWindow({
      dateStr: MONDAY,
      shift: { startTime: null, endTime: null, shiftType: 'Leave' },
      locationSchedules: weekday,
      companySchedules: [],
    });
    expect(w.start).toBeNull();
  });
});

describe('Problem statement 3: location 09:00-17:00', () => {
  it('09:05 in + 16:55 out = 10 minutes lost', () => {
    const w = resolveExpectedWindow({
      dateStr: MONDAY,
      shift: null,
      locationSchedules: weekday,
      companySchedules: [],
    });
    const r = computeAttendanceCost({
      shiftStart: w.start,
      shiftEnd: w.end,
      shiftType: w.shiftType,
      crossesMidnight: false,
      clockInMinutesOfDay: 9 * 60 + 5,
      clockOutMinutesOfDay: 16 * 60 + 55,
    });
    expect(r).toEqual({ lateMinutes: 5, earlyMinutes: 5, totalLostMinutes: 10 });
  });

  it('on-time in and out = 0', () => {
    const r = computeAttendanceCost({
      shiftStart: '09:00',
      shiftEnd: '17:00',
      shiftType: null,
      crossesMidnight: false,
      clockInMinutesOfDay: 8 * 60 + 50,
      clockOutMinutesOfDay: 17 * 60 + 10,
    });
    expect(r.totalLostMinutes).toBe(0);
  });
});

describe('shared grace (CompanySettings.lateGraceMinutes)', () => {
  const base = {
    shiftStart: '09:00',
    shiftEnd: '17:00',
    shiftType: null,
    crossesMidnight: false,
  };
  it('ignores deviations within the grace', () => {
    const r = computeAttendanceCost({
      ...base,
      clockInMinutesOfDay: 9 * 60 + 5,
      clockOutMinutesOfDay: 16 * 60 + 55,
      graceMinutes: 5,
    });
    expect(r.totalLostMinutes).toBe(0);
  });
  it('counts the FULL deviation once beyond the grace', () => {
    const r = computeAttendanceCost({
      ...base,
      clockInMinutesOfDay: 9 * 60 + 6,
      clockOutMinutesOfDay: 16 * 60 + 50,
      graceMinutes: 5,
    });
    expect(r).toEqual({ lateMinutes: 6, earlyMinutes: 10, totalLostMinutes: 16 });
  });
  it('defaults to strict (0) when not supplied', () => {
    const r = computeAttendanceCost({
      ...base,
      clockInMinutesOfDay: 9 * 60 + 1,
      clockOutMinutesOfDay: 17 * 60,
    });
    expect(r.lateMinutes).toBe(1);
  });
});

describe('collapseDayPunches', () => {
  it('uses first clock-in and last clock-out so a lunch break is not charged', () => {
    const d = (h: number, m: number) => new Date(Date.UTC(2026, 8, 28, h, m));
    const span = collapseDayPunches([
      { clockIn: d(11, 30), clockOut: d(15, 0) },
      { clockIn: d(7, 0), clockOut: d(10, 0) },
    ]);
    expect(span?.clockIn).toEqual(d(7, 0));
    expect(span?.clockOut).toEqual(d(15, 0));
    expect(collapseDayPunches([])).toBeNull();
  });
});
