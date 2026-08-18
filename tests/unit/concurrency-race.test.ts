import { describe, it, expect } from 'vitest';
import { countOverlaps, parseDate } from '../../server/src/overlap.js';

describe('Shift Overlap & Concurrency Collision Unit Tests', () => {
  const existingShifts = [
    { startTime: '08:00', endTime: '12:00' },
    { startTime: '13:00', endTime: '17:00' },
  ];

  it('detects overlap when new shift starts inside existing shift window', () => {
    expect(countOverlaps('09:00', '11:00', existingShifts)).toBe(1);
  });

  it('detects overlap when new shift completely envelops existing shift', () => {
    expect(countOverlaps('07:00', '18:00', existingShifts)).toBe(2);
  });

  it('allows non-overlapping shifts in gaps between scheduled shifts', () => {
    expect(countOverlaps('12:00', '13:00', existingShifts)).toBe(0);
  });

  it('allows back-to-back (abutting) shifts with zero overlap (e.g. 08:00-12:00 and 12:00-16:00)', () => {
    // 12:00 end of first shift matches 12:00 start of second shift - valid handover
    expect(countOverlaps('12:00', '16:00', [{ startTime: '08:00', endTime: '12:00' }])).toBe(0);
    expect(countOverlaps('04:00', '08:00', [{ startTime: '08:00', endTime: '12:00' }])).toBe(0);
  });

  it('handles null/missing startTime or endTime safely without throwing', () => {
    expect(countOverlaps('08:00', '12:00', [{ startTime: null, endTime: null }])).toBe(0);
    expect(countOverlaps('08:00', '12:00', [{ startTime: '09:00', endTime: null }])).toBe(0);
  });

  it('parseDate standardizes date strings at UTC noon to avoid date shifting', () => {
    const d = parseDate('2026-08-18');
    expect(d.toISOString()).toBe('2026-08-18T12:00:00.000Z');
  });
});
