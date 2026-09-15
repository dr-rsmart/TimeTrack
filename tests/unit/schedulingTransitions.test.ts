import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeActiveEntryAtShiftEnd,
  closeActiveEntryAtWorkingEnd,
  closeStaleActiveEntry,
  markShiftNoShow,
  type ActiveEntryRef,
  type SchedulingDeps,
  type ShiftRef,
} from '../../server/src/application/scheduling.js';

function makeDeps(updateManyCount = 1) {
  return {
    timeEntry: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }),
    },
    shift: { update: vi.fn().mockResolvedValue({}) },
    broadcast: vi.fn(),
    recordOutcome: vi.fn(),
    push: vi.fn().mockResolvedValue(undefined),
    info: vi.fn(),
  } satisfies SchedulingDeps;
}

const clockIn = new Date('2026-09-15T06:00:00.000Z');

function entry(overrides: Partial<ActiveEntryRef> = {}): ActiveEntryRef {
  return {
    id: 'te_1',
    clockIn,
    breakMinutes: 30,
    employeeEmail: 'lerato@timetrack.com',
    companyProfileId: 'cp_1',
    branch: 'Sandton HQ',
    department: 'General',
    ...overrides,
  };
}

function shift(overrides: Partial<ShiftRef> = {}): ShiftRef {
  return {
    id: 'sh_1',
    date: new Date('2026-09-15T12:00:00.000Z'),
    endTime: '15:00',
    notes: null,
    employeeId: 'emp_1',
    companyProfileId: 'cp_1',
    branch: 'Sandton HQ',
    department: 'General',
    ...overrides,
  };
}

describe('closeActiveEntryAtShiftEnd', () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps();
  });

  it('closes the entry at the exact scheduled end with exact minutes', async () => {
    const clockOut = new Date('2026-09-15T13:00:00.000Z'); // 7h elapsed
    const closed = await closeActiveEntryAtShiftEnd(entry(), shift(), clockOut, deps);

    expect(closed).toBe(true);
    expect(deps.timeEntry.updateMany).toHaveBeenCalledWith({
      where: { id: 'te_1', status: 'active' },
      data: {
        clockOut,
        status: 'completed',
        totalMinutes: 390, // 420 elapsed - 30 break
        totalHours: 6.5,
        isManualOverride: true,
        updatedBy: 'system:cron',
      },
    });
    expect(deps.recordOutcome).toHaveBeenCalledWith('cron_shift_end_closed');
    expect(deps.push).toHaveBeenCalledWith(
      'lerato@timetrack.com',
      'Automatic Clock Out',
      expect.stringContaining('15:00'),
      { type: 'auto_clock_out', entryId: 'te_1' },
    );
    expect(deps.shift.update).toHaveBeenCalledWith({
      where: { id: 'sh_1' },
      data: { notes: expect.stringContaining('[Auto] Auto clock-out applied') },
    });
    expect(deps.broadcast).toHaveBeenCalledWith(
      'timeEntry',
      'clockOut',
      expect.objectContaining({ id: 'te_1', autoClockOutAtShiftEnd: true, autoClockOut: true }),
      { companyProfileId: 'cp_1', branch: 'Sandton HQ', department: 'General' },
    );
  });

  it('does nothing when a concurrent clock-out won the race (count=0)', async () => {
    const raced = makeDeps(0);
    const closed = await closeActiveEntryAtShiftEnd(
      entry(),
      shift(),
      new Date('2026-09-15T13:00:00.000Z'),
      raced,
    );
    expect(closed).toBe(false);
    expect(raced.push).not.toHaveBeenCalled();
    expect(raced.shift.update).not.toHaveBeenCalled();
    expect(raced.broadcast).not.toHaveBeenCalled();
    expect(raced.recordOutcome).not.toHaveBeenCalled();
  });

  it('appends to existing shift notes instead of replacing them', async () => {
    await closeActiveEntryAtShiftEnd(
      entry(),
      shift({ notes: 'Existing note' }),
      new Date('2026-09-15T13:00:00.000Z'),
      deps,
    );
    const notes = deps.shift.update.mock.calls[0][0].data.notes as string;
    expect(notes.startsWith('Existing note\n[Auto]')).toBe(true);
  });
});

