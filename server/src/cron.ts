/**
 * Cron Job Runner
 * ---------------
 * Background jobs for shift & time-entry lifecycle management:
 * - No-show detection (2+ hours past shift start)
 * - Shift-end auto clock-out (closes active entries at scheduled shift end)
 * - Stale active time-entry auto-close (forgotten clock-outs)
 * - Retention purge (AuditLog is NEVER purged; no purgeable entities currently registered)
 * - Stale SSE connection pruning
 *
 * Uses CronLock table with atomic SQL lease validation for distributed locking.
 */

import { randomUUID } from 'crypto';
import prisma from './prisma.js';
import { broadcastScoped, pruneStaleConnections } from './sse.js';
import {
  getBusinessTimezone,
  businessNow,
  timeStrToMinutes,
  isPastGraceDeadline,
  isShiftEndReached,
  addBusinessDays,
  businessTimeToDate,
} from './timezone.js';
import { parseDate } from './overlap.js';

const INSTANCE_ID = randomUUID();
const NO_SHOW_GRACE_MINUTES = 120; // 2 hours
/** Active time entries older than this are auto-closed (forgotten clock-out). */
const STALE_ACTIVE_ENTRY_MAX_HOURS = 16;

/**
 * Attempt to acquire a distributed lock for a cron job.
 * Uses atomic conditional upsert/update to prevent race conditions
 * across distributed horizontal node clusters.
 */
async function acquireLock(jobName: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const id = randomUUID();

  try {
    const rowsAffected = await prisma.$executeRaw`
      INSERT INTO "CronLock" ("id", "jobName", "acquiredBy", "acquiredAt", "expiresAt")
      VALUES (${id}, ${jobName}, ${INSTANCE_ID}, ${now}, ${expiresAt})
      ON CONFLICT ("jobName") DO UPDATE
      SET "acquiredBy" = ${INSTANCE_ID}, "acquiredAt" = ${now}, "expiresAt" = ${expiresAt}
      WHERE "CronLock"."expiresAt" < ${now}
    `;
    return rowsAffected > 0;
  } catch (err) {
    console.warn('[cron] Lock acquisition error:', err);
    return false;
  }
}

/**
 * Release a distributed lock held by this instance.
 */
async function releaseLock(jobName: string): Promise<void> {
  try {
    await prisma.cronLock.deleteMany({
      where: { jobName, acquiredBy: INSTANCE_ID },
    });
  } catch {
    // Lock may have expired or been taken by another instance
  }
}

/**
 * Purge records that exceed retention policy thresholds (if autoPurge is enabled).
 *
 * SECURITY/COMPLIANCE: AuditLog is treated as an append-only compliance record
 * and is NEVER auto-purged, regardless of any RetentionPolicy row. Archival to
 * cold storage is an explicit operational task, not a cron side-effect.
 *
 * NOTE: WebhookDeliveryLog purging was removed along with the dead
 * WebhookDeliveryLog model. The RetentionPolicy table is retained as the
 * extension point for future purgeable entities.
 */
async function purgeRetentionPolicies(): Promise<void> {
  const jobName = 'retention-policy-purge';
  if (!(await acquireLock(jobName, 120_000))) return;

  try {
    const policies = await prisma.retentionPolicy.findMany({
      where: { autoPurge: true },
    });

    for (const policy of policies) {
      if (policy.retentionDays <= 0) continue;

      if (policy.entity === 'AuditLog') {
        // AuditLog is immutable/append-only: never purge. Log the skip so
        // operators know the policy exists but is intentionally not enforced.
        console.log(`[cron] Retention policy for AuditLog ignored (append-only compliance record; archive manually).`);
      }
      // No other purgeable entities are currently registered.
    }
  } catch (err) {
    console.error('[cron] Retention policy purge error:', err);
  } finally {
    await releaseLock(jobName);
  }
}

/**
 * Close stale active time entries.
 * If an employee forgets to clock out (dead phone, walked off site), the
 * entry would otherwise stay "active" forever and block their next clock-in
 * (partial unique index on active entries). Auto-close after
 * STALE_ACTIVE_ENTRY_MAX_HOURS with a system note.
 */
