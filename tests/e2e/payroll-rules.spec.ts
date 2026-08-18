import { test, expect } from '@playwright/test';
import Decimal from 'decimal.js';

test.describe('Payroll & Overtime Calculation Rules', () => {
  test('should calculate ordinary vs daily overtime with Decimal precision', () => {
    const threshold = new Decimal(8);
    const dayHours = new Decimal(10.5);

    const ordinary = Decimal.min(dayHours, threshold);
    const overtime = Decimal.max(0, dayHours.minus(threshold));

    expect(ordinary.toNumber()).toBe(8);
    expect(overtime.toNumber()).toBe(2.5);
  });

  test('should compute Sunday and Holiday multipliers accurately', () => {
    const sundayHours = new Decimal(6);
    const sundayMultiplier = new Decimal(1.5);
    const holidayHours = new Decimal(8);
    const holidayMultiplier = new Decimal(2.0);

    const sundayWeighted = sundayHours.times(sundayMultiplier);
    const holidayWeighted = holidayHours.times(holidayMultiplier);

    expect(sundayWeighted.toNumber()).toBe(9.0);
    expect(holidayWeighted.toNumber()).toBe(16.0);
  });

  test('should apply monthly overtime cap correctly', () => {
    const monthlyThreshold = new Decimal(195);
    const monthlyOrdinary = new Decimal(210);

    const excessOvertime = Decimal.max(0, monthlyOrdinary.minus(monthlyThreshold));
    const cappedOrdinary = monthlyOrdinary.minus(excessOvertime);

    expect(excessOvertime.toNumber()).toBe(15);
    expect(cappedOrdinary.toNumber()).toBe(195);
  });
});
