/**
 * Unit tests for the shift-end auto clock-out cron helpers (pure logic in
 * server/src/timezone.ts): date arithmetic, shift-end wall-clock comparison
 * (including overnight shifts), and wall-clock → UTC instant conversion.
 */

import { describe, it, expect } from 'vitest';
import {
  addBusinessDays,
  isShiftEndReached,
  businessTimeToDate,
  businessNow,
} from '../../server/src/timezone';

describe('Shift-end auto clock-out helpers', () => {
  describe('addBusinessDays', () => {
    it('adds a day within a month and across month/year boundaries', () => {
      expect(addBusinessDays('2026-08-17', 1)).toBe('2026-08-18');
      expect(addBusinessDays('2026-08-31', 1)).toBe('2026-09-01');
      expect(addBusinessDays('2026-12-31', 1)).toBe('2027-01-01');
    });

    it('handles leap years and negative offsets', () => {
      expect(addBusinessDays('2028-02-28', 1)).toBe('2028-02-29');
      expect(addBusinessDays('2026-02-28', 1)).toBe('2026-03-01');
      expect(addBusinessDays('2026-08-17', -1)).toBe('2026-08-16');
      expect(addBusinessDays('2027-01-01', -1)).toBe('2026-12-31');
    });
  });

  describe('isShiftEndReached', () => {
    it('fires same-day at and after the scheduled end', () => {
      // Shift 08:00–17:00 (end = 1020 min). Now 17:01 → reached.
      expect(
        isShiftEndReached({
          nowDateStr: '2026-08-17',
          nowMinutesOfDay: 1021,
          shiftDateStr: '2026-08-17',
          endMinutes: 1020,
        }),
      ).toBe(true);
      // Exactly the end minute → reached (cron closes within that minute).
      expect(
        isShiftEndReached({
          nowDateStr: '2026-08-17',
          nowMinutesOfDay: 1020,
          shiftDateStr: '2026-08-17',
          endMinutes: 1020,
        }),
      ).toBe(true);
      // 16:59 → not yet.
      expect(
        isShiftEndReached({
          nowDateStr: '2026-08-17',
          nowMinutesOfDay: 1019,
          shiftDateStr: '2026-08-17',
          endMinutes: 1020,
        }),
      ).toBe(false);
    });

    it('never fires on the shift date for overnight shifts', () => {
      // Shift 22:00–06:00: the end lives on the NEXT day.
      expect(
        isShiftEndReached({
          nowDateStr: '2026-08-17',
          nowMinutesOfDay: 23 * 60,
          shiftDateStr: '2026-08-17',
          endMinutes: 6 * 60,
          crossesMidnight: true,
        }),
      ).toBe(false);
    });

    it('fires the following day for overnight shifts', () => {
      const base = { shiftDateStr: '2026-08-17', endMinutes: 6 * 60, crossesMidnight: true };
      expect(isShiftEndReached({ ...base, nowDateStr: '2026-08-18', nowMinutesOfDay: 6 * 60 + 1 })).toBe(true);
      // 05:59 the next day → not yet.
      expect(isShiftEndReached({ ...base, nowDateStr: '2026-08-18', nowMinutesOfDay: 6 * 60 - 1 })).toBe(false);
    });

    it('fires for stale same-day shifts (backfill after cron downtime)', () => {
      expect(
        isShiftEndReached({
          nowDateStr: '2026-08-18',
          nowMinutesOfDay: 9 * 60,
          shiftDateStr: '2026-08-17',
          endMinutes: 17 * 60,
        }),
      ).toBe(true);
    });
  });

  describe('businessTimeToDate', () => {
    it('converts fixed-offset zones exactly', () => {
      // Africa/Johannesburg is UTC+2 year-round (no DST).
      expect(businessTimeToDate('Africa/Johannesburg', '2026-08-17', 17 * 60).toISOString())
        .toBe('2026-08-17T15:00:00.000Z');
      // Half-hour offset zone (UTC+5:30).
      expect(businessTimeToDate('Asia/Kolkata', '2026-08-17', 8 * 60).toISOString())
        .toBe('2026-08-17T02:30:00.000Z');
    });

    it('respects DST offsets (America/New_York winter vs summer)', () => {
      // EST = UTC-5 in January.
      expect(businessTimeToDate('America/New_York', '2026-01-15', 8 * 60).toISOString())
        .toBe('2026-01-15T13:00:00.000Z');
      // EDT = UTC-4 in August.
      expect(businessTimeToDate('America/New_York', '2026-08-17', 8 * 60).toISOString())
        .toBe('2026-08-17T12:00:00.000Z');
    });

    it('handles midnight and end-of-day minutes', () => {
      expect(businessTimeToDate('Africa/Johannesburg', '2026-08-17', 0).toISOString())
        .toBe('2026-08-16T22:00:00.000Z');
      expect(businessTimeToDate('Africa/Johannesburg', '2026-08-17', 23 * 60 + 59).toISOString())
        .toBe('2026-08-17T21:59:00.000Z');
    });

    it('round-trips through businessNow across offset shapes', () => {
      const dateStr = '2026-08-17';
      const minutes = 7 * 60 + 33;
      for (const tz of ['Africa/Johannesburg', 'America/New_York', 'Asia/Kolkata', 'Australia/Eucla']) {
        const instant = businessTimeToDate(tz, dateStr, minutes);
        const back = businessNow(tz, instant);
        expect(back.dateStr, `tz=${tz}`).toBe(dateStr);
        expect(back.minutesOfDay, `tz=${tz}`).toBe(minutes);
      }
    });
  });
});