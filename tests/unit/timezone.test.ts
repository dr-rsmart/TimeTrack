import { describe, it, expect } from 'vitest';
import {
  businessNow,
  timeStrToMinutes,
  isPastGraceDeadline,
} from '../../server/src/timezone';

describe('Business Timezone Rules (cron no-show safety)', () => {
  // Fixed instant: 2026-08-17 09:30 UTC.
  const instant = new Date('2026-08-17T09:30:00Z');

  describe('businessNow', () => {
    it('decomposes an instant into Africa/Johannesburg wall-clock parts', () => {
      const biz = businessNow('Africa/Johannesburg', instant); // UTC+2
      expect(biz.dateStr).toBe('2026-08-17');
      expect(biz.hours).toBe(11);
      expect(biz.minutes).toBe(30);
      expect(biz.minutesOfDay).toBe(11 * 60 + 30);
    });

    it('rolls the date across midnight correctly for far-east timezones', () => {
      const biz = businessNow('Pacific/Auckland', instant); // UTC+12 in Aug (NZST)
      expect(biz.dateStr).toBe('2026-08-17');
      expect(biz.hours).toBe(21);
      expect(biz.minutes).toBe(30);
    });

    it('handles date rollover behind UTC', () => {
      const lateUtc = new Date('2026-08-17T23:30:00Z');
      const biz = businessNow('America/New_York', lateUtc); // UTC-4 (EDT)
      expect(biz.dateStr).toBe('2026-08-17');
      expect(biz.hours).toBe(19);
    });
  });

  describe('timeStrToMinutes', () => {
    it('parses valid HH:mm strings', () => {
      expect(timeStrToMinutes('08:00')).toBe(480);
      expect(timeStrToMinutes('23:59')).toBe(23 * 60 + 59);
      expect(timeStrToMinutes('00:00')).toBe(0);
    });

    it('rejects malformed input safely', () => {
      expect(timeStrToMinutes(null)).toBeNull();
      expect(timeStrToMinutes(undefined)).toBeNull();
      expect(timeStrToMinutes('')).toBeNull();
      expect(timeStrToMinutes('8:60')).toBeNull();
      expect(timeStrToMinutes('24:00')).toBeNull();
      expect(timeStrToMinutes('abc')).toBeNull();
    });
  });

  describe('isPastGraceDeadline', () => {
    const grace = 120; // 2h, matches NO_SHOW_GRACE_MINUTES

    it('marks same-day shifts past start+grace', () => {
      // Shift 08:00 (480), deadline 600 (10:00). Now 11:30 (690) → past.
      expect(isPastGraceDeadline({ nowMinutesOfDay: 690, shiftStartMinutes: 480, graceMinutes: grace })).toBe(true);
      // Now 09:00 (540) → not yet.
      expect(isPastGraceDeadline({ nowMinutesOfDay: 540, shiftStartMinutes: 480, graceMinutes: grace })).toBe(false);
      // Exactly at the deadline → not past (strict >).
      expect(isPastGraceDeadline({ nowMinutesOfDay: 600, shiftStartMinutes: 480, graceMinutes: grace })).toBe(false);
    });

    it('never fires same-day when the deadline crosses midnight', () => {
      // Shift 23:00 (1380) + 2h = 25:00 → deadline lands on the next day.
      expect(isPastGraceDeadline({ nowMinutesOfDay: 1439, shiftStartMinutes: 1380, graceMinutes: grace })).toBe(false);
    });

    it('catches previous-day shifts whose deadline crossed midnight', () => {
      // Yesterday 23:00 shift; deadline 01:00 today (25:00 - 24:00 = 60).
      expect(isPastGraceDeadline({ nowMinutesOfDay: 90, shiftStartMinutes: 1380, graceMinutes: grace, isPreviousDay: true })).toBe(true);
      expect(isPastGraceDeadline({ nowMinutesOfDay: 30, shiftStartMinutes: 1380, graceMinutes: grace, isPreviousDay: true })).toBe(false);
    });

    it('treats previous-day shifts with same-day deadlines as definitely past', () => {
      // Yesterday 08:00 shift: its deadline (10:00 yesterday) has long gone.
      expect(isPastGraceDeadline({ nowMinutesOfDay: 1, shiftStartMinutes: 480, graceMinutes: grace, isPreviousDay: true })).toBe(true);
    });
  });
});
