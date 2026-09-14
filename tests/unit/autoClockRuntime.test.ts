import { describe, expect, it } from 'vitest';
import { getAutoClockRuntime } from '../../src/utils/autoClockRuntime';

describe('automatic clock runtime ownership', () => {
  it('uses the native background owner inside the React Native shell', () => {
    expect(getAutoClockRuntime(true, true)).toBe('native');
  });

  it('uses the web owner in a normal browser', () => {
    expect(getAutoClockRuntime(true, false)).toBe('web');
  });

  it('disables both owners when automatic clocking is disabled', () => {
    expect(getAutoClockRuntime(false, true)).toBe('disabled');
    expect(getAutoClockRuntime(false, false)).toBe('disabled');
  });
});