async function closeStaleActiveTimeEntries(): Promise<void> {
  const jobName = 'stale-active-time-entry-close';
  if (!(await acquireLock(jobName, 120_000))) return;

  try {
    const cutoff = new Date(Date.now() - STALE_ACTIVE_ENTRY_MAX_HOURS * 3_600_000);
    const stale = await prisma.timeEntry.findMany({
      where: { status: 'active', clockIn: { lt: cutoff } },
    });

    for (const entry of stale) {
      const clockOut = new Date(entry.clockIn.getTime() + STALE_ACTIVE_ENTRY_MAX_HOURS * 3_600_000);
      const rawHours = (clockOut.getTime() - entry.clockIn.getTime()) / 3_600_000;
      const breakHours = (entry.breakMinutes ?? 0) / 60;
      const totalHours = Math.max(0, Math.round((rawHours - breakHours) * 100) / 100);

      await prisma.timeEntry.update({
        where: { id: entry.id },
        data: {
          status: 'completed',
          clockOut,
          totalHours,
          isManualOverride: true,
          updatedBy: 'system:cron',
        },
      });

      broadcastScoped(
        'TimeEntry',
        'auto_closed',
        { id: entry.id, employeeEmail: entry.employeeEmail, totalHours },
        {
          companyProfileId: entry.companyProfileId,
          branch: entry.branch,
          department: entry.department,
        }
      );

      console.log(`[cron] Auto-closed stale active time entry ${entry.id} (${entry.employeeEmail}).`);
    }
  } catch (err) {
    console.error('[cron] Stale active time-entry close error:', err);
  } finally {
    await releaseLock(jobName);
  }
}

/**
 * Auto clock-out at scheduled shift end.
 * When a manager has scheduled a shift with an end time and the employee is
 * still clocked in as that end passes, the active time entry is closed and its
 * clockOut stamped at the EXACT scheduled end instant — even when detection is
 * delayed (cron cadence, instance restart). This captures accurate hours: an
 * employee who forgets to logout cannot claim time beyond the scheduled end.
 *
 * Employees without a scheduled shift (or whose shift has not ended yet) are
 * untouched — the standard auto/manual clock-out flows remain in force.
 */
async function autoClockOutAtShiftEnd(): Promise<void> {
  const jobName = 'shift-end-auto-clock-out';
  if (!(await acquireLock(jobName, 120_000))) return;

  try {
    const now = new Date();

    // All comparisons use the configured business timezone, matching the
    // convention used by no-show detection.
    const tz = getBusinessTimezone();
    const biz = businessNow(tz, now);
    const yesterdayBiz = businessNow(tz, new Date(now.getTime() - 24 * 60 * 60_000));

    // Today's candidates PLUS yesterday's — catches shift ends that cross
    // midnight (e.g. a 22:00–06:00 shift) and backfills after cron downtime
    // (clockOut is still stamped at the scheduled end, not the detection time).
    const candidates = await prisma.shift.findMany({
      where: {
        status: { in: ['scheduled', 'active'] },
        date: { in: [parseDate(biz.dateStr), parseDate(yesterdayBiz.dateStr)] },
        endTime: { not: null },
        employeeEmail: { not: null },
      },
    });

    for (const shift of candidates) {
      if (!shift.employeeEmail) continue;
      const endMinutes = timeStrToMinutes(shift.endTime);
      if (endMinutes === null) continue;

      // endTime <= startTime means the shift crosses midnight (e.g. 22:00–06:00)
      // and ends on the next calendar day.
      const startMinutes = timeStrToMinutes(shift.startTime);
      const crossesMidnight = startMinutes !== null && endMinutes <= startMinutes;

      const shiftDateStr = shift.date.toISOString().slice(0, 10);
      if (
        !isShiftEndReached({
          nowDateStr: biz.dateStr,
          nowMinutesOfDay: biz.minutesOfDay,
          shiftDateStr,
          endMinutes,
          crossesMidnight,
        })
      ) {
        continue;
      }

      const activeEntry = await prisma.timeEntry.findFirst({
        where: { employeeEmail: shift.employeeEmail, status: 'active' },
        orderBy: { clockIn: 'desc' },
      });
      if (!activeEntry) continue;

      // The exact scheduled end instant in the business timezone. Stamping the
      // scheduled end (rather than the detection moment) keeps recorded hours
      // correct even if this job notices late.
      const endDateStr = crossesMidnight ? addBusinessDays(shiftDateStr, 1) : shiftDateStr;
      const clockOut = businessTimeToDate(tz, endDateStr, endMinutes);

      // Employee clocked in at/after the scheduled end — this session is not
      // bounded by the shift; leave it to the standard clock-out flows.
      if (activeEntry.clockIn.getTime() >= clockOut.getTime()) continue;

      const breakHours = (activeEntry.breakMinutes ?? 0) / 60;
      const rawHours = (clockOut.getTime() - activeEntry.clockIn.getTime()) / 3_600_000;
      const totalHours = Math.max(0, Math.round((rawHours - breakHours) * 100) / 100);

      // Optimistic guard: only close if still active — a concurrent manual
      // clock-out must never be overwritten.
      const closed = await prisma.timeEntry.updateMany({
        where: { id: activeEntry.id, status: 'active' },
        data: {
          clockOut,
          status: 'completed',
          totalHours,
          isManualOverride: true,
          updatedBy: 'system:cron',
        },
      });
      if (closed.count === 0) continue;

      await prisma.shift.update({
        where: { id: shift.id },
        data: {
          notes: shift.notes
            ? `${shift.notes}\n[Auto] Auto clock-out applied at scheduled shift end (${shift.endTime}) — closed time entry ${activeEntry.id}`
            : `[Auto] Auto clock-out applied at scheduled shift end (${shift.endTime}) — closed time entry ${activeEntry.id}`,
        },
      });

      broadcastScoped(
        'timeEntry',
        'clockOut',
        {
          id: activeEntry.id,
          employeeEmail: activeEntry.employeeEmail,
          clockOut: clockOut.toISOString(),
          totalHours,
          status: 'completed',
          autoClockOutAtShiftEnd: true,
        },
        {
          companyProfileId: activeEntry.companyProfileId,
          branch: activeEntry.branch,
          department: activeEntry.department,
        }
      );

      console.log(
        `[cron] Auto clock-out at shift end: entry ${activeEntry.id} (${activeEntry.employeeEmail}) closed at ${shift.endTime} for shift ${shift.id}.`
      );
    }
  } catch (err) {
    console.error('[cron] Shift-end auto clock-out error:', err);
  } finally {
    await releaseLock(jobName);
  }
}

