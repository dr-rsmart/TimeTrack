/**
 * Unit tests for corrective duplicate-punch detection (Feature Spec §7).
 *
 * These cover the layer that catches duplicates the PREVENTIVE reclockGuard
 * cannot see: manager/admin proxy punches (which bypass the guard by design)
 * and out-of-order offline-outbox replays.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  getDuplicateWindowSeconds,
  isDuplicatePunch,
  pickSurvivingEntry,
  punchGapSeconds,
  describeDuplicateGap,
} from '../../server/src/domain/duplicatePunch.js';

const ORIGINAL_ENV = process.env.DUPLICATE_PUNCH_WINDOW_SECONDS;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.DUPLICATE_PUNCH_WINDOW_SECONDS;
  } else {
    process.env.DUPLICATE_PUNCH_WINDOW_SECONDS = ORIGINAL_ENV;
  }
});

const at = (iso: string) => new Date(iso);
const A = at('2026-09-15T06:00:00.000Z');
const B = at('2026-09-15T06:01:00.000Z'); // +60 s
const C = at('2026-09-15T06:02:00.000Z'); // +120 s (exactly the default window)
const D = at('2026-09-15T06:05:00.000Z'); // +300 s

describe('getDuplicateWindowSeconds (env configuration)', () => {
  it('defaults to 120 seconds — matching RECLOCK_GUARD_SECONDS', () => {
    delete process.env.DUPLICATE_PUNCH_WINDOW_SECONDS;
    expect(getDuplicateWindowSeconds()).toBe(120);
  });

  it('reads a valid override', () => {
    process.env.DUPLICATE_PUNCH_WINDOW_SECONDS = '300';
    expect(getDuplicateWindowSeconds()).toBe(300);
  });

  it('supports disabling flagging with 0', () => {
    process.env.DUPLICATE_PUNCH_WINDOW_SECONDS = '0';
    expect(getDuplicateWindowSeconds()).toBe(0);
  });

  it('falls back to the default on garbage or negative values', () => {
    process.env.DUPLICATE_PUNCH_WINDOW_SECONDS = 'not-a-number';
    expect(getDuplicateWindowSeconds()).toBe(120);
    process.env.DUPLICATE_PUNCH_WINDOW_SECONDS = '-5';
    expect(getDuplicateWindowSeconds()).toBe(120);
  });

  it('truncates fractional seconds', () => {
    process.env.DUPLICATE_PUNCH_WINDOW_SECONDS = '90.9';
    expect(getDuplicateWindowSeconds()).toBe(90);
  });
});

describe('punchGapSeconds', () => {
  it('returns the absolute gap regardless of argument order', () => {
    expect(punchGapSeconds(A, B)).toBe(60);
    expect(punchGapSeconds(B, A)).toBe(60);
  });

  it('returns null when either instant is missing', () => {
    expect(punchGapSeconds(null, B)).toBeNull();
    expect(punchGapSeconds(A, undefined)).toBeNull();
    expect(punchGapSeconds(null, null)).toBeNull();
  });

  it('returns null for an invalid date instead of leaking NaN', () => {
    expect(punchGapSeconds(new Date('nope'), B)).toBeNull();
  });

  it('returns 0 for identical instants', () => {
    expect(punchGapSeconds(A, A)).toBe(0);
  });
});

describe('isDuplicatePunch', () => {
  it('flags a second punch inside the window (the spec scenario)', () => {
    // Employee punches twice within 60 s while inside the geofence.
    expect(isDuplicatePunch(A, B, 120)).toBe(true);
  });

  it('is order-independent — an offline replay may arrive oldest-last', () => {
    expect(isDuplicatePunch(B, A, 120)).toBe(true);
  });

  it('does NOT flag a punch exactly at the window boundary (half-open)', () => {
    expect(isDuplicatePunch(A, C, 120)).toBe(false);
  });

  it('does not flag punches outside the window', () => {
    expect(isDuplicatePunch(A, D, 120)).toBe(false);
  });

  it('respects a custom window', () => {
    expect(isDuplicatePunch(A, D, 600)).toBe(true);
    expect(isDuplicatePunch(A, B, 30)).toBe(false);
  });

  it('is disabled by a zero or negative window', () => {
    expect(isDuplicatePunch(A, B, 0)).toBe(false);
    expect(isDuplicatePunch(A, B, -1)).toBe(false);
  });

  it('is disabled by a non-finite window', () => {
    expect(isDuplicatePunch(A, B, Number.NaN)).toBe(false);
    expect(isDuplicatePunch(A, B, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('never flags when either punch is missing', () => {
    expect(isDuplicatePunch(null, B, 120)).toBe(false);
    expect(isDuplicatePunch(A, null, 120)).toBe(false);
  });

  it('flags identical instants (a true double-submit)', () => {
    expect(isDuplicatePunch(A, A, 120)).toBe(true);
  });
});

describe('pickSurvivingEntry (Option A — keep the first punch)', () => {
  const early = { id: 'early', at: A };
  const late = { id: 'late', at: B };

  it('keeps the EARLIEST clock-in — the employee genuinely arrived then', () => {
    expect(pickSurvivingEntry('clock_in', early, late)).toEqual({
      keepId: 'early',
      discardId: 'late',
    });
  });

  it('keeps the earliest clock-in regardless of argument order', () => {
    expect(pickSurvivingEntry('clock_in', late, early)).toEqual({
      keepId: 'early',
      discardId: 'late',
    });
  });

  it('keeps the LATEST clock-out — the employee genuinely left then', () => {
    expect(pickSurvivingEntry('clock_out', early, late)).toEqual({
      keepId: 'late',
      discardId: 'early',
    });
  });

  it('keeps the latest clock-out regardless of argument order', () => {
    expect(pickSurvivingEntry('clock_out', late, early)).toEqual({
      keepId: 'late',
      discardId: 'early',
    });
  });

  it('breaks an exact tie deterministically toward the first argument', () => {
    const twin = { id: 'twin', at: A };
    expect(pickSurvivingEntry('clock_in', early, twin)).toEqual({
      keepId: 'early',
      discardId: 'twin',
    });
    expect(pickSurvivingEntry('clock_out', early, twin)).toEqual({
      keepId: 'twin',
      discardId: 'early',
    });
  });
});

describe('describeDuplicateGap (UI copy)', () => {
  it('rounds to whole seconds for display', () => {
    expect(
      describeDuplicateGap(at('2026-09-15T06:00:00.000Z'), at('2026-09-15T06:00:01.600Z')),
    ).toBe(2);
  });

  it('returns null when the pair cannot be measured', () => {
    expect(describeDuplicateGap(null, B)).toBeNull();
  });
});
