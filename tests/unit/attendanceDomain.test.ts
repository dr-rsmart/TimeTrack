import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_STATUS,
  calculateWorkedHours,
  isAttendanceStatus,
  normalizeIdempotencyKey,
  scopeIdempotencyKey,
} from '../../server/src/domain/attendance.js';

describe('attendance domain rules', () => {
  it('calculates rounded worked hours after breaks', () => {
    const clockIn = new Date('2026-09-06T08:00:00.000Z');
    const clockOut = new Date('2026-09-06T17:15:00.000Z');

    expect(calculateWorkedHours(clockIn, clockOut, 45)).toBe(8.5);
  });

  it('clamps invalid negative durations to zero', () => {
    const clockIn = new Date('2026-09-06T17:00:00.000Z');
    const clockOut = new Date('2026-09-06T08:00:00.000Z');

    expect(calculateWorkedHours(clockIn, clockOut, 0)).toBe(0);
  });

  it('normalizes bounded idempotency keys and rejects empty or oversized values', () => {
    expect(normalizeIdempotencyKey('  punch-123  ')).toBe('punch-123');
    expect(normalizeIdempotencyKey('   ')).toBeNull();
    expect(normalizeIdempotencyKey('x'.repeat(201))).toBeNull();
    expect(normalizeIdempotencyKey(undefined)).toBeNull();
    expect(scopeIdempotencyKey('clock_in', 'actor-1', 'punch-123')).toBe('clock_in:actor-1:punch-123');
    expect(scopeIdempotencyKey('clock_out', 'actor-1', '   ')).toBeNull();
  });

  it('recognizes the supported attendance statuses only', () => {
    expect(isAttendanceStatus(ATTENDANCE_STATUS.ACTIVE)).toBe(true);
    expect(isAttendanceStatus(ATTENDANCE_STATUS.COMPLETED)).toBe(true);
    expect(isAttendanceStatus('cancelled')).toBe(false);
  });
});