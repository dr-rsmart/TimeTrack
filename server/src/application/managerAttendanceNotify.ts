/**
 * Manager attendance push + in-fence session re-open (Cycle 18)
 * ============================================================
 * 1. REAL-TIME MANAGER PUSH — the in-app Notification Centre only refreshes
 *    while a manager has the app open. Auto clock-in/out, late arrivals and
 *    early departures are now pushed (Expo + web push) to admins/managers of
 *    the SAME company as soon as the punch is committed. Tenant isolation is
 *    enforced by notifyCompanyManagersPush (hard companyProfileId filter).
 *
 * 2. IN-FENCE RE-OPEN — GPS drift at a fence edge can fire exit → enter
 *    minutes apart while the employee never left site. The reclock guard
 *    blocks re-entry inside 10 minutes; longer bounces still produced a
 *    second session. AUTOMATIC clock-ins now re-open the previous session
 *    instead when it: was closed today, was NOT closed by cron, was at the
 *    same location, and ended within AUTO_REOPEN_MERGE_MINUTES (default 60).
 *    Manual and manager punches never re-open — they are explicit.
 *
 * Everything here is best-effort: failures are logged, never thrown.
 */

import type { TimeEntry } from '@prisma/client';
import prisma from '../prisma.js';
import { logger } from '../logger.js';
import { notifyCompanyManagersPush } from '../push.js';
import {
  computeAttendanceCost,
  resolveExpectedWindow,
  collectEmployeeLocationSchedules,
} from '../domain/attendanceCost.js';
import { parseWorkingHoursSchedules } from '../workingHoursSchedules.js';
import { businessNow, getBusinessTimezone, timeStrToMinutes } from '../timezone.js';
import { ATTENDANCE_STATUS } from '../domain/attendance.js';

export const DEFAULT_AUTO_REOPEN_MERGE_MINUTES = 60;

export function getAutoReopenMergeMinutes(): number {
  const raw = process.env.AUTO_REOPEN_MERGE_MINUTES;
  if (raw === undefined || raw === '') return DEFAULT_AUTO_REOPEN_MERGE_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_AUTO_REOPEN_MERGE_MINUTES;
}

/** Pure decision: should an automatic clock-in at `now` re-open `previous`? */
export function shouldReopenPreviousSession(input: {
  previous: {
    clockOut: Date | null;
    status: string;
    updatedBy: string | null;
    geofenceId: string | null;
    dateStr: string;
  } | null;
  now: Date;
  todayStr: string;
  geofenceId: string | null;
  mergeMinutes: number;
}): boolean {
  const { previous, now, todayStr, geofenceId, mergeMinutes } = input;
  if (!previous || mergeMinutes <= 0) return false;
  if (previous.status !== ATTENDANCE_STATUS.COMPLETED || !previous.clockOut) return false;
  if (previous.updatedBy === 'system:cron') return false;
  if (previous.dateStr !== todayStr) return false;
  if (!geofenceId || previous.geofenceId !== geofenceId) return false;
  const gapMs = now.getTime() - previous.clockOut.getTime();
  return gapMs >= 0 && gapMs < mergeMinutes * 60_000;
}

/** Durable once-only claim (ReminderLog unique dedupeKey, migration 24). */
async function claimOnce(key: string): Promise<boolean> {
  try {
    await prisma.reminderLog.create({ data: { dedupeKey: key, kind: 'manager_alert' } });
    return true;
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') return false;
    return true; // fail open: a dedupe error must never suppress an alert
  }
}

/**
 * Re-open the most recent completed session if shouldReopenPreviousSession
 * allows it. Returns the re-opened entry, or null (caller creates a new one).
 */
export async function tryReopenInFenceSession(input: {
  companyProfileId: string;
  employeeId: string;
  geofenceId: string | null;
  now: Date;
  actorId: string;
}): Promise<TimeEntry | null> {
  try {
    const tz = getBusinessTimezone();
    const previous = await prisma.timeEntry.findFirst({
      where: {
        companyProfileId: input.companyProfileId,
        employeeId: input.employeeId,
        status: ATTENDANCE_STATUS.COMPLETED,
        clockOut: { not: null },
      },
      orderBy: { clockOut: 'desc' },
    });
    const ok = shouldReopenPreviousSession({
      previous: previous
        ? {
            clockOut: previous.clockOut,
            status: previous.status,
            updatedBy: previous.updatedBy,
            geofenceId: previous.geofenceId,
            dateStr: previous.date.toISOString().slice(0, 10),
          }
        : null,
      now: input.now,
      todayStr: businessNow(tz, input.now).dateStr,
      geofenceId: input.geofenceId,
      mergeMinutes: getAutoReopenMergeMinutes(),
    });
    if (!ok || !previous) return null;
    // Conditional update: only re-open if still completed (race-safe).
    const { count } = await prisma.timeEntry.updateMany({
      where: { id: previous.id, status: ATTENDANCE_STATUS.COMPLETED },
      data: {
        status: ATTENDANCE_STATUS.ACTIVE,
        clockOut: null,
        clockOutIdempotencyKey: null,
        totalMinutes: 0,
        totalHours: null,
        updatedBy: input.actorId,
      },
    });
    if (count === 0) return null;
    logger.info(`[attendance] re-opened in-fence session entry=${previous.id} (GPS bounce merge)`);
    return prisma.timeEntry.findUnique({ where: { id: previous.id } });
  } catch (err) {
    logger.warn('[attendance] in-fence re-open check failed (creating new session):', err);
    return null;
  }
}

