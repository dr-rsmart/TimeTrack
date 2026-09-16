/**
 * Unit tests for src/utils/autoClockStatus.ts — the reason ladder that
 * explains why an automatic clock-in has not fired while the employee is
 * inside their geofence (the "inside geofence + not clocked in" contradiction
 * on the Time tab).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveAutoClockStatus,
  parseNativeAutoClockStatus,
  AUTO_CLOCK_STATUS_STALE_MS,
  type NativeAutoClockStatus,
} from '../../src/utils/autoClockStatus';

const base = {
  clockedIn: false,
  inside: true,
  toggleEnabled: true,
  eligible: true,
  nativeShell: false,
  webMonitoringActive: true,
  webAwaitingExit: false,
  webPermissionDenied: false,
  webPoorSignal: false,
  nativeStatus: null,
  confirmations: 3,
};

const native = (over: Partial<NativeAutoClockStatus> = {}): NativeAutoClockStatus => ({
  suppressed: false,
  suppressedSetAt: null,
  zone: 'inside',
  pendingEnter: 0,
  backgroundStarted: true,
  backgroundPermission: 'granted',
  hasToken: true,
  monitoredCount: 1,
  lastSampleAt: Date.now(),
  lastAcceptedAt: Date.now(),
  sampleZone: 'inside',
  at: Date.now(),
  ...over,
});

describe('resolveAutoClockStatus — consistent states', () => {
  it('returns null when the employee is outside the geofence', () => {
    expect(resolveAutoClockStatus({ ...base, inside: false })).toBeNull();
  });

  it('returns null when inside, clocked in and enabled', () => {
    expect(resolveAutoClockStatus({ ...base, clockedIn: true })).toBeNull();
  });
});

describe('resolveAutoClockStatus — reason ladder', () => {
  it('reports ineligible sessions first', () => {
    const s = resolveAutoClockStatus({ ...base, eligible: false, toggleEnabled: false });
    expect(s?.kind).toBe('ineligible');
  });

  it('reports the toggle being off', () => {
    expect(resolveAutoClockStatus({ ...base, toggleEnabled: false })?.kind).toBe('off');
  });

  it('warns a clocked-in employee that auto clock-out is disabled when the toggle is off', () => {
    const s = resolveAutoClockStatus({ ...base, clockedIn: true, toggleEnabled: false });
    expect(s?.kind).toBe('off');
    expect(s?.title).toContain('clock-out');
  });

  it('explains native suppression (clocked out while on site)', () => {
    const s = resolveAutoClockStatus({
      ...base,
      nativeShell: true,
      nativeStatus: native({ suppressed: true, suppressedSetAt: Date.now() - 60_000 }),
    });
    expect(s?.kind).toBe('suppressed');
    expect(s?.detail).toContain('12 h');
    expect(s?.detail).toContain('armed at');
  });

  it('explains web awaiting-exit suppression', () => {
    expect(resolveAutoClockStatus({ ...base, webAwaitingExit: true })?.kind).toBe('suppressed');
  });

  it('flags missing native background updates', () => {
    const s = resolveAutoClockStatus({
      ...base,
      nativeShell: true,
      nativeStatus: native({ backgroundStarted: false }),
    });
    expect(s?.kind).toBe('background');
    expect(s?.detail).toContain('device location settings');
  });

  it('flags a native shell without any status snapshot yet', () => {
    expect(resolveAutoClockStatus({ ...base, nativeShell: true })?.kind).toBe('unknown');
  });

  it('reports confirmation progress from the native snapshot', () => {
    const s = resolveAutoClockStatus({
      ...base,
      nativeShell: true,
      nativeStatus: native({ pendingEnter: 1 }),
    });
    expect(s?.kind).toBe('confirming');
    expect(s?.detail).toContain('1/3');
  });

  it('reports web permission denial', () => {
    expect(resolveAutoClockStatus({ ...base, webPermissionDenied: true })?.kind).toBe('permission');
  });

  it('reports a stopped web monitor', () => {
    expect(resolveAutoClockStatus({ ...base, webMonitoringActive: false })?.kind).toBe(
      'monitor-off',
    );
  });

  it('reports poor GPS signal on web', () => {
    expect(resolveAutoClockStatus({ ...base, webPoorSignal: true })?.kind).toBe('poor-signal');
  });

  it('falls back to confirming on a healthy web monitor', () => {
    expect(resolveAutoClockStatus(base)?.kind).toBe('confirming');
  });
});

describe('parseNativeAutoClockStatus', () => {
  it('rejects malformed payloads', () => {
    expect(parseNativeAutoClockStatus(null)).toBeNull();
    expect(parseNativeAutoClockStatus('nope')).toBeNull();
    expect(parseNativeAutoClockStatus({ at: 1 })).toBeNull();
    expect(parseNativeAutoClockStatus({ suppressed: true })).toBeNull();
  });

  it('accepts a valid snapshot and normalises unknown fields', () => {
    const parsed = parseNativeAutoClockStatus({
      suppressed: true,
      suppressedSetAt: 'x',
      zone: 'sideways',
      pendingEnter: '2',
      backgroundStarted: false,
      at: 123,
    });
    expect(parsed).toMatchObject({
      suppressed: true,
      suppressedSetAt: null,
      zone: null,
      pendingEnter: 0,
      backgroundStarted: false,
      at: 123,
    });
  });
});

describe('native diagnostic accuracy', () => {
  const resolve = (over: Partial<NativeAutoClockStatus>, extra = {}) =>
    resolveAutoClockStatus({
      ...base,
      nativeShell: true,
      nativeStatus: native(over),
      ...extra,
    });

  it.each([
    [{ backgroundPermission: 'denied' }, 'permission'],
    [{ backgroundPermission: 'undetermined' }, 'permission'],
    [{ backgroundPermission: null }, 'unknown'],
    [{ hasToken: false }, 'auth'],
    [{ failure: 'auth' }, 'auth'],
    [{ failure: 'network' }, 'punch-failed'],
    [{ failure: 'server' }, 'punch-failed'],
    [{ failure: 'rejected' }, 'punch-failed'],
    [{ failure: 'reclock' }, 'cooldown'],
    [{ taskError: true }, 'background'],
    [{ enabled: false }, 'off'],
    [{ monitoredCount: 0 }, 'unassigned'],
    [{ lastSampleAt: null, lastAcceptedAt: null }, 'stale'],
    [{ lastAcceptedAt: Date.now() - AUTO_CLOCK_STATUS_STALE_MS - 10_000 }, 'stale'],
    [{ poorSignal: true, lastAcceptedAt: null }, 'poor-signal'],
    [{ pendingEnter: 0 }, 'native-idle'],
    [{ pendingEnter: 3 }, 'native-idle'],
    [{ sampleZone: 'outside', pendingEnter: 1 }, 'native-idle'],
    [{ cooldownUntil: Date.now() + 60_000 }, 'cooldown'],
  ] as const)('resolves %j to %s', (over, expected) => {
    expect(resolve(over)?.kind).toBe(expected);
  });

  it('does not promote old or future snapshots to a current diagnosis', () => {
    expect(
      resolve({ at: Date.now() - AUTO_CLOCK_STATUS_STALE_MS - 1, suppressed: true })?.kind,
    ).toBe('unknown');
    expect(resolve({ at: Date.now() + 60_000 })?.kind).toBe('unknown');
  });

  it('does not use stale web suppression in native mode, or native state in a browser', () => {
    expect(resolve({}, { webAwaitingExit: true })?.kind).toBe('native-idle');
    expect(resolve({ suppressed: true }, { nativeShell: false })?.kind).toBe('confirming');
  });

  it('ignores expired and legacy native suppression flags', () => {
    expect(
      resolve({ suppressed: true, suppressedSetAt: Date.now() - 13 * 60 * 60_000 })?.kind,
    ).not.toBe('suppressed');
    expect(resolve({ suppressed: true, suppressedSetAt: null })?.kind).not.toBe('suppressed');
  });

  it('reports blockers even without foreground proximity and while clocked in', () => {
    expect(resolve({ hasToken: false }, { inside: false, clockedIn: true })?.kind).toBe('auth');
    expect(resolve({}, { inside: false, toggleEnabled: false })?.kind).toBe('off');
  });

  it('rejects non-finite timestamps and strips sensitive/unrecognised fields', () => {
    for (const at of [NaN, Infinity, -1, 0]) {
      expect(parseNativeAutoClockStatus({ suppressed: false, at })).toBeNull();
    }
    const status = parseNativeAutoClockStatus({
      suppressed: false,
      at: 123,
      token: 'secret',
      failure: 'raw server error',
      pendingEnter: -2,
    });
    expect(status).not.toHaveProperty('token');
    expect(status).toMatchObject({ pendingEnter: 0, failure: null, backgroundStarted: null });
  });
});
