/**
 * Offline punch acceptance policy — server unit tests
 * ----------------------------------------------------
 * Covers the bounded acceptance window for offline outbox replays
 * (resolveOfflineCapturedAt / getOfflinePunchWindowHours) and the clock-in/out
 * schema extensions (`capturedAt` + `offline`). Heavy collaborators are mocked
 * so the pure policy logic is tested without a database.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../server/src/prisma.js', () => ({ default: {} }));
vi.mock('../../server/src/sse.js', () => ({ broadcastScoped: vi.fn() }));
vi.mock('../../server/src/audit.js', () => ({
  logAudit: vi.fn(),
  getClientIp: vi.fn(() => 'test-ip'),
}));
vi.mock('../../server/src/metrics.js', () => ({
  recordAutoClockOutcome: vi.fn(),
  setAuditLogRows: vi.fn(),
}));
vi.mock('../../server/src/geoValidationService.js', () => ({
  validateClockInLocation: vi.fn(),
  validateClockOutLocation: vi.fn(),
}));
vi.mock('../../server/src/middleware/scope.js', () => ({
  isEmployeeInManagerScope: vi.fn(),
  getManagerScopeFilter: vi.fn(),
}));
vi.mock('../../server/src/tenantContext.js', () => ({ assertTenantMatch: vi.fn() }));
vi.mock('../../server/src/tenantPolicy.js', () => ({ tenantWhere: vi.fn(() => ({})) }));

import {
  AttendanceUseCaseError,
  getOfflinePunchWindowHours,
  resolveOfflineCapturedAt,
} from '../../server/src/application/attendance.js';
import { clockInSchema, clockOutSchema } from '../../server/src/validation.js';

const ORIGINAL_ENV = process.env.OFFLINE_PUNCH_WINDOW_HOURS;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.OFFLINE_PUNCH_WINDOW_HOURS;
  } else {
    process.env.OFFLINE_PUNCH_WINDOW_HOURS = ORIGINAL_ENV;
  }
});

function expectExpired(fn: () => unknown): void {
  try {
    fn();
    expect.unreachable('expected OFFLINE_PUNCH_EXPIRED to be thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(AttendanceUseCaseError);
    const useCaseErr = err as AttendanceUseCaseError;
    expect(useCaseErr.code).toBe('OFFLINE_PUNCH_EXPIRED');
    expect(useCaseErr.status).toBe(422);
  }
}

describe('getOfflinePunchWindowHours (env configuration)', () => {
  it('defaults to 4 hours when unset', () => {
    delete process.env.OFFLINE_PUNCH_WINDOW_HOURS;
    expect(getOfflinePunchWindowHours()).toBe(4);
  });

  it('reads a valid override', () => {
    process.env.OFFLINE_PUNCH_WINDOW_HOURS = '2';
    expect(getOfflinePunchWindowHours()).toBe(2);
  });

  it('falls back to the default on garbage or non-positive values', () => {
    process.env.OFFLINE_PUNCH_WINDOW_HOURS = 'not-a-number';
    expect(getOfflinePunchWindowHours()).toBe(4);
    process.env.OFFLINE_PUNCH_WINDOW_HOURS = '-1';
    expect(getOfflinePunchWindowHours()).toBe(4);
    process.env.OFFLINE_PUNCH_WINDOW_HOURS = '0';
    expect(getOfflinePunchWindowHours()).toBe(4);
  });
});

describe('resolveOfflineCapturedAt (bounded acceptance window)', () => {
  it('returns null for normal online punches', () => {
    expect(resolveOfflineCapturedAt({ offline: false, capturedAt: new Date() })).toBeNull();
    expect(resolveOfflineCapturedAt({})).toBeNull();
  });

  it('treats offline punches without a usable capture time as online', () => {
    expect(resolveOfflineCapturedAt({ offline: true, capturedAt: null })).toBeNull();
    expect(resolveOfflineCapturedAt({ offline: true, capturedAt: new Date(NaN) })).toBeNull();
  });

  it('accepts captures inside the default 4h window', () => {
    const capturedAt = new Date(Date.now() - 30 * 60_000);
    expect(resolveOfflineCapturedAt({ offline: true, capturedAt })).toEqual(capturedAt);
    const edge = new Date(Date.now() - 4 * 3_600_000 + 60_000);
    expect(resolveOfflineCapturedAt({ offline: true, capturedAt: edge })).toEqual(edge);
  });

  it('rejects captures older than the window with OFFLINE_PUNCH_EXPIRED', () => {
    expectExpired(() =>
      resolveOfflineCapturedAt({
        offline: true,
        capturedAt: new Date(Date.now() - 5 * 3_600_000),
      }),
    );
  });

  it('honours a custom window from the environment', () => {
    process.env.OFFLINE_PUNCH_WINDOW_HOURS = '1';
    expectExpired(() =>
      resolveOfflineCapturedAt({
        offline: true,
        capturedAt: new Date(Date.now() - 2 * 3_600_000),
      }),
    );
    const ok = new Date(Date.now() - 30 * 60_000);
    expect(resolveOfflineCapturedAt({ offline: true, capturedAt: ok })).toEqual(ok);
  });

  it('rejects implausibly future-dated captures (payload integrity)', () => {
    expectExpired(() =>
      resolveOfflineCapturedAt({
        offline: true,
        capturedAt: new Date(Date.now() + 30 * 60_000),
      }),
    );
  });

  it('tolerates small future clock skew (5 minutes)', () => {
    const capturedAt = new Date(Date.now() + 60_000);
    expect(resolveOfflineCapturedAt({ offline: true, capturedAt })).toEqual(capturedAt);
  });
});

describe('clock schemas accept offline replay fields', () => {
  it('clockInSchema parses capturedAt + offline', () => {
    const parsed = clockInSchema.parse({
      latitude: -26.2041,
      longitude: 28.0473,
      capturedAt: '2026-09-16T08:00:00.000Z',
      offline: true,
    });
    expect(parsed.offline).toBe(true);
    expect(parsed.capturedAt).toBe('2026-09-16T08:00:00.000Z');
  });

  it('clockOutSchema parses capturedAt + offline', () => {
    const parsed = clockOutSchema.parse({
      breakMinutes: 0,
      latitude: -26.2041,
      longitude: 28.0473,
      capturedAt: '2026-09-16T17:00:00Z',
      offline: true,
    });
    expect(parsed.offline).toBe(true);
    expect(parsed.capturedAt).toBe('2026-09-16T17:00:00Z');
  });

  it('rejects malformed capturedAt values', () => {
    expect(() => clockInSchema.parse({ capturedAt: 'yesterday' })).toThrow();
    expect(() => clockOutSchema.parse({ capturedAt: '2026-09-16 08:00' })).toThrow();
  });

  it('keeps the fields optional for normal online punches', () => {
    const parsed = clockInSchema.parse({ latitude: -26.2041, longitude: 28.0473 });
    expect(parsed.capturedAt).toBeUndefined();
    expect(parsed.offline).toBeUndefined();
  });
});
