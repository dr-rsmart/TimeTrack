/**
 * Shift Overlap Detection — Unit Tests
 * =====================================
 * Comprehensive test coverage for shift overlap prevention:
 * - Basic overlap detection
 * - Adjacent (non-overlapping) shifts
 * - Contained shifts
 * - Null time handling
 * - Multiple shift counting
 * - Time window validation
 * - Date parsing (UTC noon)
 */

import { describe, it, expect } from 'vitest';
import {
  timesOverlap,
  countOverlaps,
  isValidTimeWindow,
  parseDate,
  type ShiftTimeWindow,
} from '../../server/src/overlap';

describe('Shift Overlap Detection', () => {
  describe('timesOverlap', () => {
    it('should detect full containment overlap', () => {
      // New shift fully inside existing shift
      expect(timesOverlap('09:00', '11:00', '08:00', '12:00')).toBe(true);
    });

    it('should detect partial overlap at start', () => {
      // New shift starts before existing ends
      expect(timesOverlap('07:00', '09:00', '08:00', '12:00')).toBe(true);
    });

    it('should detect partial overlap at end', () => {
      // New shift ends after existing starts
      expect(timesOverlap('11:00', '13:00', '08:00', '12:00')).toBe(true);
    });

    it('should detect exact same time window as overlap', () => {
      expect(timesOverlap('08:00', '12:00', '08:00', '12:00')).toBe(true);
    });

    it('should detect new shift containing existing shift', () => {
      expect(timesOverlap('07:00', '13:00', '08:00', '12:00')).toBe(true);
    });

    it('should NOT detect adjacent shifts as overlapping (end == start)', () => {
      // Shift ends exactly when next starts — no overlap
      expect(timesOverlap('12:00', '16:00', '08:00', '12:00')).toBe(false);
    });

    it('should NOT detect adjacent shifts as overlapping (start == end)', () => {
      expect(timesOverlap('06:00', '08:00', '08:00', '12:00')).toBe(false);
    });

    it('should NOT detect completely separate shifts as overlapping', () => {
      expect(timesOverlap('14:00', '18:00', '08:00', '12:00')).toBe(false);
      expect(timesOverlap('04:00', '06:00', '08:00', '12:00')).toBe(false);
    });

    it('should handle overnight-style times (before midnight)', () => {
      expect(timesOverlap('22:00', '23:30', '21:00', '23:00')).toBe(true);
      expect(timesOverlap('23:00', '23:59', '22:00', '23:00')).toBe(false);
    });

    it('should handle single-minute overlaps', () => {
      expect(timesOverlap('08:59', '10:00', '08:00', '09:00')).toBe(true);
      expect(timesOverlap('09:00', '10:00', '08:00', '09:00')).toBe(false);
    });
  });

  describe('countOverlaps', () => {
    it('should return 0 for null proposed start', () => {
      const shifts: ShiftTimeWindow[] = [{ startTime: '08:00', endTime: '12:00' }];
      expect(countOverlaps(null, '10:00', shifts)).toBe(0);
    });

    it('should return 0 for null proposed end', () => {
      const shifts: ShiftTimeWindow[] = [{ startTime: '08:00', endTime: '12:00' }];
      expect(countOverlaps('09:00', null, shifts)).toBe(0);
    });

    it('should return 0 for empty shift list', () => {
      expect(countOverlaps('09:00', '17:00', [])).toBe(0);
    });

    it('should skip shifts with null times', () => {
      const shifts: ShiftTimeWindow[] = [
        { startTime: null, endTime: null },
        { startTime: '08:00', endTime: null },
        { startTime: null, endTime: '12:00' },
      ];
      expect(countOverlaps('09:00', '11:00', shifts)).toBe(0);
    });

    it('should count single overlap', () => {
      const shifts: ShiftTimeWindow[] = [
        { startTime: '08:00', endTime: '12:00' },
        { startTime: '14:00', endTime: '18:00' },
      ];
      expect(countOverlaps('10:00', '11:00', shifts)).toBe(1);
    });

    it('should count multiple overlaps', () => {
      const shifts: ShiftTimeWindow[] = [
        { startTime: '08:00', endTime: '12:00' },
        { startTime: '10:00', endTime: '14:00' },
        { startTime: '16:00', endTime: '20:00' },
      ];
      expect(countOverlaps('11:00', '13:00', shifts)).toBe(2);
    });

    it('should count all overlapping shifts in dense schedule', () => {
      const shifts: ShiftTimeWindow[] = [
        { startTime: '08:00', endTime: '10:00' },
        { startTime: '09:00', endTime: '11:00' },
        { startTime: '10:00', endTime: '12:00' },
      ];
      // 09:30-10:30 overlaps with all three
      expect(countOverlaps('09:30', '10:30', shifts)).toBe(3);
    });

    it('should not count adjacent shifts', () => {
      const shifts: ShiftTimeWindow[] = [
        { startTime: '08:00', endTime: '12:00' },
        { startTime: '12:00', endTime: '16:00' },
      ];
      // Exactly between both shifts
      expect(countOverlaps('12:00', '12:00', shifts)).toBe(0);
    });
  });

  describe('isValidTimeWindow', () => {
    it('should accept valid time windows', () => {
      expect(isValidTimeWindow('08:00', '16:00')).toBe(true);
      expect(isValidTimeWindow('00:00', '23:59')).toBe(true);
      expect(isValidTimeWindow('09:30', '17:45')).toBe(true);
    });

    it('should reject inverted time windows', () => {
      expect(isValidTimeWindow('16:00', '08:00')).toBe(false);
      expect(isValidTimeWindow('23:59', '00:00')).toBe(false);
    });

    it('should reject zero-duration windows', () => {
      expect(isValidTimeWindow('08:00', '08:00')).toBe(false);
    });
  });

  describe('parseDate', () => {
    it('should parse date at UTC noon', () => {
      const date = parseDate('2026-08-18');
      expect(date.getUTCHours()).toBe(12);
      expect(date.getUTCMinutes()).toBe(0);
      expect(date.getUTCFullYear()).toBe(2026);
      expect(date.getUTCMonth()).toBe(7); // August = 7 (0-indexed)
      expect(date.getUTCDate()).toBe(18);
    });

    it('should prevent timezone date shifting', () => {
      // UTC noon ensures the date stays consistent across timezones
      const date = parseDate('2026-01-01');
      expect(date.getUTCDate()).toBe(1);
      expect(date.getUTCMonth()).toBe(0);
    });

    it('should handle leap year dates', () => {
      const date = parseDate('2028-02-29');
      expect(date.getUTCDate()).toBe(29);
      expect(date.getUTCMonth()).toBe(1);
    });
  });
});