import { describe, expect, it } from 'vitest';
import { resolveLocationWorkingEnd } from '../../server/src/locationWorkingHours.js';

const common = {
  timezone: 'Africa/Johannesburg',
  workingStartTime: '08:00',
  workingEndTime: '17:00',
  workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
};

describe('location working-hour fallback', () => {
  it('closes a weekday clock-in at the configured end time', () => {
    expect(resolveLocationWorkingEnd({ ...common, clockIn: new Date('2026-08-17T08:30:00Z') })?.toISOString()).toBe('2026-08-17T15:00:00.000Z');
  });

  it('does not apply location hours on a configured closed day', () => {
    expect(resolveLocationWorkingEnd({ ...common, clockIn: new Date('2026-08-16T08:30:00Z') })).toBeNull();
  });

  it('resolves an overnight clock-in against the previous working day', () => {
    expect(resolveLocationWorkingEnd({
      timezone: 'Africa/Johannesburg',
      clockIn: new Date('2026-08-18T00:00:00Z'),
      workingStartTime: '22:00',
      workingEndTime: '06:00',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    })?.toISOString()).toBe('2026-08-18T04:00:00.000Z');
  });

  it('returns null for an invalid schedule', () => {
    expect(resolveLocationWorkingEnd({ ...common, workingEndTime: 'invalid', clockIn: new Date('2026-08-17T08:30:00Z') })).toBeNull();
  });
});