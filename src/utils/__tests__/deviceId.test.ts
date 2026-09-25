import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDeviceId, __resetDeviceIdCache } from '../deviceId';

afterEach(() => {
  __resetDeviceIdCache();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('getDeviceId', () => {
  it('returns a stable id across calls', () => {
    const a = getDeviceId();
    const b = getDeviceId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('persists across cache resets by re-reading localStorage', () => {
    const first = getDeviceId();
    __resetDeviceIdCache();
    expect(getDeviceId()).toBe(first);
  });

  it('rotates when localStorage is cleared', () => {
    const first = getDeviceId();
    localStorage.clear();
    __resetDeviceIdCache();
    expect(getDeviceId()).not.toBe(first);
  });

  it('never exceeds 128 characters', () => {
    expect(getDeviceId().length).toBeLessThanOrEqual(128);
  });

  it('degrades gracefully when localStorage throws (no window/storage access)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    __resetDeviceIdCache();
    const id = getDeviceId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
