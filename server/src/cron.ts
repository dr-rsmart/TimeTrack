/**
 * Cron Job Runner
 * ---------------
 * Background jobs for shift & time-entry lifecycle management:
 * - No-show detection (2+ hours past shift start)
 * - Stale active time-entry auto-close (forgotten clock-outs)
 * - Retention purge (AuditLog is NEVER purged; no purgeable entities currently registered)
 * - Stale SSE connection pruning
 *
 * Uses CronLock table with atomic SQL lease validation for distributed locking.
 */

import { randomUUID } from 'crypto';
import prisma from './prisma.js';
import { broadcastScoped, pruneStaleConnections } from './sse.js';

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

async function detectNoShows(): Promise<void> {
  const jobName = 'no-show-detection';
  if (!(await acquireLock(jobName, 120_000))) return;

  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // Find scheduled shifts for today where start_time + grace < now.
    // Dates are stored at UTC noon (see parseDate in routes/shifts.ts) to
    // avoid timezone-induced day shifting — the query must use the same
    // convention or it will miss/mismatch rows.
    const candidates = await prisma.shift.findMany({
      where: {
        status: 'scheduled',
        date: new Date(todayStr + 'T12:00:00Z'),
        startTime: { not: null },
      },
      include: { employee: { select: { email: true } } },
    });

    for (const shift of candidates) {
      if (!shift.startTime) continue;

      const [hours, minutes] = shift.startTime.split(':').map(Number);
      const shiftStart = new Date(now);
      shiftStart.setHours(hours, minutes, 0, 0);

      const graceDeadline = new Date(shiftStart.getTime() + NO_SHOW_GRACE_MINUTES * 60_000);

      if (now > graceDeadline) {
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
          { id: shift.id, employeeId: shift.employeeId, date: todayStr },
          {
            companyProfileId: shift.companyProfileId,
            branch: shift.branch,
            department: shift.department,
          }
        );

        console.log(`[cron] Shift ${shift.id} marked as no_show`);
      }
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
    await detectNoShows();
    await purgeRetentionPolicies();
    await closeStaleActiveTimeEntries();
    pruneStaleConnections();
  }, 60_000);

  // Run once immediately
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
