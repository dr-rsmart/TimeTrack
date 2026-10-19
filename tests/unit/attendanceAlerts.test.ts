/**
 * Shift Presence Rule — manager late/early alerts
 * -----------------------------------------------
 * computeShiftDeviation() is the single rule shared by the attendance-alerts
 * feed (routes/reports.ts) and the real-time manager push
 * (application/managerAttendanceNotify.ts): late/early is measured ONLY
 * against an assigned working shift. Unscheduled days are flexible hours.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shiftFindFirst: vi.fn(),
  settingsFindFirst: vi.fn(),
  reminderLogCreate: vi.fn(),
  notifyManagers: vi.fn(),
}));

vi.mock('../../server/src/prisma.js', () => ({
  default: {
    shift: { findFirst: mocks.shiftFindFirst },
    companySettings: { findFirst: mocks.settingsFindFirst },
    reminderLog: { create: mocks.reminderLogCreate },
  },
}));
vi.mock('../../server/src/push.js', () => ({
  notifyCompanyManagersPush: mocks.notifyManagers,
}));

import { computeShiftDeviation } from '../../server/src/domain/attendanceCost.js';
import {
  computeDeviation,
  notifyManagersOfPunch,
} from '../../server/src/application/managerAttendanceNotify.js';

type Entry = Parameters<typeof computeDeviation>[0];

const MONDAY = '2026-09-28';
const fullDay = {
  startTime: '08:00',
  endTime: '17:00',
  shiftType: 'full_day',
  status: 'scheduled',
};
const day = (minutesOfDay: number) => ({ dateStr: MONDAY, minutesOfDay });

describe('computeShiftDeviation (Shift Presence Rule)', () => {
  const base = {
    dateStr: MONDAY,
    clockInMinutesOfDay: 9 * 60 + 30,
    clockOut: day(15 * 60),
    graceMinutes: 0,
  };

  it('returns null when NO shift is assigned (never Late or Early)', () => {
    expect(computeShiftDeviation({ ...base, shift: null })).toBeNull();
  });

  it('returns null for cancelled and no_show shifts', () => {
    expect(
      computeShiftDeviation({ ...base, shift: { ...fullDay, status: 'cancelled' } }),
    ).toBeNull();
    expect(computeShiftDeviation({ ...base, shift: { ...fullDay, status: 'no_show' } })).toBeNull();
  });

  it('returns null for leave and half-day shifts', () => {
    expect(
      computeShiftDeviation({
        ...base,
        shift: { startTime: '08:00', endTime: '17:00', shiftType: 'Leave' },
      }),
    ).toBeNull();
    expect(
      computeShiftDeviation({ ...base, shift: { ...fullDay, shiftType: 'half_day' } }),
    ).toBeNull();
  });

  it('returns null for a shift without times (no fallback to location/company hours)', () => {
    expect(
      computeShiftDeviation({
        ...base,
        shift: { startTime: null, endTime: null, shiftType: 'full_day' },
      }),
    ).toBeNull();
  });

  it('measures late arrival and early departure against the assigned shift', () => {
    expect(computeShiftDeviation({ ...base, shift: fullDay })).toEqual({
      lateMinutes: 90,
      earlyMinutes: 120,
      start: '08:00',
      end: '17:00',
    });
  });

  it('applies CompanySettings.lateGraceMinutes', () => {
    const r = computeShiftDeviation({
      ...base,
      shift: fullDay,
      clockInMinutesOfDay: 8 * 60 + 5,
      clockOut: day(16 * 60 + 55),
      graceMinutes: 5,
    });
    expect(r).toMatchObject({ lateMinutes: 0, earlyMinutes: 0 });
  });

  it('never reports early-leave while the session is still open', () => {
    expect(computeShiftDeviation({ ...base, shift: fullDay, clockOut: null })).toMatchObject({
      lateMinutes: 90,
      earlyMinutes: 0,
    });
  });

  it('handles shifts that cross midnight', () => {
    const night = { startTime: '22:00', endTime: '06:00', shiftType: 'full_day' };
    const r = computeShiftDeviation({
      ...base,
      shift: night,
      clockInMinutesOfDay: 22 * 60 + 20,
      clockOut: { dateStr: '2026-09-29', minutesOfDay: 5 * 60 },
    });
    expect(r).toMatchObject({ lateMinutes: 20, earlyMinutes: 60 });
  });

  describe('managerAttendanceNotify — real-time manager push', () => {
    const entry = {
      id: 'entry-1',
      companyProfileId: 'company-1',
      employeeId: 'emp-1',
      employeeEmail: 'worker@timetrack.co.za',
      employeeName: 'Sipho Dlamini',
      geofenceName: 'Main Warehouse',
      date: new Date('2026-09-28T12:00:00.000Z'),
      clockIn: new Date('2026-09-28T07:30:00.000Z'), // 09:30 SAST
      clockOut: new Date('2026-09-28T13:00:00.000Z'), // 15:00 SAST
    } as unknown as Entry;

    beforeEach(() => {
      vi.clearAllMocks();
      mocks.settingsFindFirst.mockResolvedValue({ lateGraceMinutes: 0 });
      mocks.reminderLogCreate.mockResolvedValue({ id: 'log-1' });
    });

    it('computeDeviation is null for an unscheduled punch', async () => {
      mocks.shiftFindFirst.mockResolvedValue(null);
      expect(await computeDeviation(entry, 'in')).toBeNull();
      expect(await computeDeviation(entry, 'out')).toBeNull();
    });

    it('computeDeviation measures against the assigned shift', async () => {
      mocks.shiftFindFirst.mockResolvedValue(fullDay);
      expect(await computeDeviation(entry, 'in')).toEqual({
        minutes: 90,
        reference: 'shift 08:00',
      });
      expect(await computeDeviation(entry, 'out')).toEqual({
        minutes: 120,
        reference: 'shift 17:00',
      });
    });

    it('excludes cancelled and no-show shifts from the lookup', async () => {
      mocks.shiftFindFirst.mockResolvedValue(null);
      await computeDeviation(entry, 'in');
      expect(mocks.shiftFindFirst.mock.calls[0][0].where.status).toEqual({
        notIn: ['cancelled', 'no_show'],
      });
    });

    it('sends no push for a manual unscheduled punch', async () => {
      mocks.shiftFindFirst.mockResolvedValue(null);
      await notifyManagersOfPunch(entry, 'in', { automatic: false });
      await notifyManagersOfPunch(entry, 'out', { automatic: false });
      expect(mocks.notifyManagers).not.toHaveBeenCalled();
    });

    it('pushes a plain auto clock-in (not "late") for an automatic unscheduled punch', async () => {
      mocks.shiftFindFirst.mockResolvedValue(null);
      await notifyManagersOfPunch(entry, 'in', { automatic: true });
      expect(mocks.notifyManagers).toHaveBeenCalledWith(
        'company-1',
        'Auto clock-in',
        expect.stringContaining('clocked in automatically'),
        { alertType: 'auto_clock_in', timeEntryId: 'entry-1' },
      );
    });

    it('pushes a late clock-in when the assigned shift was missed', async () => {
      mocks.shiftFindFirst.mockResolvedValue(fullDay);
      await notifyManagersOfPunch(entry, 'in', { automatic: false });
      expect(mocks.notifyManagers).toHaveBeenCalledWith(
        'company-1',
        'Late clock-in',
        'Sipho Dlamini clocked in 90 min late at Main Warehouse (vs shift 08:00).',
        { alertType: 'late_clock_in', timeEntryId: 'entry-1' },
      );
    });
  });
});