async function detectNoShows(): Promise<void> {
  const jobName = 'no-show-detection';
  if (!(await acquireLock(jobName, 120_000))) return;

  try {
    const now = new Date();

    // All wall-clock comparisons happen in the configured business timezone
    // (CRON_TIMEZONE; defaults to the process timezone). This keeps no-show
    // detection correct even if the host/container timezone differs from the
    // business locale. Dates are stored at UTC noon (parseDate convention),
    // so the query uses the same convention to avoid day shifting.
    const tz = getBusinessTimezone();
    const biz = businessNow(tz, now);
    const yesterdayBiz = businessNow(tz, new Date(now.getTime() - 24 * 60 * 60_000));

    // Today's candidates PLUS yesterday's — catches grace windows that cross
    // midnight (e.g. a 23:00 shift with a 2h grace deadline at 01:00) and
    // backfills if the job was briefly down.
    const candidates = await prisma.shift.findMany({
      where: {
        status: 'scheduled',
        date: { in: [parseDate(biz.dateStr), parseDate(yesterdayBiz.dateStr)] },
        startTime: { not: null },
      },
      include: { employee: { select: { email: true } } },
    });

    for (const shift of candidates) {
      const startMinutes = timeStrToMinutes(shift.startTime);
      if (startMinutes === null) continue;

      const shiftDateStr = shift.date.toISOString().slice(0, 10);
      const isPreviousDay = shiftDateStr !== biz.dateStr;

      const pastGrace = isPastGraceDeadline({
        nowMinutesOfDay: biz.minutesOfDay,
        shiftStartMinutes: startMinutes,
        graceMinutes: NO_SHOW_GRACE_MINUTES,
        isPreviousDay,
      });
      if (!pastGrace) continue;

      // Guard: if the employee already has a time entry on this date they
      // DID show up — a stale 'scheduled' shift row must not become no_show.
      if (shift.employee?.email) {
        const worked = await prisma.timeEntry.findFirst({
          where: { employeeEmail: shift.employee.email, date: shift.date },
          select: { id: true },
        });
        if (worked) continue;
      }

      await prisma.shift.update({
        where: { id: shift.id },
        data: {
          status: 'no_show',
          notes: shift.notes
            ? `${shift.notes}\n[Auto] Marked as no-show at ${now.toISOString()}`
            : `[Auto] Marked as no-show at ${now.toISOString()}`,
        },
      });

      broadcastScoped(
        'Shift',
        'no_show',
        { id: shift.id, employeeId: shift.employeeId, date: shiftDateStr },
        {
          companyProfileId: shift.companyProfileId,
          branch: shift.branch,
          department: shift.department,
        }
      );

      console.log(`[cron] Shift ${shift.id} marked as no_show`);
    }
  } catch (err) {
    console.error('[cron] No-show detection error:', err);
  } finally {
    await releaseLock(jobName);
  }
}

let cronInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the cron runner. Runs every 60 seconds.
 */
export function startCron(): void {
  if (cronInterval) return;

  console.log('[cron] Starting background job runner (60s interval)');

  cronInterval = setInterval(async () => {
    await autoClockOutAtShiftEnd();
    await detectNoShows();
    await purgeRetentionPolicies();
    await closeStaleActiveTimeEntries();
    pruneStaleConnections();
  }, 60_000);

  // Run once immediately
  autoClockOutAtShiftEnd().catch(console.error);
  detectNoShows().catch(console.error);
  purgeRetentionPolicies().catch(console.error);
  closeStaleActiveTimeEntries().catch(console.error);
}

/**
 * Stop the cron runner.
 */
export function stopCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    console.log('[cron] Stopped background job runner');
  }
}
