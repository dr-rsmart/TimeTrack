/**
 * Scheduling & attendance lifecycle transitions (application layer).
 *
 * Phase 2 extraction (2026-09-15, completes REBUILD_STATUS slice 3): the cron
 * runner keeps distributed locking, candidate queries and business-time
 * guards; the persisted state transitions live here so they are unit-testable
 * (dependency-injected) and reusable outside cron.
 *
 * Behavior is preserved 1:1 from the previous cron.ts loop bodies — same
 * optimistic guards, same SSE event names/payloads, same metrics outcomes,
 * same push notifications, same audit notes.
 */
import prisma from '../prisma.js';
import { broadcastScoped } from '../sse.js';
import { calculateWorkedDuration } from '../domain/duration.js';
import { recordAutoClockOutcome } from '../metrics.js';
import { notifyEmployeePush } from '../push.js';
import { logger } from '../logger.js';

/** Minimal structural shape of an active TimeEntry needed by transitions. */
export interface ActiveEntryRef {
  id: string;
  clockIn: Date;
  breakMinutes: number | null;
  employeeEmail: string;
  companyProfileId: string | null;
  branch: string | null;
  department: string | null;
  geofenceId?: string | null;
}

/** Minimal structural shape of a Shift needed by transitions. */
export interface ShiftRef {
  id: string;
  date: Date;
  endTime: string | null;
  notes: string | null;
  employeeId: string | null;
  companyProfileId: string | null;
  branch: string | null;
  department: string | null;
}

