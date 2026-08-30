/**
 * Unit tests for the auto clock-in/out eligibility rule
 * (isAutoClockEligible in src/hooks/useAutoGeofence.ts).
 *
 * Business rule: auto clock-in/out NEVER applies to master accounts —
 * including demo-persona and impersonation sessions a master operates,
 * which carry the persona's `role` but keep `originalRole === 'master'`.
 */

import { describe, it, expect } from 'vitest';
import { isAutoClockEligible } from '../../src/hooks/useAutoGeofence';

describe('Auto-clock eligibility — master accounts excluded', () => {
  it('genuine tenant users are eligible', () => {
    expect(isAutoClockEligible({ role: 'employee', originalRole: null })).toBe(true);
    expect(isAutoClockEligible({ role: 'admin', originalRole: null })).toBe(true);
    expect(isAutoClockEligible({ role: 'manager', originalRole: null })).toBe(true);
    // originalRole absent entirely (normal /auth/me shape) is fine too.
    expect(isAutoClockEligible({ role: 'employee' })).toBe(true);
  });

  it('a pure master session is NOT eligible', () => {
    expect(isAutoClockEligible({ role: 'master', originalRole: null })).toBe(false);
    expect(isAutoClockEligible({ role: 'master' })).toBe(false);
  });

  it('a master demo-persona session is NOT eligible (role is the persona role)', () => {
    // JWT carries the persona's role; originalRole marks the master operator.
    expect(isAutoClockEligible({ role: 'employee', originalRole: 'master' })).toBe(false);
    expect(isAutoClockEligible({ role: 'manager', originalRole: 'master' })).toBe(false);
  });

  it('a master impersonation session is NOT eligible', () => {
    // Impersonation signs role: 'admin', originalRole: 'master'.
    expect(isAutoClockEligible({ role: 'admin', originalRole: 'master' })).toBe(false);
  });

  it('missing/unknown user is NOT eligible', () => {
    expect(isAutoClockEligible(null)).toBe(false);
    expect(isAutoClockEligible(undefined)).toBe(false);
  });
});