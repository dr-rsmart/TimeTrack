/**
 * Unit tests for the time-entry deletion rules (Feature Spec §5).
 *
 * Covers the bounded employee self-delete: an employee may remove their OWN
 * erroneous punch within 24 h, but never an open session, a manager's
 * correction, or anything inside a finalized payroll period. Managers/admins
 * keep their pre-existing full rights.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  evaluateTimeEntryDeletion,
  isWithinSelfDeleteWindow,
  sameEmployee,
  getSelfDeleteWindowHours,
  SELF_DELETE_WINDOW_HOURS,
  type SelfDeleteFacts,
} from '../../server/src/domain/deletionRules.js';

const ORIGINAL_ENV = process.env.TIME_ENTRY_SELF_DELETE_WINDOW_HOURS;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.TIME_ENTRY_SELF_DELETE_WINDOW_HOURS;
  } else {
    process.env.TIME_ENTRY_SELF_DELETE_WINDOW_HOURS = ORIGINAL_ENV;
  }
});

const NOW = new Date('2026-09-15T12:00:00.000Z');
const ONE_HOUR_AGO = new Date('2026-09-15T11:00:00.000Z');
const EXACTLY_24H_AGO = new Date('2026-09-14T12:00:00.000Z');
const TWO_DAYS_AGO = new Date('2026-09-13T12:00:00.000Z');

/** A deletable, employee-owned, recently created, unlocked entry. */
function facts(overrides: Partial<SelfDeleteFacts> = {}): SelfDeleteFacts {
  return {
    actorRole: 'employee',
    actorEmail: 'lerato@timetrack.com',
    entryEmployeeEmail: 'lerato@timetrack.com',
    entryStatus: 'completed',
    entryCreatedAt: ONE_HOUR_AGO,
    entryIsManuallyAdjusted: false,
    entryIsManualOverride: false,
    payrollLocked: false,
    now: NOW,
    ...overrides,
  };
}

describe('getSelfDeleteWindowHours (env configuration)', () => {
  it('defaults to 24 hours', () => {
    delete process.env.TIME_ENTRY_SELF_DELETE_WINDOW_HOURS;
    expect(getSelfDeleteWindowHours()).toBe(24);
    expect(SELF_DELETE_WINDOW_HOURS).toBe(24);
  });

  it('reads a valid override and supports fractional hours', () => {
    process.env.TIME_ENTRY_SELF_DELETE_WINDOW_HOURS = '48';
    expect(getSelfDeleteWindowHours()).toBe(48);
    process.env.TIME_ENTRY_SELF_DELETE_WINDOW_HOURS = '0.5';
    expect(getSelfDeleteWindowHours()).toBe(0.5);
  });

  it('supports disabling self-delete with 0', () => {
    process.env.TIME_ENTRY_SELF_DELETE_WINDOW_HOURS = '0';
    expect(getSelfDeleteWindowHours()).toBe(0);
  });

  it('falls back to the default on garbage or negative values', () => {
    process.env.TIME_ENTRY_SELF_DELETE_WINDOW_HOURS = 'nope';
    expect(getSelfDeleteWindowHours()).toBe(24);
    process.env.TIME_ENTRY_SELF_DELETE_WINDOW_HOURS = '-1';
    expect(getSelfDeleteWindowHours()).toBe(24);
  });
});

describe('sameEmployee', () => {
  it('compares case- and whitespace-insensitively', () => {
    expect(sameEmployee('Lerato@TimeTrack.com', '  lerato@timetrack.com ')).toBe(true);
  });

  it('distinguishes different people', () => {
    expect(sameEmployee('lerato@timetrack.com', 'thabo@timetrack.com')).toBe(false);
  });
});

describe('isWithinSelfDeleteWindow (boundary behaviour)', () => {
  it('allows a recent entry', () => {
    expect(isWithinSelfDeleteWindow(ONE_HOUR_AGO, NOW, 24)).toBe(true);
  });

  it('rejects an entry EXACTLY at the boundary (half-open window)', () => {
    expect(isWithinSelfDeleteWindow(EXACTLY_24H_AGO, NOW, 24)).toBe(false);
  });

  it('rejects an older entry', () => {
    expect(isWithinSelfDeleteWindow(TWO_DAYS_AGO, NOW, 24)).toBe(false);
  });

  it('treats a future-dated createdAt (clock skew) as inside the window', () => {
    const future = new Date('2026-09-16T12:00:00.000Z');
    expect(isWithinSelfDeleteWindow(future, NOW, 24)).toBe(true);
  });

  it('is disabled by a zero or non-finite window', () => {
    expect(isWithinSelfDeleteWindow(ONE_HOUR_AGO, NOW, 0)).toBe(false);
    expect(isWithinSelfDeleteWindow(ONE_HOUR_AGO, NOW, Number.NaN)).toBe(false);
  });
});

