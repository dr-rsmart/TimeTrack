/**
 * Payroll Engine — Unit Tests
 * ===========================
 * Comprehensive test coverage for overtime calculation rules:
 * - Daily threshold overtime
 * - Sunday multiplier (1.5×)
 * - Public holiday multiplier (2.0×)
 * - Holiday precedence over Sunday
 * - Leave type exclusion (no overtime from leave)
 * - Monthly threshold overtime
 * - Decimal precision
 */

import { describe, it, expect } from 'vitest';
import {
  computeOvertime,
  defaultSettings,
  normaliseLeaveType,
  DEFAULT_OVERTIME_THRESHOLD_HOURS,
  DEFAULT_SUNDAY_MULTIPLIER,
  DEFAULT_HOLIDAY_MULTIPLIER,
  DEFAULT_MONTHLY_THRESHOLD_HOURS,
  LEAVE_TYPES,
  type PayrollSettings,
} from '../../server/src/payroll';

describe('Payroll Engine', () => {
  describe('normaliseLeaveType', () => {
    it('should return null for empty/null/undefined input', () => {
      expect(normaliseLeaveType(null)).toBeNull();
      expect(normaliseLeaveType(undefined)).toBeNull();
      expect(normaliseLeaveType('')).toBeNull();
    });

    it('should normalise leave types case-insensitively', () => {
      expect(normaliseLeaveType('holiday')).toBe('Holiday');
      expect(normaliseLeaveType('LEAVE')).toBe('Leave');
      expect(normaliseLeaveType('sick')).toBe('Sick');
      expect(normaliseLeaveType('pto')).toBe('PTO');
      expect(normaliseLeaveType('unpaid')).toBe('Unpaid');
      expect(normaliseLeaveType('bereavement')).toBe('Bereavement');
      expect(normaliseLeaveType('maternity')).toBe('Maternity');
      expect(normaliseLeaveType('paternity')).toBe('Paternity');
    });

    it('should handle whitespace-padded leave types', () => {
      expect(normaliseLeaveType('  Sick  ')).toBe('Sick');
      expect(normaliseLeaveType(' Leave ')).toBe('Leave');
    });

    it('should return null for non-leave types', () => {
      expect(normaliseLeaveType('Work')).toBeNull();
      expect(normaliseLeaveType('Regular')).toBeNull();
      expect(normaliseLeaveType('Overtime')).toBeNull();
    });

    it('should cover all defined leave types', () => {
      for (const lt of LEAVE_TYPES) {
        expect(normaliseLeaveType(lt)).toBe(lt);
      }
    });
  });

  describe('defaultSettings', () => {
    it('should return correct default values', () => {
      const settings = defaultSettings();
      expect(settings.overtimeThresholdHours).toBe(DEFAULT_OVERTIME_THRESHOLD_HOURS);
      expect(settings.useMonthlyOvertimeThreshold).toBe(false);
      expect(settings.monthlyOvertimeThresholdHours).toBe(DEFAULT_MONTHLY_THRESHOLD_HOURS);
      expect(settings.sundayOvertimeEnabled).toBe(true);
      expect(settings.sundayOvertimeMultiplier).toBe(DEFAULT_SUNDAY_MULTIPLIER);
      expect(settings.publicHolidayOvertimeEnabled).toBe(true);
      expect(settings.publicHolidayOvertimeMultiplier).toBe(DEFAULT_HOLIDAY_MULTIPLIER);
      expect(settings.publicHolidays).toEqual([]);
    });
  });

  describe('computeOvertime — Daily Threshold', () => {
    it('should classify hours at or below threshold as ordinary', () => {
      const settings = defaultSettings();
      // 2026-08-17 is a Monday
      const result = computeOvertime({ '2026-08-17': 8 }, undefined, settings);

      expect(result.ordinaryHours).toBe(8);
      expect(result.dailyOvertimeHours).toBe(0);
      expect(result.totalOvertimeHours).toBe(0);
      expect(result.totalHours).toBe(8);
    });

    it('should calculate daily overtime above threshold', () => {
      const settings = defaultSettings();
      // 10 hours on a Monday = 8 ordinary + 2 overtime
      const result = computeOvertime({ '2026-08-17': 10 }, undefined, settings);

      expect(result.ordinaryHours).toBe(8);
      expect(result.dailyOvertimeHours).toBe(2);
      expect(result.totalOvertimeHours).toBe(2);
      expect(result.totalHours).toBe(10);
    });

    it('should handle multiple days with mixed overtime', () => {
      const settings = defaultSettings();
      const byDate = {
        '2026-08-17': 8,  // Monday: 8 ordinary
        '2026-08-18': 10, // Tuesday: 8 ordinary + 2 OT
        '2026-08-19': 6,  // Wednesday: 6 ordinary
      };
      const result = computeOvertime(byDate, undefined, settings);

      expect(result.ordinaryHours).toBe(22); // 8 + 8 + 6
      expect(result.dailyOvertimeHours).toBe(2);
      expect(result.totalHours).toBe(24);
    });

    it('should respect custom threshold', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        overtimeThresholdHours: 6,
      };
      const result = computeOvertime({ '2026-08-17': 9 }, undefined, settings);

      expect(result.ordinaryHours).toBe(6);
      expect(result.dailyOvertimeHours).toBe(3);
    });

    it('should skip zero and negative hours', () => {
      const settings = defaultSettings();
      const result = computeOvertime(
        { '2026-08-17': 0, '2026-08-18': -2, '2026-08-19': 8 },
        undefined,
        settings
      );

      expect(result.ordinaryHours).toBe(8);
      expect(result.totalHours).toBe(8);
    });
  });

  describe('computeOvertime — Sunday Multiplier', () => {
    it('should apply 1.5x multiplier to Sunday hours', () => {
      const settings = defaultSettings();
      // 2026-08-16 is a Sunday
      const result = computeOvertime({ '2026-08-16': 6 }, undefined, settings);

      expect(result.ordinaryHours).toBe(0);
      expect(result.sundayOvertimeHours).toBe(6);
      expect(result.sundayWeightedOvertime).toBe(9); // 6 x 1.5
      expect(result.totalOvertimeHours).toBe(6);
      expect(result.totalWeightedOvertime).toBe(9);
    });

    it('should not apply Sunday multiplier when disabled', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        sundayOvertimeEnabled: false,
      };
      // Sunday hours become ordinary when disabled
      const result = computeOvertime({ '2026-08-16': 6 }, undefined, settings);

      expect(result.ordinaryHours).toBe(6);
      expect(result.sundayOvertimeHours).toBe(0);
    });

    it('should apply custom Sunday multiplier', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        sundayOvertimeMultiplier: 2.0,
      };
      const result = computeOvertime({ '2026-08-16': 4 }, undefined, settings);

      expect(result.sundayOvertimeHours).toBe(4);
      expect(result.sundayWeightedOvertime).toBe(8); // 4 x 2.0
    });
  });

  describe('computeOvertime — Public Holiday Multiplier', () => {
    it('should apply 2.0x multiplier to public holiday hours', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        publicHolidays: ['2026-08-17'],
      };
      const result = computeOvertime({ '2026-08-17': 8 }, undefined, settings);

      expect(result.ordinaryHours).toBe(0);
      expect(result.holidayOvertimeHours).toBe(8);
      expect(result.holidayWeightedOvertime).toBe(16); // 8 x 2.0
      expect(result.totalOvertimeHours).toBe(8);
      expect(result.totalWeightedOvertime).toBe(16);
    });

    it('should not apply holiday multiplier when disabled', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        publicHolidayOvertimeEnabled: false,
        publicHolidays: ['2026-08-17'],
      };
      const result = computeOvertime({ '2026-08-17': 8 }, undefined, settings);

      // Holiday falls back to ordinary/OT logic
      expect(result.ordinaryHours).toBe(8);
      expect(result.holidayOvertimeHours).toBe(0);
    });

    it('should apply custom holiday multiplier', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        publicHolidayOvertimeMultiplier: 3.0,
        publicHolidays: ['2026-08-17'],
      };
      const result = computeOvertime({ '2026-08-17': 4 }, undefined, settings);

      expect(result.holidayOvertimeHours).toBe(4);
      expect(result.holidayWeightedOvertime).toBe(12); // 4 x 3.0
    });
  });

  describe('computeOvertime — Holiday Precedence', () => {
    it('should prioritise holiday multiplier over Sunday multiplier', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        publicHolidays: ['2026-08-16'], // Sunday is also a holiday
      };
      // 2026-08-16 is a Sunday AND a public holiday
      const result = computeOvertime({ '2026-08-16': 8 }, undefined, settings);

      expect(result.sundayOvertimeHours).toBe(0);
      expect(result.holidayOvertimeHours).toBe(8);
      expect(result.holidayWeightedOvertime).toBe(16); // 8 x 2.0, NOT 8 x 1.5
      expect(result.sundayWeightedOvertime).toBe(0);
    });

    it('should apply Sunday multiplier when holiday is disabled', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        publicHolidayOvertimeEnabled: false,
        publicHolidays: ['2026-08-16'],
      };
      const result = computeOvertime({ '2026-08-16': 8 }, undefined, settings);

      // Holiday disabled, so Sunday rule applies
      expect(result.sundayOvertimeHours).toBe(8);
      expect(result.sundayWeightedOvertime).toBe(12);
      expect(result.holidayOvertimeHours).toBe(0);
    });
  });

  describe('computeOvertime — Leave Type Exclusion', () => {
    it('should count leave hours as ordinary (no overtime)', () => {
      const settings = defaultSettings();
      const byDate = { '2026-08-17': 12 }; // 12 hours would normally be 4 OT
      const shiftTypes = { '2026-08-17': 'Leave' };
      const result = computeOvertime(byDate, shiftTypes, settings);

      expect(result.ordinaryHours).toBe(12);
      expect(result.dailyOvertimeHours).toBe(0);
      expect(result.totalOvertimeHours).toBe(0);
    });

    it('should exclude all leave types from overtime', () => {
      const settings = defaultSettings();
      const leaveTypes = ['Holiday', 'Leave', 'Sick', 'PTO', 'Unpaid', 'Bereavement', 'Maternity', 'Paternity'];

      for (const lt of leaveTypes) {
        const result = computeOvertime(
          { '2026-08-17': 12 },
          { '2026-08-17': lt },
          settings
        );
        expect(result.dailyOvertimeHours).toBe(0);
        expect(result.ordinaryHours).toBe(12);
      }
    });

    it('should exclude Sunday leave hours from Sunday overtime', () => {
      const settings = defaultSettings();
      // Sunday with Leave type
      const result = computeOvertime(
        { '2026-08-16': 8 },
        { '2026-08-16': 'Sick' },
        settings
      );

      expect(result.sundayOvertimeHours).toBe(0);
      expect(result.ordinaryHours).toBe(8);
    });

    it('should exclude holiday leave hours from holiday overtime', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        publicHolidays: ['2026-08-17'],
      };
      const result = computeOvertime(
        { '2026-08-17': 8 },
        { '2026-08-17': 'PTO' },
        settings
      );

      expect(result.holidayOvertimeHours).toBe(0);
      expect(result.ordinaryHours).toBe(8);
    });

    it('should handle mixed leave and work days', () => {
      const settings = defaultSettings();
      const byDate = {
        '2026-08-17': 10, // Monday: work day (8 ord + 2 OT)
        '2026-08-18': 8,  // Tuesday: sick leave (8 ordinary, no OT)
      };
      const shiftTypes = {
        '2026-08-17': null,
        '2026-08-18': 'Sick',
      };
      const result = computeOvertime(byDate, shiftTypes, settings);

      expect(result.ordinaryHours).toBe(16); // 8 + 8
      expect(result.dailyOvertimeHours).toBe(2);
      expect(result.totalHours).toBe(18);
    });
  });

  describe('computeOvertime — Monthly Threshold', () => {
    it('should calculate monthly overtime when enabled', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        useMonthlyOvertimeThreshold: true,
        monthlyOvertimeThresholdHours: 80,
      };
      // Use weekdays only (Mon-Fri) to avoid Sunday classification
      // 2026-08-17 to 2026-08-21 = Mon-Fri (5 days x 8h = 40h)
      // 2026-08-24 to 2026-08-28 = Mon-Fri (5 days x 8h = 40h)
      // 2026-08-31 = Monday (8h)
      // Total ordinary = 88h; threshold 80h -> 8h monthly OT
      const byDate: Record<string, number> = {};
      const weekdays = [17, 18, 19, 20, 21, 24, 25, 26, 27, 28, 31];
      for (const d of weekdays) {
        byDate[`2026-08-${String(d).padStart(2, '0')}`] = 8;
      }
      const result = computeOvertime(byDate, undefined, settings);

      // 11 weekdays x 8h = 88h ordinary; threshold 80h -> 8h monthly OT
      expect(result.monthlyOvertimeHours).toBe(8); // 88 - 80
      expect(result.ordinaryHours).toBe(80);
      expect(result.totalHours).toBe(88);
    });

    it('should not apply monthly threshold when disabled', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        useMonthlyOvertimeThreshold: false,
        monthlyOvertimeThresholdHours: 140,
      };
      // Use weekdays only to avoid Sunday classification
      const byDate: Record<string, number> = {};
      const weekdays = [17, 18, 19, 20, 21, 24, 25, 26, 27, 28, 31];
      for (const d of weekdays) {
        byDate[`2026-08-${String(d).padStart(2, '0')}`] = 8;
      }
      const result = computeOvertime(byDate, undefined, settings);

      expect(result.monthlyOvertimeHours).toBe(0);
      expect(result.ordinaryHours).toBe(88); // 11 x 8h
    });

    it('should track monthly thresholds per calendar month', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        useMonthlyOvertimeThreshold: true,
        monthlyOvertimeThresholdHours: 20,
      };
      // July weekdays: 2026-07-27 (Mon), 2026-07-28 (Tue) = 2 days
      // August weekdays: 2026-08-03 (Mon), 2026-08-04 (Tue) = 2 days
      const byDate = {
        '2026-07-27': 12, // July: 8 ord + 4 daily OT
        '2026-07-28': 12, // July: 8 ord + 4 daily OT -> July ordinary = 16
        '2026-08-03': 12, // August: 8 ord + 4 daily OT
        '2026-08-04': 12, // August: 8 ord + 4 daily OT -> August ordinary = 16
      };
      const result = computeOvertime(byDate, undefined, settings);

      // July ordinary = 16, threshold = 20 -> no monthly OT
      // August ordinary = 16, threshold = 20 -> no monthly OT
      expect(result.monthlyOvertimeHours).toBe(0);
      expect(result.ordinaryHours).toBe(32); // 4 days x 8h
      expect(result.dailyOvertimeHours).toBe(16); // 4 days x 4h
    });

    it('should treat all non-Sunday/non-holiday hours as ordinary at exactly the 195h threshold', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        overtimeThresholdHours: 10,
        useMonthlyOvertimeThreshold: true,
        monthlyOvertimeThresholdHours: DEFAULT_MONTHLY_THRESHOLD_HOURS, // 195
      };
      // August 2026 weekdays (Sundays: 2, 9, 16, 23, 30 — all excluded below)
      // 19 weekdays x 10h + 1 weekday x 5h = exactly 195h ordinary
      const byDate: Record<string, number> = {};
      const fullDays = [3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21, 24, 25, 26, 27];
      for (const d of fullDays) {
        byDate[`2026-08-${String(d).padStart(2, '0')}`] = 10;
      }
      byDate['2026-08-28'] = 5;

      const result = computeOvertime(byDate, undefined, settings);

      expect(result.ordinaryHours).toBe(195);
      expect(result.monthlyOvertimeHours).toBe(0); // exactly at threshold, no excess
      expect(result.dailyOvertimeHours).toBe(0);
      expect(result.sundayOvertimeHours).toBe(0);
      expect(result.holidayOvertimeHours).toBe(0);
      expect(result.totalOvertimeHours).toBe(0);
      expect(result.totalHours).toBe(195);
    });

    it('should reclassify only the excess above 195h as monthly overtime (196h -> 1h OT)', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        overtimeThresholdHours: 10,
        useMonthlyOvertimeThreshold: true,
        monthlyOvertimeThresholdHours: DEFAULT_MONTHLY_THRESHOLD_HOURS, // 195
      };
      // Same as above but last day is 6h -> 196h ordinary -> 1h monthly OT
      const byDate: Record<string, number> = {};
      const fullDays = [3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21, 24, 25, 26, 27];
      for (const d of fullDays) {
        byDate[`2026-08-${String(d).padStart(2, '0')}`] = 10;
      }
      byDate['2026-08-28'] = 6;

      const result = computeOvertime(byDate, undefined, settings);

      expect(result.monthlyOvertimeHours).toBe(1); // 196 - 195
      expect(result.ordinaryHours).toBe(195);
      expect(result.dailyOvertimeHours).toBe(0);
      expect(result.totalOvertimeHours).toBe(1);
      expect(result.totalHours).toBe(196);
    });

    it('should exclude Sunday and public holiday hours from the 195h monthly accumulation', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        overtimeThresholdHours: 10,
        useMonthlyOvertimeThreshold: true,
        monthlyOvertimeThresholdHours: DEFAULT_MONTHLY_THRESHOLD_HOURS, // 195
        publicHolidays: ['2026-08-17'], // Monday public holiday
      };
      // 19 non-holiday weekdays x 10h = 190h ordinary (below 195 threshold)
      const byDate: Record<string, number> = {};
      const weekdays = [3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 18, 19, 20, 21, 24, 25, 26, 27, 28];
      for (const d of weekdays) {
        byDate[`2026-08-${String(d).padStart(2, '0')}`] = 10;
      }
      byDate['2026-08-16'] = 8; // Sunday -> Sunday OT, NOT added to monthly ordinary
      byDate['2026-08-17'] = 8; // Public holiday -> Holiday OT, NOT added to monthly ordinary

      const result = computeOvertime(byDate, undefined, settings);

      // Total hours worked = 206, but only 190 count toward the monthly threshold
      expect(result.ordinaryHours).toBe(190);
      expect(result.monthlyOvertimeHours).toBe(0); // 190 < 195 despite 206h total
      expect(result.sundayOvertimeHours).toBe(8);
      expect(result.sundayWeightedOvertime).toBe(12); // 8 x 1.5
      expect(result.holidayOvertimeHours).toBe(8);
      expect(result.holidayWeightedOvertime).toBe(16); // 8 x 2.0
      expect(result.dailyOvertimeHours).toBe(0);
      expect(result.totalOvertimeHours).toBe(16); // 8 Sunday + 8 holiday
      expect(result.totalHours).toBe(206);
    });

    it('should apply 195h monthly cap to weekday hours only while leaving Sunday/holiday buckets untouched', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        overtimeThresholdHours: 10,
        useMonthlyOvertimeThreshold: true,
        monthlyOvertimeThresholdHours: DEFAULT_MONTHLY_THRESHOLD_HOURS, // 195
        publicHolidays: ['2026-08-17'], // Monday public holiday
      };
      // 20 non-holiday weekdays x 10h = 200h ordinary -> 5h monthly OT
      const byDate: Record<string, number> = {};
      const weekdays = [3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 18, 19, 20, 21, 24, 25, 26, 27, 28, 31];
      for (const d of weekdays) {
        byDate[`2026-08-${String(d).padStart(2, '0')}`] = 10;
      }
      byDate['2026-08-16'] = 6; // Sunday
      byDate['2026-08-17'] = 8; // Public holiday

      const result = computeOvertime(byDate, undefined, settings);

      expect(result.monthlyOvertimeHours).toBe(5); // 200 - 195
      expect(result.ordinaryHours).toBe(195);
      expect(result.sundayOvertimeHours).toBe(6); // untouched by monthly cap
      expect(result.sundayWeightedOvertime).toBe(9); // 6 x 1.5
      expect(result.holidayOvertimeHours).toBe(8); // untouched by monthly cap
      expect(result.holidayWeightedOvertime).toBe(16); // 8 x 2.0
      expect(result.dailyOvertimeHours).toBe(0);
      expect(result.totalOvertimeHours).toBe(19); // 5 monthly + 6 Sunday + 8 holiday
      expect(result.totalWeightedOvertime).toBe(30); // 5 + 9 + 16
      expect(result.totalHours).toBe(214); // 195 + 19
    });
  });

  describe('computeOvertime — Decimal Precision', () => {
    it('should handle fractional hours without floating-point errors', () => {
      const settings = defaultSettings();
      // Use weekdays: 2026-08-17 (Mon), 2026-08-18 (Tue), 2026-08-19 (Wed)
      // Each day: 8.33h -> 8h ordinary + 0.33 daily OT
      const byDate = {
        '2026-08-17': 8.33,
        '2026-08-18': 8.33,
        '2026-08-19': 8.34,
      };
      const result = computeOvertime(byDate, undefined, settings);

      // Ordinary = 8 + 8 + 8 = 24; daily OT = 0.33 + 0.33 + 0.34 = 1.0
      expect(result.ordinaryHours).toBe(24);
      expect(result.dailyOvertimeHours).toBe(1);
      expect(result.totalHours).toBe(25);
    });

    it('should round results to 2 decimal places', () => {
      const settings = defaultSettings();
      // 2026-08-17 (Mon): 8.333h -> 8h ordinary + 0.333 daily OT
      const result = computeOvertime({ '2026-08-17': 8.333 }, undefined, settings);

      expect(result.ordinaryHours).toBe(8);
      expect(result.dailyOvertimeHours).toBe(0.33);
    });

    it('should calculate weighted overtime with precision', () => {
      const settings = defaultSettings();
      // Sunday: 5.5 hours x 1.5 = 8.25
      const result = computeOvertime({ '2026-08-16': 5.5 }, undefined, settings);

      expect(result.sundayOvertimeHours).toBe(5.5);
      expect(result.sundayWeightedOvertime).toBe(8.25);
    });
  });

  describe('computeOvertime — Edge Cases', () => {
    it('should handle empty input', () => {
      const settings = defaultSettings();
      const result = computeOvertime({}, undefined, settings);

      expect(result.ordinaryHours).toBe(0);
      expect(result.totalOvertimeHours).toBe(0);
      expect(result.totalHours).toBe(0);
    });

    it('should handle unsorted dates', () => {
      const settings = defaultSettings();
      const byDate = {
        '2026-08-19': 8,
        '2026-08-17': 8,
        '2026-08-18': 8,
      };
      const result = computeOvertime(byDate, undefined, settings);

      expect(result.ordinaryHours).toBe(24);
    });

    it('should handle combined daily, Sunday, and holiday overtime', () => {
      const settings: PayrollSettings = {
        ...defaultSettings(),
        publicHolidays: ['2026-08-18'],
      };
      const byDate = {
        '2026-08-16': 6,  // Sunday: 6h Sunday OT
        '2026-08-17': 10, // Monday: 8 ord + 2 daily OT
        '2026-08-18': 8,  // Tuesday (holiday): 8h holiday OT
      };
      const result = computeOvertime(byDate, undefined, settings);

      expect(result.ordinaryHours).toBe(8);
      expect(result.dailyOvertimeHours).toBe(2);
      expect(result.sundayOvertimeHours).toBe(6);
      expect(result.holidayOvertimeHours).toBe(8);
      expect(result.totalOvertimeHours).toBe(16); // 2 + 6 + 8
      expect(result.sundayWeightedOvertime).toBe(9);   // 6 x 1.5
      expect(result.holidayWeightedOvertime).toBe(16); // 8 x 2.0
      expect(result.totalWeightedOvertime).toBe(27);   // 2 + 9 + 16
      expect(result.totalHours).toBe(24);
    });
  });
});