/** Late/early minutes for a punch against the shared expected window. */
async function computeDeviation(
  entry: TimeEntry,
  kind: 'in' | 'out',
): Promise<{ minutes: number; reference: string } | null> {
  const tz = getBusinessTimezone();
  const dateStr = entry.date.toISOString().slice(0, 10);
  const [shift, settings, employee, geofence] = await Promise.all([
    prisma.shift.findFirst({
      where: {
        companyProfileId: entry.companyProfileId,
        date: entry.date,
        status: { not: 'cancelled' },
        OR: [
          ...(entry.employeeId ? [{ employeeId: entry.employeeId }] : []),
          { employeeEmail: { equals: entry.employeeEmail, mode: 'insensitive' as const } },
        ],
      },
      select: { startTime: true, endTime: true, shiftType: true },
    }),
    prisma.companySettings.findFirst({
      where: { companyProfileId: entry.companyProfileId },
      orderBy: { updatedAt: 'desc' },
      select: { defaultWorkingHoursSchedules: true, lateGraceMinutes: true },
    }),
    entry.employeeId
      ? prisma.employee.findUnique({
          where: { id: entry.employeeId },
          select: {
            geofence: { select: { workingHoursSchedules: true } },
            employeeGeofences: {
              select: { geofence: { select: { workingHoursSchedules: true } } },
            },
          },
        })
      : null,
    entry.geofenceId
      ? prisma.geofence.findUnique({
          where: { id: entry.geofenceId },
          select: { workingHoursSchedules: true },
        })
      : null,
  ]);
  const locationSchedules = geofence
    ? parseWorkingHoursSchedules(geofence.workingHoursSchedules)
    : employee
      ? collectEmployeeLocationSchedules(employee, parseWorkingHoursSchedules)
      : [];
  const window = resolveExpectedWindow({
    dateStr,
    shift,
    locationSchedules,
    companySchedules: parseWorkingHoursSchedules(settings?.defaultWorkingHoursSchedules),
  });
  if (window.source === 'none') return null;
  const startMin = timeStrToMinutes(window.start);
  const endMin = timeStrToMinutes(window.end);
  const crossesMidnight = startMin !== null && endMin !== null && endMin <= startMin;
  const inBiz = businessNow(tz, entry.clockIn);
  const outBiz = entry.clockOut ? businessNow(tz, entry.clockOut) : null;
  const cost = computeAttendanceCost({
    shiftStart: window.start,
    shiftEnd: window.end,
    shiftType: window.shiftType,
    crossesMidnight,
    clockInMinutesOfDay: inBiz.minutesOfDay,
    clockOutMinutesOfDay: kind === 'out' && outBiz ? outBiz.minutesOfDay : null,
    clockOutNextDay: outBiz !== null && outBiz.dateStr > dateStr,
    graceMinutes: settings?.lateGraceMinutes ?? 0,
  });
  const label =
    window.source === 'shift'
      ? 'shift'
      : window.source === 'location'
        ? 'location hours'
        : 'working hours';
  if (kind === 'in' && cost.lateMinutes > 0) {
    return { minutes: cost.lateMinutes, reference: `${label} ${window.start}` };
  }
  if (kind === 'out' && cost.earlyMinutes > 0) {
    return { minutes: cost.earlyMinutes, reference: `${label} ${window.end}` };
  }
  return null;
}

/**
 * Push the company's managers about a committed punch. Automatic punches
 * always notify; manual punches notify only when late/early. Deduped
 * durably per entry+kind so retries/replays never double-notify.
 */
export async function notifyManagersOfPunch(
  entry: TimeEntry,
  kind: 'in' | 'out',
  opts: { automatic: boolean },
): Promise<void> {
  try {
    const deviation = await computeDeviation(entry, kind);
    if (!opts.automatic && !deviation) return;
    if (!(await claimOnce(`punch-${kind}:${entry.id}`))) return;

    const name = entry.employeeName ?? entry.employeeEmail;
    const place = entry.geofenceName ? ` at ${entry.geofenceName}` : '';
    const auto = opts.automatic ? ' (auto)' : '';
    let title: string;
    let body: string;
    let alertType: string;
    if (kind === 'in') {
      alertType = deviation ? 'late_clock_in' : 'auto_clock_in';
      title = deviation ? `Late clock-in${auto}` : 'Auto clock-in';
      body = deviation
        ? `${name} clocked in ${deviation.minutes} min late${place} (vs ${deviation.reference}).`
        : `${name} was clocked in automatically${place}.`;
    } else {
      alertType = deviation ? 'early_clock_out' : 'auto_clock_out';
      title = deviation ? `Early clock-out${auto}` : 'Auto clock-out';
      body = deviation
        ? `${name} clocked out ${deviation.minutes} min early${place} (vs ${deviation.reference}).`
        : `${name} was clocked out automatically${place}.`;
    }
    await notifyCompanyManagersPush(entry.companyProfileId, title, body, {
      alertType,
      timeEntryId: entry.id,
    });
  } catch (err) {
    logger.warn('[attendance] manager punch push failed (punch already saved):', err);
  }
}