describe('evaluateTimeEntryDeletion — privileged roles', () => {
  it.each(['admin', 'manager', 'master'] as const)(
    'allows %s regardless of age, ownership or payroll lock',
    (role) => {
      const verdict = evaluateTimeEntryDeletion(
        facts({
          actorRole: role,
          actorEmail: 'admin@timetrack.com',
          entryCreatedAt: TWO_DAYS_AGO,
          payrollLocked: true,
          entryIsManuallyAdjusted: true,
          entryStatus: 'active',
        }),
      );
      expect(verdict).toEqual({ allowed: true, selfService: false });
    },
  );
});

describe('evaluateTimeEntryDeletion — employee self-service', () => {
  it('allows deleting an own, recent, completed, unlocked entry', () => {
    expect(evaluateTimeEntryDeletion(facts())).toEqual({ allowed: true, selfService: true });
  });

  it("rejects deleting ANOTHER employee's entry", () => {
    const verdict = evaluateTimeEntryDeletion(facts({ entryEmployeeEmail: 'thabo@timetrack.com' }));
    expect(verdict).toMatchObject({ allowed: false, status: 403, code: 'ACCESS_DENIED' });
  });

  it('rejects deleting an OPEN session — must clock out instead', () => {
    const verdict = evaluateTimeEntryDeletion(facts({ entryStatus: 'active' }));
    expect(verdict).toMatchObject({ allowed: false, status: 409, code: 'ACTIVE_SESSION' });
  });

  it('rejects a manager-adjusted entry', () => {
    const verdict = evaluateTimeEntryDeletion(facts({ entryIsManuallyAdjusted: true }));
    expect(verdict).toMatchObject({ allowed: false, status: 403, code: 'MANAGER_ADJUSTED' });
  });

  it('rejects a manager-created manual override', () => {
    const verdict = evaluateTimeEntryDeletion(facts({ entryIsManualOverride: true }));
    expect(verdict).toMatchObject({ allowed: false, status: 403, code: 'MANAGER_ADJUSTED' });
  });

  it('rejects an entry inside a finalized payroll period', () => {
    const verdict = evaluateTimeEntryDeletion(facts({ payrollLocked: true }));
    expect(verdict).toMatchObject({ allowed: false, status: 409, code: 'PAYROLL_LOCKED' });
  });

  it('rejects an entry older than the 24 h window', () => {
    const verdict = evaluateTimeEntryDeletion(facts({ entryCreatedAt: TWO_DAYS_AGO }));
    expect(verdict).toMatchObject({
      allowed: false,
      status: 403,
      code: 'SELF_DELETE_WINDOW_EXPIRED',
    });
  });

  it('honours a custom window', () => {
    const verdict = evaluateTimeEntryDeletion(
      facts({ entryCreatedAt: TWO_DAYS_AGO, windowHours: 72 }),
    );
    expect(verdict).toEqual({ allowed: true, selfService: true });
  });

  it('rejects everything when the window is disabled (0)', () => {
    const verdict = evaluateTimeEntryDeletion(facts({ windowHours: 0 }));
    expect(verdict).toMatchObject({ allowed: false, code: 'SELF_DELETE_WINDOW_EXPIRED' });
  });

  it('checks ownership BEFORE the time window (no information leak)', () => {
    // Someone else's OLD entry must read as "not yours", not "too old".
    const verdict = evaluateTimeEntryDeletion(
      facts({ entryEmployeeEmail: 'thabo@timetrack.com', entryCreatedAt: TWO_DAYS_AGO }),
    );
    expect(verdict).toMatchObject({ code: 'ACCESS_DENIED' });
  });

  it('returns an actionable message for every denial', () => {
    const verdict = evaluateTimeEntryDeletion(facts({ entryStatus: 'active' }));
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.message.length).toBeGreaterThan(10);
    }
  });
});
