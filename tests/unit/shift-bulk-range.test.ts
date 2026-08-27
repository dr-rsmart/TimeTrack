import { describe, it, expect } from 'vitest';
import {
  createShiftSchema,
  expandShiftDateRange,
  BULK_SHIFT_MAX_DAYS,
} from '../../server/src/validation.js';

describe('expandShiftDateRange (bulk shift date ranges)', () => {
  it('returns a single day when endDate is omitted', () => {
    expect(expandShiftDateRange('2026-08-21')).toEqual({ ok: true, days: ['2026-08-21'] });
  });

  it('returns a single day when endDate is undefined', () => {
    expect(expandShiftDateRange('2026-08-21', undefined)).toEqual({ ok: true, days: ['2026-08-21'] });
  });

  it('expands an inclusive range (21 Aug 2026 to 20 Sep 2026 = 31 days)', () => {
    const result = expandShiftDateRange('2026-08-21', '2026-09-20');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.days).toHaveLength(31);
      expect(result.days[0]).toBe('2026-08-21');
      expect(result.days[30]).toBe('2026-09-20');
    }
  });

  it('handles a month/year boundary (28 Dec to 02 Jan)', () => {
    const result = expandShiftDateRange('2026-12-28', '2027-01-02');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.days).toEqual([
        '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
      ]);
    }
  });

  it('treats endDate equal to start date as a single day', () => {
    expect(expandShiftDateRange('2026-08-21', '2026-08-21')).toEqual({ ok: true, days: ['2026-08-21'] });
  });

  it('rejects an endDate before the start date', () => {
    const result = expandShiftDateRange('2026-09-20', '2026-08-21');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('endDate');
      expect(result.error).toMatch(/on or after/i);
    }
  });

  it('rejects a malformed endDate', () => {
    const result = expandShiftDateRange('2026-08-21', '20-09-2026');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('endDate');
  });

  it('rejects a range longer than BULK_SHIFT_MAX_DAYS', () => {
    // 367 days (2026-01-01 → 2027-01-02)
    const result = expandShiftDateRange('2026-01-01', '2027-01-02');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('endDate');
      expect(result.error).toContain(String(BULK_SHIFT_MAX_DAYS));
    }
  });

  it('accepts a range exactly at BULK_SHIFT_MAX_DAYS', () => {
    // 2026 has 365 days: 2026-01-01 → 2027-01-01 inclusive is 366 days
    const result = expandShiftDateRange('2026-01-01', '2027-01-01');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.days).toHaveLength(BULK_SHIFT_MAX_DAYS);
  });
});

describe('createShiftSchema branch (store) field', () => {
  it('accepts an explicit branch on a shift', () => {
    const result = createShiftSchema.safeParse({
      date: '2026-08-21',
      startTime: '08:00',
      endTime: '17:00',
      branch: 'Sandton HQ',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.branch).toBe('Sandton HQ');
  });

  it('accepts a shift without a branch (still optional)', () => {
    const result = createShiftSchema.safeParse({ date: '2026-08-21' });
    expect(result.success).toBe(true);
  });

  it('rejects a branch longer than 100 characters', () => {
    const result = createShiftSchema.safeParse({
      date: '2026-08-21',
      branch: 'x'.repeat(101),
    });
    expect(result.success).toBe(false);
  });
});