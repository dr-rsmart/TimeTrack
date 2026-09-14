import { describe, expect, it } from 'vitest';
import {
  calculateWorkedDuration,
  calculateWorkedMinutes,
  hoursToMinutes,
  minutesToHours,
  storedDurationHours,
} from '../../server/src/domain/duration.js';

describe('exact attendance duration rules', () => {
  const clockIn = new Date('2026-09-06T08:00:00.000Z');

  it('calculates whole payable minutes and the compatible hour value', () => {
    const duration = calculateWorkedDuration(
      clockIn,
      new Date('2026-09-06T17:15:00.000Z'),
      45,
    );

    expect(duration).toEqual({ totalMinutes: 510, totalHours: 8.5 });
  });

  it('rounds fractional elapsed minutes once at the exact-minute boundary', () => {
    expect(calculateWorkedMinutes(clockIn, new Date('2026-09-06T09:19:30.000Z'))).toBe(80);
    expect(minutesToHours(79)).toBe(1.32);
    expect(hoursToMinutes(1.32)).toBe(79);
  });

  it('clamps negative and malformed durations safely', () => {
    expect(calculateWorkedMinutes(new Date('2026-09-06T10:00:00Z'), clockIn)).toBe(0);
    expect(minutesToHours(-10)).toBe(0);
    expect(hoursToMinutes(Number.NaN)).toBeNull();
  });

  it('prefers exact minutes and falls back to legacy hours', () => {
    expect(storedDurationHours(90, 1.5)).toBe(1.5);
    expect(storedDurationHours(null, 1.5)).toBe(1.5);
    expect(storedDurationHours(undefined, null)).toBe(0);
  });
});