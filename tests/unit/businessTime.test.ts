import { describe, expect, it } from 'vitest';
import {
  businessDateString,
  businessHour,
  businessTimeString,
  timeToMinutes,
} from '../../src/lib/businessTime';

describe('business-time formatting', () => {
  it('formats UTC instants in South African business time', () => {
    const instant = '2026-08-17T14:30:00.000Z';
    expect(businessDateString(instant, 'Africa/Johannesburg')).toBe('2026-08-17');
    expect(businessTimeString(instant, 'Africa/Johannesburg')).toBe('16:30');
  });

  it('handles a date crossing the UTC calendar boundary', () => {
    const instant = '2026-08-31T22:30:00.000Z';
    expect(businessDateString(instant, 'Africa/Johannesburg')).toBe('2026-09-01');
    expect(businessTimeString(instant, 'Africa/Johannesburg')).toBe('00:30');
  });

  it('validates business wall-clock minutes', () => {
    expect(timeToMinutes('16:30')).toBe(990);
    expect(timeToMinutes('24:00')).toBeNull();
  });

  it('returns the business hour for an instant', () => {
    expect(businessHour('2026-08-17T14:30:00.000Z', 'Africa/Johannesburg')).toBe(16);
  });
});