describe('closeActiveEntryAtWorkingEnd', () => {
  it('closes at the location working end and flags the SSE payload', async () => {
    const deps = makeDeps();
    const clockOut = new Date('2026-09-15T15:30:00.000Z'); // 9.5h elapsed
    const closed = await closeActiveEntryAtWorkingEnd(
      entry({ geofenceId: 'gf_1' }),
      clockOut,
      'Sitari Country Estate',
      deps,
    );

    expect(closed).toBe(true);
    expect(deps.timeEntry.updateMany.mock.calls[0][0].data).toMatchObject({
      totalMinutes: 540, // 570 elapsed - 30 break
      status: 'completed',
      updatedBy: 'system:cron',
    });
    expect(deps.recordOutcome).toHaveBeenCalledWith('cron_location_hours_closed');
    expect(deps.broadcast).toHaveBeenCalledWith(
      'timeEntry',
      'clockOut',
      expect.objectContaining({
        autoClockOutAtLocationWorkingEnd: true,
        geofenceId: 'gf_1',
      }),
      expect.anything(),
    );
    expect(deps.info).toHaveBeenCalledWith(expect.stringContaining('Sitari Country Estate'));
  });

  it('returns false when the entry is no longer active', async () => {
    const deps = makeDeps(0);
    const closed = await closeActiveEntryAtWorkingEnd(
      entry(),
      new Date('2026-09-15T15:30:00.000Z'),
      'company default hours',
      deps,
    );
    expect(closed).toBe(false);
    expect(deps.broadcast).not.toHaveBeenCalled();
  });
});

describe('closeStaleActiveEntry', () => {
  it('stamps clockOut at clockIn + threshold, not the detection moment', async () => {
    const deps = makeDeps();
    await closeStaleActiveEntry(entry({ breakMinutes: null }), 16, deps);

    const call = deps.timeEntry.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'te_1' });
    expect(call.data.clockOut).toEqual(new Date(clockIn.getTime() + 16 * 3_600_000));
    expect(call.data.totalMinutes).toBe(16 * 60);
    expect(call.data.updatedBy).toBe('system:cron');
    expect(deps.recordOutcome).toHaveBeenCalledWith('cron_stale_closed');
    expect(deps.broadcast).toHaveBeenCalledWith(
      'TimeEntry',
      'auto_closed',
      expect.objectContaining({ id: 'te_1', autoClockOut: true }),
      expect.anything(),
    );
  });

  it('subtracts break minutes from the capped duration', async () => {
    const deps = makeDeps();
    await closeStaleActiveEntry(entry({ breakMinutes: 60 }), 16, deps);
    expect(deps.timeEntry.update.mock.calls[0][0].data.totalMinutes).toBe(16 * 60 - 60);
  });
});

describe('markShiftNoShow', () => {
  it('sets no_show, appends the audit note and broadcasts scoped', async () => {
    const deps = makeDeps();
    const now = new Date('2026-09-15T10:00:00.000Z');
    await markShiftNoShow(shift({ notes: 'Prior' }), now, deps);

    expect(deps.shift.update).toHaveBeenCalledWith({
      where: { id: 'sh_1' },
      data: {
        status: 'no_show',
        notes: `Prior\n[Auto] Marked as no-show at ${now.toISOString()}`,
      },
    });
    expect(deps.broadcast).toHaveBeenCalledWith(
      'Shift',
      'no_show',
      { id: 'sh_1', employeeId: 'emp_1', date: '2026-09-15' },
      { companyProfileId: 'cp_1', branch: 'Sandton HQ', department: 'General' },
    );
  });
});
