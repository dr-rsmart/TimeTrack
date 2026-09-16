import { describe, expect, it } from 'vitest';
import {
  computeAttendanceCost,
  computeRandLost,
  minutesToHours,
} from '../../server/src/domain/attendanceCost.js';
import { isReminderDue } from '../../server/src/timezone.js';

const fullDay = {
  shiftStart: '08:00',
  shiftEnd: '17:00',
  shiftType: 'full_day',
  crossesMidnight: false,
};

describe('computeAttendanceCost', () => {
  it('reports zero loss for an exactly on-time day', () => {
    expect(
      computeAttendanceCost({ ...fullDay, clockInMinutesOfDay: 480, clockOutMinutesOfDay: 1020 }),
    ).toEqual({ lateMinutes: 0, earlyMinutes: 0, totalLostMinutes: 0 });
  });

  it('reports zero loss when early arrival and late departure', () => {
    expect(
      computeAttendanceCost({ ...fullDay, clockInMinutesOfDay: 460, clockOutMinutesOfDay: 1050 }),
    ).toEqual({ lateMinutes: 0, earlyMinutes: 0, totalLostMinutes: 0 });
  });

  it('quantifies a late clock-in', () => {
    const result = computeAttendanceCost({
      ...fullDay,
      clockInMinutesOfDay: 8 * 60 + 23, // 08:23
      clockOutMinutesOfDay: 1020,
    });
    expect(result.lateMinutes).toBe(23);
    expect(result.earlyMinutes).toBe(0);
    expect(result.totalLostMinutes).toBe(23);
  });

  it('quantifies an early clock-out', () => {
    const result = computeAttendanceCost({
      ...fullDay,
      clockInMinutesOfDay: 480,
      clockOutMinutesOfDay: 16 * 60 + 15, // 16:15
    });
    expect(result.earlyMinutes).toBe(45);
    expect(result.totalLostMinutes).toBe(45);
  });

  it('combines late-in and early-out losses', () => {
    const result = computeAttendanceCost({
      ...fullDay,
      clockInMinutesOfDay: 8 * 60 + 30,
      clockOutMinutesOfDay: 16 * 60 + 30,
    });
    expect(result).toEqual({ lateMinutes: 30, earlyMinutes: 30, totalLostMinutes: 60 });
  });

  it('handles midnight-crossing shifts (22:00–06:00) with a next-day clock-out', () => {
    const result = computeAttendanceCost({
      shiftStart: '22:00',
      shiftEnd: '06:00',
      shiftType: 'full_day',
      crossesMidnight: true,
      clockInMinutesOfDay: 22 * 60 + 20, // 22:20 → 20 min late
      clockOutMinutesOfDay: 5 * 60 + 30, // 05:30 next day → 30 min early
      clockOutNextDay: true,
    });
    expect(result).toEqual({ lateMinutes: 20, earlyMinutes: 30, totalLostMinutes: 50 });
  });

  it('never charges leave-type shifts', () => {
    for (const shiftType of ['Leave', 'Sick', 'PTO', 'Holiday', 'Unpaid']) {
      expect(
        computeAttendanceCost({
          ...fullDay,
          shiftType,
          clockInMinutesOfDay: 600,
          clockOutMinutesOfDay: 900,
        }),
      ).toEqual({ lateMinutes: 0, earlyMinutes: 0, totalLostMinutes: 0 });
    }
  });

  it('skips half-day shifts (no stored half-day end time to be early against)', () => {
    expect(
      computeAttendanceCost({
        ...fullDay,
        shiftType: 'half_day',
        clockInMinutesOfDay: 600,
        clockOutMinutesOfDay: 900,
      }),
    ).toEqual({ lateMinutes: 0, earlyMinutes: 0, totalLostMinutes: 0 });
  });

  it('yields zero when there is no scheduled shift', () => {
    expect(
      computeAttendanceCost({
        shiftStart: null,
        shiftEnd: null,
        shiftType: null,
        crossesMidnight: false,
        clockInMinutesOfDay: 600,
        clockOutMinutesOfDay: 900,
      }),
    ).toEqual({ lateMinutes: 0, earlyMinutes: 0, totalLostMinutes: 0 });
  });

  it('ignores an open entry (no clock-out yet) for early-leave', () => {
    const result = computeAttendanceCost({
      ...fullDay,
      clockInMinutesOfDay: 8 * 60 + 10,
      clockOutMinutesOfDay: null,
    });
    expect(result).toEqual({ lateMinutes: 10, earlyMinutes: 0, totalLostMinutes: 10 });
  });
});

describe('computeRandLost', () => {
  it('converts lost minutes to Rand at the hourly rate', () => {
    // 90 min at R100/hr = R150.00
    expect(computeRandLost(90, 100)).toBe(150);
    // 23 min at R85.50/hr = R32.78 (2dp)
    expect(computeRandLost(23, 85.5)).toBe(32.78);
  });

  it('returns 0 without a rate or without lost minutes', () => {
    expect(computeRandLost(60, null)).toBe(0);
    expect(computeRandLost(60, undefined)).toBe(0);
    expect(computeRandLost(0, 100)).toBe(0);
    expect(computeRandLost(60, 0)).toBe(0);
  });

  it('accepts string rates (Prisma Decimal serialisation)', () => {
    expect(computeRandLost(60, '120.50')).toBe(120.5);
  });
});

describe('minutesToHours', () => {
  it('rounds to 2dp', () => {
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(23)).toBe(0.38);
    expect(minutesToHours(0)).toBe(0);
  });
});

describe('isReminderDue (shift reminder windows)', () => {
  const lead = 5;

  it('fires inside the reminder window', () => {
    // 08:00 start, 5-min lead → reminder at 07:55 (475); window [475, 477)
    expect(isReminderDue({ nowMinutesOfDay: 475, eventMinutes: 480, leadMinutes: lead })).toBe(
      true,
    );
    expect(isReminderDue({ nowMinutesOfDay: 476, eventMinutes: 480, leadMinutes: lead })).toBe(
      true,
    );
  });

  it('does not fire before or after the window', () => {
    expect(isReminderDue({ nowMinutesOfDay: 474, eventMinutes: 480, leadMinutes: lead })).toBe(
      false,
    );
    expect(isReminderDue({ nowMinutesOfDay: 477, eventMinutes: 480, leadMinutes: lead })).toBe(
      false,
    );
  });

  it('refuses events whose reminder time falls before midnight', () => {
    // 00:03 start with a 5-min lead would remind at 23:58 the previous day.
    expect(isReminderDue({ nowMinutesOfDay: 1438, eventMinutes: 3, leadMinutes: lead })).toBe(
      false,
    );
  });

  it('honours a custom window size', () => {
    expect(
      isReminderDue({
        nowMinutesOfDay: 478,
        eventMinutes: 480,
        leadMinutes: lead,
        windowMinutes: 5,
      }),
    ).toBe(true);
  });
});
