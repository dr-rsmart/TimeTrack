import { describe, expect, it, vi } from 'vitest';

// managerAttendanceNotify imports prisma/push; the pure helpers under test
// never touch them, so stub the I/O modules to keep this a pure unit test.
vi.mock('../../server/src/prisma.js', () => ({ default: {} }));
vi.mock('../../server/src/push.js', () => ({ notifyCompanyManagersPush: vi.fn() }));

import {
  collectEmployeeLocationSchedules,
  resolveExpectedWindow,
} from '../../server/src/domain/attendanceCost.js';
import { shouldReopenPreviousSession } from '../../server/src/application/managerAttendanceNotify.js';

const MONDAY = '2026-09-28';
const FRIDAY = '2026-10-02';
const company = [
  { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], startTime: '08:00', endTime: '17:00' },
  { days: ['Friday'], startTime: '08:00', endTime: '15:00' },
];

describe('collectEmployeeLocationSchedules', () => {
  it('merges legacy + join-table location schedules and skips malformed JSON', () => {
    const out = collectEmployeeLocationSchedules({
      geofence: {
        workingHoursSchedules: [{ days: ['Monday'], startTime: '07:00', endTime: '16:00' }],
      },
      employeeGeofences: [
        {
          geofence: {
            workingHoursSchedules: [{ days: ['Tuesday'], startTime: '09:00', endTime: '18:00' }],
          },
        },
        { geofence: { workingHoursSchedules: 'garbage' } },
        { geofence: null },
      ],
    });
    expect(out.map((s) => s.startTime)).toEqual(['07:00', '09:00']);
  });
});

describe('No-shift expected window (reminders / alerts precedence)', () => {
  it('uses LOCATION hours before company hours when no shift exists', () => {
    const w = resolveExpectedWindow({
      dateStr: MONDAY,
      shift: null,
      locationSchedules: [{ days: ['Monday'], startTime: '07:00', endTime: '16:00' }],
      companySchedules: company,
    });
    expect(w).toMatchObject({ source: 'location', start: '07:00', end: '16:00' });
  });

  it('falls back to the per-day company schedule (Friday 15:00 end)', () => {
    const w = resolveExpectedWindow({
      dateStr: FRIDAY,
      shift: null,
      locationSchedules: [],
      companySchedules: company,
    });
    expect(w).toMatchObject({ source: 'company', start: '08:00', end: '15:00' });
  });

  it('Jodache case: a stray 05:00 shift row is what produced "180 min late" vs 08:00', () => {
    // With the stray shift the window is the shift (source shown in the alert)…
    const withShift = resolveExpectedWindow({
      dateStr: MONDAY,
      shift: { startTime: '05:00', endTime: '14:00', shiftType: 'full_day' },
      locationSchedules: [],
      companySchedules: company,
    });
    expect(withShift.source).toBe('shift');
    // …without it, location/company hours apply and 08:00 is the reference.
    const noShift = resolveExpectedWindow({
      dateStr: MONDAY,
      shift: null,
      locationSchedules: [],
      companySchedules: company,
    });
    expect(noShift).toMatchObject({ source: 'company', start: '08:00' });
  });
});

describe('shouldReopenPreviousSession (GPS bounce merge)', () => {
  const now = new Date('2026-09-28T10:30:00Z');
  const base = {
    clockOut: new Date('2026-09-28T10:05:00Z'),
    status: 'completed',
    updatedBy: 'user-1',
    geofenceId: 'gf-1',
    dateStr: '2026-09-28',
  };
  const args = { now, todayStr: '2026-09-28', geofenceId: 'gf-1', mergeMinutes: 60 };

  it('re-opens a same-location session closed 25 minutes ago', () => {
    expect(shouldReopenPreviousSession({ ...args, previous: base })).toBe(true);
  });
  it('never re-opens a cron (working-end) close', () => {
    expect(
      shouldReopenPreviousSession({ ...args, previous: { ...base, updatedBy: 'system:cron' } }),
    ).toBe(false);
  });
  it('never re-opens across locations', () => {
    expect(shouldReopenPreviousSession({ ...args, geofenceId: 'gf-2', previous: base })).toBe(
      false,
    );
  });
  it('never re-opens yesterday or beyond the merge window', () => {
    expect(
      shouldReopenPreviousSession({ ...args, previous: { ...base, dateStr: '2026-09-27' } }),
    ).toBe(false);
    expect(
      shouldReopenPreviousSession({
        ...args,
        previous: { ...base, clockOut: new Date('2026-09-28T09:00:00Z') },
      }),
    ).toBe(false);
  });
  it('is disabled with mergeMinutes = 0 or no previous session', () => {
    expect(shouldReopenPreviousSession({ ...args, mergeMinutes: 0, previous: base })).toBe(false);
    expect(shouldReopenPreviousSession({ ...args, previous: null })).toBe(false);
  });
});
