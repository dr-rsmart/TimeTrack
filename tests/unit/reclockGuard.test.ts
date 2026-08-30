/**
 * Unit tests for the re-clock-in protection window (double clock-in/out fix).
 *
 * Scenario covered: an employee clocks out and is then immediately clocked
 * back in (client glitch / auto clock-in firing right after a manual
 * clock-out). The guard rejects self-service clock-ins inside the window.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  getReclockGuardSeconds,
  isWithinReclockWindow,
} from '../../server/src/reclockGuard.js';

const ORIGINAL_ENV = process.env.RECLOCK_GUARD_SECONDS;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.RECLOCK_GUARD_SECONDS;
  } else {
    process.env.RECLOCK_GUARD_SECONDS = ORIGINAL_ENV;
  }
});

describe('getReclockGuardSeconds (env configuration)', () => {
  it('defaults to 120 seconds when unset', () => {
    delete process.env.RECLOCK_GUARD_SECONDS;
    expect(getReclockGuardSeconds()).toBe(120);
  });

  it('reads a valid override', () => {
    process.env.RECLOCK_GUARD_SECONDS = '300';
    expect(getReclockGuardSeconds()).toBe(300);
  });

  it('supports disabling with 0', () => {
    process.env.RECLOCK_GUARD_SECONDS = '0';
    expect(getReclockGuardSeconds()).toBe(0);
  });

  it('falls back to the default on garbage values', () => {
    process.env.RECLOCK_GUARD_SECONDS = 'not-a-number';
    expect(getReclockGuardSeconds()).toBe(120);
    process.env.RECLOCK_GUARD_SECONDS = '-5';
    expect(getReclockGuardSeconds()).toBe(120);
  });
});

describe('isWithinReclockWindow (guard decision)', () => {
  const now = new Date('2026-08-30T16:00:00Z');

  it('blocks a clock-in 30s after the last clock-out (120s window)', () => {
    const lastOut = new Date('2026-08-30T15:59:30Z');
    expect(isWithinReclockWindow(lastOut, now, 120)).toBe(true);
  });

  it('allows a clock-in once the window has elapsed', () => {
    const lastOut = new Date('2026-08-30T15:57:00Z'); // 180s ago
    expect(isWithinReclockWindow(lastOut, now, 120)).toBe(false);
  });

  it('blocks exactly at window − 1ms and allows at exactly window', () => {
    const boundaryIn = new Date(now.getTime() - 120_000 + 1);
    const boundaryOut = new Date(now.getTime() - 120_000);
    expect(isWithinReclockWindow(boundaryIn, now, 120)).toBe(true);
    expect(isWithinReclockWindow(boundaryOut, now, 120)).toBe(false);
  });

  it('never blocks an employee who has never clocked out', () => {
    expect(isWithinReclockWindow(null, now, 120)).toBe(false);
  });

  it('never blocks when the guard is disabled (0)', () => {
    const lastOut = new Date(now.getTime() - 1);
    expect(isWithinReclockWindow(lastOut, now, 0)).toBe(false);
  });
});
