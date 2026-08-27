/**
 * Payroll & Overtime Calculation Rules — REAL MODULE VERIFICATION
 * ================================================================
 * Rewritten (Audit Cycle 15, B8 remediation): this suite previously tested a
 * local Decimal re-implementation and verified NOTHING about shipped code.
 * It now exercises the production payroll engine itself
 * (server/src/payroll.ts) end-to-end.
 */
import { test, expect } from '@playwright/test';
import {
  computeOvertime,
  defaultSettings,
  normaliseLeaveType,
  DEFAULT_OVERTIME_THRESHOLD_HOURS,
  DEFAULT_SUNDAY_MULTIPLIER,
  DEFAULT_HOLIDAY_MULTIPLIER,
  DEFAULT_MONTHLY_THRESHOLD_HOURS,
} from '../../server/src/payroll';

test.describe('Payroll & Overtime Calculation Rules', () => {
  test('splits a day into ordinary + daily overtime at the threshold (real engine)', () => {
    const settings = defaultSettings();
    expect(settings.overtimeThresholdHours).toBe(DEFAULT_OVERTIME_THRESHOLD_HOURS);

    // Monday 2026-08-17, 10.5h worked → 8 ordinary + 2.5 daily overtime.
    const result = computeOvertime({ '2026-08-17': 10.5 }, { '2026-08-17': null }, settings);

    expect(result.ordinaryHours).toBe(8);
    expect(result.dailyOvertimeHours).toBe(2.5);
    expect(result.totalOvertimeHours).toBe(2.5);
    expect(result.totalHours).toBe(10.5);
  });

  test('applies Sunday and public-holiday multipliers with holiday precedence (real engine)', () => {
    const settings = defaultSettings();
    settings.publicHolidays = ['2026-08-16']; // a Sunday declared as holiday

    const result = computeOvertime(
      {
        '2026-08-16': 8, // Sunday AND holiday → holiday multiplier wins (2.0×)
        '2026-08-23': 6, // plain Sunday → 1.5×
      },
      {},
      settings,
    );

    expect(result.sundayOvertimeHours).toBe(6);
    expect(result.holidayOvertimeHours).toBe(8);
    expect(result.dailyOvertimeHours).toBe(0);
    expect(result.sundayWeightedOvertime).toBeCloseTo(6 * DEFAULT_SUNDAY_MULTIPLIER, 5);
    expect(result.holidayWeightedOvertime).toBeCloseTo(8 * DEFAULT_HOLIDAY_MULTIPLIER, 5);
    // Holiday precedence: the holiday-Sunday must NOT also count as Sunday OT.
    expect(result.sundayOvertimeHours + result.holidayOvertimeHours).toBe(14);
  });

  test('leave hours count as ordinary and never generate overtime (real engine)', () => {
    const settings = defaultSettings();

    for (const leave of ['Leave', 'Sick', 'PTO', 'Holiday', 'Unpaid']) {
      expect(normaliseLeaveType(leave)).toBe(leave);
      const result = computeOvertime({ '2026-08-17': 12 }, { '2026-08-17': leave }, settings);
      expect(result.ordinaryHours).toBe(12);
      expect(result.totalOvertimeHours).toBe(0);
    }

    // Case-insensitive + unknown types fall through to normal work rules.
    expect(normaliseLeaveType('  sick  ')).toBe('Sick');
    expect(normaliseLeaveType('full_day')).toBeNull();
  });

  test('applies the monthly overtime threshold when enabled (real engine)', () => {
    const settings = defaultSettings();
    settings.useMonthlyOvertimeThreshold = true;
    settings.monthlyOvertimeThresholdHours = DEFAULT_MONTHLY_THRESHOLD_HOURS; // 195

    // 25 non-Sunday days × 8h (exactly at the daily threshold → no daily OT)
    // = 200 ordinary hours. Monthly threshold 195 → 5h reclassified as
    // monthly overtime. August 2026 Sundays: 2, 9, 16, 23, 30.
    const byDate: Record<string, number> = {};
    const sundays = new Set([2, 9, 16, 23, 30]);
    let days = 0;
    for (let d = 1; d <= 31 && days < 25; d++) {
      if (sundays.has(d)) continue;
      byDate[`2026-08-${String(d).padStart(2, '0')}`] = 8;
      days++;
    }

    const result = computeOvertime(byDate, {}, settings);

    expect(days).toBe(25);
    expect(result.dailyOvertimeHours).toBe(0); // nothing above 8/day
    expect(result.monthlyOvertimeHours).toBe(5); // 200 - 195
    expect(result.ordinaryHours).toBe(195);
    expect(result.totalHours).toBe(200);
  });
});

