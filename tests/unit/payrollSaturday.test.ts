/**
 * Unit tests for the migration-21 Saturday overtime classification in
 * computeOvertime: default-off behaviour, explicit enablement, weighting and
 * the Public Holiday > Sunday > Saturday precedence chain.
 */
import { describe, it, expect } from 'vitest';
import { computeOvertime, defaultSettings } from '../../server/src/payroll.js';

// September 2026: 12th = Saturday, 13th = Sunday, 15th = Tuesday.
const SAT = '2026-09-12';
const SUN = '2026-09-13';
const TUE = '2026-09-15';

describe('computeOvertime — Saturday overtime', () => {
  it('Saturday hours are ordinary when the Saturday switch is OFF (default)', () => {
    const settings = defaultSettings(); // saturdayOvertimeEnabled: false
    const result = computeOvertime({ [SAT]: 8 }, undefined, settings);
    expect(result.saturdayOvertimeHours).toBe(0);
    expect(result.ordinaryHours).toBe(8);
  });

  it('Saturday hours classify as Saturday OT when enabled', () => {
    const settings = { ...defaultSettings(), saturdayOvertimeEnabled: true };
    const result = computeOvertime({ [SAT]: 8 }, undefined, settings);
    expect(result.saturdayOvertimeHours).toBe(8);
    expect(result.saturdayWeightedOvertime).toBe(12); // 8 × 1.5
    expect(result.totalOvertimeHours).toBe(8);
    expect(result.totalWeightedOvertime).toBe(12);
  });

  it('Saturday multiplier is configurable', () => {
    const settings = {
      ...defaultSettings(),
      saturdayOvertimeEnabled: true,
      saturdayOvertimeMultiplier: 2,
    };
    const result = computeOvertime({ [SAT]: 4 }, undefined, settings);
    expect(result.saturdayWeightedOvertime).toBe(8); // 4 × 2
  });

  it('precedence: Public Holiday beats Saturday', () => {
    const settings = {
      ...defaultSettings(),
      saturdayOvertimeEnabled: true,
      publicHolidays: [SAT],
    };
    const result = computeOvertime({ [SAT]: 8 }, undefined, settings);
    expect(result.holidayOvertimeHours).toBe(8);
    expect(result.saturdayOvertimeHours).toBe(0);
  });

  it('precedence: Sunday still wins over Saturday classification on Sundays', () => {
    const settings = { ...defaultSettings(), saturdayOvertimeEnabled: true };
    const result = computeOvertime({ [SUN]: 8 }, undefined, settings);
    expect(result.sundayOvertimeHours).toBe(8);
    expect(result.saturdayOvertimeHours).toBe(0);
  });

  it('mixed week: Saturday OT alongside ordinary weekdays and Sunday OT', () => {
    const settings = { ...defaultSettings(), saturdayOvertimeEnabled: true };
    const result = computeOvertime({ [TUE]: 8, [SAT]: 6, [SUN]: 4 }, undefined, settings);
    expect(result.ordinaryHours).toBe(8);
    expect(result.saturdayOvertimeHours).toBe(6);
    expect(result.sundayOvertimeHours).toBe(4);
    expect(result.totalOvertimeHours).toBe(10);
    expect(result.totalWeightedOvertime).toBe(6 * 1.5 + 4 * 1.5);
  });

  it('leave on a Saturday stays ordinary even when enabled', () => {
    const settings = { ...defaultSettings(), saturdayOvertimeEnabled: true };
    const result = computeOvertime({ [SAT]: 8 }, { [SAT]: 'Leave' }, settings);
    expect(result.saturdayOvertimeHours).toBe(0);
    expect(result.ordinaryHours).toBe(8);
  });
});