export interface SchedulingDeps {
  timeEntry: {
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
  shift: {
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  broadcast: typeof broadcastScoped;
  recordOutcome: typeof recordAutoClockOutcome;
  push: typeof notifyEmployeePush;
  info: (msg: string) => void;
}

/**
 * Production dependencies. The prisma delegates are exposed via getters so
 * every access re-routes through the ambient-transaction proxy (the RLS
 * bridge) — capturing them once at module load would pin them to the
 * non-transactional client.
 */
export const defaultSchedulingDeps: SchedulingDeps = {
  get timeEntry() {
    return prisma.timeEntry as unknown as SchedulingDeps['timeEntry'];
  },
  get shift() {
    return prisma.shift as unknown as SchedulingDeps['shift'];
  },
  broadcast: (...args) => broadcastScoped(...args),
  recordOutcome: (outcome) => recordAutoClockOutcome(outcome),
  push: (...args) => notifyEmployeePush(...args),
  info: (msg) => logger.info(msg),
};

function entryScope(entry: ActiveEntryRef) {
  return {
    companyProfileId: entry.companyProfileId,
    branch: entry.branch,
    department: entry.department,
  };
}

/**
 * Close an active entry at its scheduled shift end (optimistic: only when
 * still active — a concurrent manual clock-out must never be overwritten).
 * Returns true when THIS transition closed the entry.
 */
export async function closeActiveEntryAtShiftEnd(
  entry: ActiveEntryRef,
  shift: ShiftRef,
  clockOut: Date,
  deps: SchedulingDeps = defaultSchedulingDeps,
): Promise<boolean> {
  const actualDuration = calculateWorkedDuration(entry.clockIn, clockOut, entry.breakMinutes ?? 0);

  const closed = await deps.timeEntry.updateMany({
    where: { id: entry.id, status: 'active' },
    data: {
      clockOut,
      status: 'completed',
      totalMinutes: actualDuration.totalMinutes,
      totalHours: actualDuration.totalHours,
      isManualOverride: true,
      updatedBy: 'system:cron',
    },
  });
  if (closed.count === 0) return false;

  deps.recordOutcome('cron_shift_end_closed');
  void deps.push(
    entry.employeeEmail,
    'Automatic Clock Out',
    `Your shift ended at ${shift.endTime} and you were clocked out automatically.`,
    { type: 'auto_clock_out', entryId: entry.id },
  );

  const note = `[Auto] Auto clock-out applied at scheduled shift end (${shift.endTime}) — closed time entry ${entry.id}`;
  await deps.shift.update({
    where: { id: shift.id },
    data: { notes: shift.notes ? `${shift.notes}\n${note}` : note },
  });

  deps.broadcast(
    'timeEntry',
    'clockOut',
    {
      id: entry.id,
      employeeEmail: entry.employeeEmail,
      clockOut: clockOut.toISOString(),
      totalMinutes: actualDuration.totalMinutes,
      totalHours: actualDuration.totalHours,
      status: 'completed',
      autoClockOutAtShiftEnd: true,
      autoClockOut: true,
    },
    entryScope(entry),
  );

  deps.info(
    `[cron] Auto clock-out at shift end: entry ${entry.id} (${entry.employeeEmail}) closed at ${shift.endTime} for shift ${shift.id}.`,
  );
  return true;
}

/**
 * Close an active entry at the configured working end of the location where
 * the employee clocked in (or company-default hours). Optimistic guard as
 * above. Returns true when THIS transition closed the entry.
 */
export async function closeActiveEntryAtWorkingEnd(
  entry: ActiveEntryRef,
  clockOut: Date,
  locationName: string,
  deps: SchedulingDeps = defaultSchedulingDeps,
): Promise<boolean> {
  const actualDuration = calculateWorkedDuration(entry.clockIn, clockOut, entry.breakMinutes ?? 0);

  const closed = await deps.timeEntry.updateMany({
    where: { id: entry.id, status: 'active' },
    data: {
      clockOut,
      status: 'completed',
      totalMinutes: actualDuration.totalMinutes,
      totalHours: actualDuration.totalHours,
      isManualOverride: true,
      updatedBy: 'system:cron',
    },
  });
  if (closed.count === 0) return false;

  deps.recordOutcome('cron_location_hours_closed');
  void deps.push(
    entry.employeeEmail,
    'Automatic Clock Out',
    'You were clocked out automatically at the configured workday end.',
    { type: 'auto_clock_out', entryId: entry.id },
  );

  deps.broadcast(
    'timeEntry',
    'clockOut',
    {
      id: entry.id,
      employeeEmail: entry.employeeEmail,
      clockOut: clockOut.toISOString(),
      totalMinutes: actualDuration.totalMinutes,
      totalHours: actualDuration.totalHours,
      status: 'completed',
      autoClockOutAtLocationWorkingEnd: true,
      autoClockOut: true,
      geofenceId: entry.geofenceId ?? null,
    },
    entryScope(entry),
  );

  deps.info(
    `[cron] Auto clock-out at working end: entry ${entry.id} (${entry.employeeEmail}) closed at ${clockOut.toISOString()} for ${locationName}.`,
  );
  return true;
}

/**
 * Auto-close a forgotten clock-out after the stale threshold. clockOut is
 * stamped at clockIn + staleMaxHours (not the detection moment).
 */
export async function closeStaleActiveEntry(
  entry: ActiveEntryRef,
  staleMaxHours: number,
  deps: SchedulingDeps = defaultSchedulingDeps,
): Promise<void> {
  const clockOut = new Date(entry.clockIn.getTime() + staleMaxHours * 3_600_000);
  const actualDuration = calculateWorkedDuration(entry.clockIn, clockOut, entry.breakMinutes ?? 0);

  await deps.timeEntry.update({
    where: { id: entry.id },
    data: {
      status: 'completed',
      clockOut,
      totalMinutes: actualDuration.totalMinutes,
      totalHours: actualDuration.totalHours,
      isManualOverride: true,
      updatedBy: 'system:cron',
    },
  });
  deps.recordOutcome('cron_stale_closed');
  void deps.push(
    entry.employeeEmail,
    'Automatic Clock Out',
    'Your session was closed automatically after exceeding the maximum active duration.',
    { type: 'auto_clock_out', entryId: entry.id },
  );

  deps.broadcast(
    'TimeEntry',
    'auto_closed',
    {
      id: entry.id,
      employeeEmail: entry.employeeEmail,
      totalMinutes: actualDuration.totalMinutes,
      totalHours: actualDuration.totalHours,
      autoClockOut: true,
    },
    entryScope(entry),
  );

  deps.info(`[cron] Auto-closed stale active time entry ${entry.id} (${entry.employeeEmail}).`);
}

/** Mark a scheduled shift as no_show once the grace deadline has passed. */
export async function markShiftNoShow(
  shift: ShiftRef,
  now: Date,
  deps: SchedulingDeps = defaultSchedulingDeps,
): Promise<void> {
  const note = `[Auto] Marked as no-show at ${now.toISOString()}`;
  await deps.shift.update({
    where: { id: shift.id },
    data: {
      status: 'no_show',
      notes: shift.notes ? `${shift.notes}\n${note}` : note,
    },
  });

  deps.broadcast(
    'Shift',
    'no_show',
    {
      id: shift.id,
      employeeId: shift.employeeId,
      date: shift.date.toISOString().slice(0, 10),
    },
    {
      companyProfileId: shift.companyProfileId,
      branch: shift.branch,
      department: shift.department,
    },
  );

  deps.info(`[cron] Shift ${shift.id} marked as no_show`);
}
