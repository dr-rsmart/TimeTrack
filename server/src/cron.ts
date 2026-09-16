/**
 * Cron Job Runner
 * ---------------
 * Background jobs for shift & time-entry lifecycle management:
 * - No-show detection (2+ hours past shift start)
 * - Shift-end auto clock-out (closes active entries at scheduled shift end)
 * - Stale active time-entry auto-close (forgotten clock-outs)
 * - Retention purge (AuditLog is NEVER purged; no purgeable entities currently registered)
 * - NativeRefreshToken hygiene prune (consumed/expired rows deleted after 24h)
 * - Stale SSE connection pruning
 *
 * Uses CronLock table with atomic SQL lease validation for distributed locking.
 */

import { randomUUID } from 'crypto';
import { logger } from './logger.js';
import prisma from './prisma.js';
import { pruneStaleConnections } from './sse.js';
import {
  getBusinessTimezone,
  businessNow,
  timeStrToMinutes,
  isPastGraceDeadline,
  isShiftEndReached,
  isReminderDue,
  addBusinessDays,
  businessTimeToDate,
} from './timezone.js';
import { notifyEmployeePush } from './push.js';
import { parseDate } from './overlap.js';
import { singleEmployeeIdentityFilter } from './domain/employeeIdentity.js';
import { resolveLocationWorkingEnd } from './locationWorkingHours.js';
import { runUnrestricted } from './tenantDatabase.js';
import { recordAutoClockOutcome, setAuditLogRows } from './metrics.js';
import {
  closeActiveEntryAtShiftEnd,
  closeActiveEntryAtWorkingEnd,
  closeStaleActiveEntry,
  markShiftNoShow,
} from './application/scheduling.js';

const INSTANCE_ID = randomUUID();
const NO_SHOW_GRACE_MINUTES = 120; // 2 hours
/** Active time entries older than this are auto-closed (forgotten clock-out). */
const STALE_ACTIVE_ENTRY_MAX_HOURS = 16;

async function reconcileOverdueActiveEntries(): Promise<void> {
  const overdueBefore = new Date(Date.now() - 12 * 3_600_000);
  const overdue = await prisma.timeEntry.count({
    where: { status: 'active', clockIn: { lt: overdueBefore } },
  });
  if (overdue > 0) {
    recordAutoClockOutcome('reconciliation_overdue_active');
    logger.warn(`[cron] Reconciliation found ${overdue} active entry(s) older than 12 hours.`);
  }
}

// ── AuditLog growth observability + opt-in archival ──────────────────────
// AuditLog is append-only and NEVER purged. Two operational aids live here:
//  1. a size gauge (timetrack_audit_log_rows) sampled every ~10 minutes so
//     Prometheus can alert on unbounded growth (C12 risk); and
//  2. an OPT-IN daily archival job that moves rows older than
//     AUDIT_ARCHIVE_OLDER_THAN_DAYS into AuditLogArchive (migration 11).
//     Archival stays an explicit operational decision: it only runs when
//     AUDIT_ARCHIVE_ENABLED=true is set by the operator. The manual tool
//     (`npm run audit:archive`) remains the preferred dry-run-first path.
const AUDIT_ARCHIVE_ENABLED = process.env.AUDIT_ARCHIVE_ENABLED === 'true';
const AUDIT_ARCHIVE_OLDER_THAN_DAYS = Number.parseInt(
  process.env.AUDIT_ARCHIVE_OLDER_THAN_DAYS ?? '365',
  10,
);
let lastAuditGrowthSampleMs = 0;
let lastAuditArchiveRunMs = 0;

async function sampleAuditLogGrowth(): Promise<void> {
  const now = Date.now();
  if (now - lastAuditGrowthSampleMs < 10 * 60_000) return;
  lastAuditGrowthSampleMs = now;
  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM "AuditLog"
    `;
    setAuditLogRows(Number(rows[0]?.count ?? 0));
  } catch (err) {
    logger.warn('[cron] AuditLog growth sample failed:', err);
  }
}

async function archiveAuditLogs(): Promise<void> {
  if (!AUDIT_ARCHIVE_ENABLED) return;
  const now = Date.now();
  if (now - lastAuditArchiveRunMs < 24 * 3_600_000) return;
  if (!(await acquireLock('audit-log-archive', 30 * 60_000))) return;

  try {
    lastAuditArchiveRunMs = now;
    const cutoff = new Date(now - AUDIT_ARCHIVE_OLDER_THAN_DAYS * 24 * 3_600_000);
    const archived = await prisma.$executeRaw`
      INSERT INTO "AuditLogArchive"
        ("id", "entity", "entityId", "action", "actorId", "actorEmail", "actorRole",
         "changes", "justification", "ipAddress", "branch", "department",
         "companyProfileId", "createdAt")
      SELECT "id", "entity", "entityId", "action", "actorId", "actorEmail", "actorRole",
             "changes"::jsonb, "justification", "ipAddress", "branch", "department",
             "companyProfileId", "createdAt"
      FROM "AuditLog" WHERE "createdAt" < ${cutoff}
      ON CONFLICT ("id") DO NOTHING;
    `;
    if (archived > 0) {
      await prisma.$executeRaw`DELETE FROM "AuditLog" WHERE "createdAt" < ${cutoff};`;
      logger.info(
        `[cron] Archived ${archived} AuditLog row(s) older than ${AUDIT_ARCHIVE_OLDER_THAN_DAYS} days. Record this run in docs/DATA_CHANGES.md.`,
      );
    }
  } catch (err) {
    logger.error('[cron] AuditLog archival error:', err);
  } finally {
    await releaseLock('audit-log-archive');
  }
}

// ── NativeRefreshToken hygiene ──────────────────────────────────────────
// The native shell rotates its refresh token on every use (revokedAt is
// stamped) and tokens expire after 30 days. Without pruning, the table grows
// unbounded with dead rows. Daily job with a 24h grace period (so recent rows
// remain visible for debugging): delete rows consumed or expired >24h ago.
const NATIVE_TOKEN_PRUNE_INTERVAL_MS = 24 * 3_600_000;
const NATIVE_TOKEN_PRUNE_GRACE_MS = 24 * 3_600_000;
let lastNativeTokenPruneRunMs = 0;

async function pruneNativeRefreshTokens(): Promise<void> {
  const now = Date.now();
  if (now - lastNativeTokenPruneRunMs < NATIVE_TOKEN_PRUNE_INTERVAL_MS) return;
  if (!(await acquireLock('native-refresh-token-prune', 10 * 60_000))) return;

  try {
    lastNativeTokenPruneRunMs = now;
    const cutoff = new Date(now - NATIVE_TOKEN_PRUNE_GRACE_MS);
    const deleted = await prisma.nativeRefreshToken.deleteMany({
      where: {
        OR: [{ revokedAt: { not: null, lt: cutoff } }, { expiresAt: { lt: cutoff } }],
      },
    });
    if (deleted.count > 0) {
      logger.info(`[cron] Pruned ${deleted.count} consumed/expired NativeRefreshToken row(s).`);
    }
  } catch (err) {
    logger.error('[cron] NativeRefreshToken prune error:', err);
  } finally {
    await releaseLock('native-refresh-token-prune');
  }
}

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
    logger.warn('[cron] Lock acquisition error:', err);
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
        logger.info(
          `[cron] Retention policy for AuditLog ignored (append-only compliance record; archive manually).`,
        );
      }
      // No other purgeable entities are currently registered.
    }
  } catch (err) {
    logger.error('[cron] Retention policy purge error:', err);
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
      await closeStaleActiveEntry(entry, STALE_ACTIVE_ENTRY_MAX_HOURS);
    }
  } catch (err) {
    logger.error('[cron] Stale active time-entry close error:', err);
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
 * Employees without a scheduled shift use the working hours configured on the
 * location where they clocked in. Assigned shift end times take precedence.
 */
async function autoClockOutAtShiftEnd(): Promise<void> {
  const jobName = 'shift-end-auto-clock-out';
  if (!(await acquireLock(jobName, 120_000))) return;

  // Cutover switch: when set to false, employees with NO assigned location keep
  // the legacy behaviour (only the 16h stale close applies). Use it during a
  // production cutover window so sessions that are already active are never
  // retro-closed by the new company-default end-of-day rule on first run.
  const companyDefaultCloseEnabled = process.env.COMPANY_DEFAULT_HOURS_CLOSE !== 'false';

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
        OR: [{ employeeId: { not: null } }, { employeeEmail: { not: null } }],
      },
    });

    for (const shift of candidates) {
      if (!shift.employeeId && !shift.employeeEmail) continue;
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
        where: {
          ...(shift.employeeId
            ? { employeeId: shift.employeeId }
            : { employeeId: null, employeeEmail: shift.employeeEmail! }),
          ...(shift.companyProfileId ? { companyProfileId: shift.companyProfileId } : {}),
          status: 'active',
        },
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

      // The optimistic guard, metrics, push, shift note, SSE broadcast and
      // logging live in the application layer (application/scheduling.ts).
      await closeActiveEntryAtShiftEnd(activeEntry, shift, clockOut);
    }

    // Employees without a scheduled shift use the working hours configured on
    // the exact location where they clocked in. A shift remains authoritative;
    // this fallback is skipped whenever an open scheduled/active shift with an
    // end time exists for the employee on the current business day.
    const locationEntries = await prisma.timeEntry.findMany({
      where: { status: 'active' },
      include: { geofence: true, companyProfile: { include: { settings: true } } },
    });
    const candidateDates = [parseDate(biz.dateStr), parseDate(yesterdayBiz.dateStr)];
    const openShifts = await prisma.shift.findMany({
      where: {
        status: { in: ['scheduled', 'active'] },
        date: { in: candidateDates },
        endTime: { not: null },
      },
      select: { employeeId: true, employeeEmail: true },
    });
    const openShiftKeys = new Set(
      openShifts.flatMap((shift) =>
        [
          shift.employeeId ? `id:${shift.employeeId}` : null,
          shift.employeeEmail ? `email:${shift.employeeEmail.toLowerCase()}` : null,
        ].filter((value): value is string => value !== null),
      ),
    );

    for (const entry of locationEntries) {
      const location = entry.geofence;
      if (!location && !companyDefaultCloseEnabled) continue;
      const companySettings = entry.companyProfile?.settings?.[0];
      const workingStartTime =
        location?.workingStartTime ?? companySettings?.defaultWorkingStartTime;
      const workingEndTime = location?.workingEndTime ?? companySettings?.defaultWorkingEndTime;
      const workingDays = location?.workingDays ?? companySettings?.defaultWorkingDays ?? [];
      if (!workingStartTime || !workingEndTime || workingDays.length === 0) continue;

      if (
        (entry.employeeId && openShiftKeys.has(`id:${entry.employeeId}`)) ||
        openShiftKeys.has(`email:${entry.employeeEmail.toLowerCase()}`)
      )
        continue;

      const clockOut = resolveLocationWorkingEnd({
        clockIn: entry.clockIn,
        timezone: tz,
        workingStartTime,
        workingEndTime,
        workingDays,
      });
      if (!clockOut || clockOut.getTime() > now.getTime()) continue;

      await closeActiveEntryAtWorkingEnd(
        entry,
        clockOut,
        location?.name ?? 'company default hours',
      );
    }
  } catch (err) {
    logger.error('[cron] Shift-end auto clock-out error:', err);
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
    // (CRON_TIMEZONE; defaults to Africa/Johannesburg). This keeps no-show
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
      if (shift.employeeId || shift.employee?.email) {
        const worked = await prisma.timeEntry.findFirst({
          where: {
            ...(shift.employeeId
              ? { employeeId: shift.employeeId }
              : { employeeId: null, employeeEmail: shift.employee!.email }),
            date: shift.date,
            ...(shift.companyProfileId ? { companyProfileId: shift.companyProfileId } : {}),
          },
          select: { id: true },
        });
        if (worked) continue;
      }

      await markShiftNoShow(shift, now);
    }
  } catch (err) {
    logger.error('[cron] No-show detection error:', err);
  } finally {
    await releaseLock(jobName);
  }
}

// ── Shift reminders (Feature #1) ─────────────────────────────────────────
// Push a notification ~5 minutes BEFORE the beginning and the ending of every
// scheduled shift. Employees with NO shift assigned fall back to their
// company's normal business hours (CompanySettings.defaultWorking*), matching
// the auto clock-out fallback semantics. Dedupe is per-instance in memory:
// the CronLock guarantees only one instance runs the job per tick, and keys
// are pruned after 3 hours so the map stays bounded.
const SHIFT_REMINDER_LEAD_MINUTES = 5;
const SHIFT_REMINDER_WINDOW_MINUTES = 2; // > 60s tick so jitter cannot skip a window
const sentShiftReminders = new Map<string, number>();

function pruneShiftReminderKeys(nowMs: number): void {
  for (const [key, sentAt] of sentShiftReminders) {
    if (nowMs - sentAt > 3 * 3_600_000) sentShiftReminders.delete(key);
  }
}

function fireShiftReminderOnce(key: string, email: string, title: string, body: string): void {
  if (sentShiftReminders.has(key)) return;
  sentShiftReminders.set(key, Date.now());
  void notifyEmployeePush(email, title, body, { type: 'shift_reminder' });
}

const WORKING_SHIFT_TYPES = new Set(['full_day', 'half_day']);

function weekdayName(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

async function sendShiftReminders(): Promise<void> {
  const jobName = 'shift-reminders';
  if (!(await acquireLock(jobName, 90_000))) return;

  try {
    const now = new Date();
    pruneShiftReminderKeys(now.getTime());
    const tz = getBusinessTimezone();
    const biz = businessNow(tz, now);
    const yesterdayBiz = businessNow(tz, new Date(now.getTime() - 24 * 60 * 60_000));

    // ── Shift-based reminders (today + yesterday for midnight-crossing ends) ──
    const shifts = await prisma.shift.findMany({
      where: {
        status: { in: ['scheduled', 'active'] },
        date: { in: [parseDate(biz.dateStr), parseDate(yesterdayBiz.dateStr)] },
      },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        shiftType: true,
        employeeEmail: true,
      },
    });

    for (const shift of shifts) {
      if (!shift.employeeEmail) continue;
      if (!WORKING_SHIFT_TYPES.has(shift.shiftType)) continue; // leave types: no reminders
      const shiftDateStr = shift.date.toISOString().slice(0, 10);

      // Start reminder — only for shifts dated today (a reminder before a
      // start that already passed yesterday is noise).
      const startMinutes = timeStrToMinutes(shift.startTime);
      if (
        shiftDateStr === biz.dateStr &&
        startMinutes !== null &&
        isReminderDue({
          nowMinutesOfDay: biz.minutesOfDay,
          eventMinutes: startMinutes,
          leadMinutes: SHIFT_REMINDER_LEAD_MINUTES,
          windowMinutes: SHIFT_REMINDER_WINDOW_MINUTES,
        })
      ) {
        fireShiftReminderOnce(
          `start:${shift.id}`,
          shift.employeeEmail,
          'Shift Starting Soon',
          `Your shift starts at ${shift.startTime} — ${SHIFT_REMINDER_LEAD_MINUTES} minutes to go.`,
        );
      }

      // End reminder — the effective end day may be tomorrow for overnight
      // shifts (e.g. 22:00–06:00), so yesterday's rows are included above.
      const endMinutes = timeStrToMinutes(shift.endTime);
      if (endMinutes !== null) {
        const crossesMidnight = startMinutes !== null && endMinutes <= startMinutes;
        const effectiveEndDateStr = crossesMidnight
          ? addBusinessDays(shiftDateStr, 1)
          : shiftDateStr;
        if (
          effectiveEndDateStr === biz.dateStr &&
          isReminderDue({
            nowMinutesOfDay: biz.minutesOfDay,
            eventMinutes: endMinutes,
            leadMinutes: SHIFT_REMINDER_LEAD_MINUTES,
            windowMinutes: SHIFT_REMINDER_WINDOW_MINUTES,
          })
        ) {
          fireShiftReminderOnce(
            `end:${shift.id}`,
            shift.employeeEmail,
            'Shift Ending Soon',
            `Your shift ends at ${shift.endTime} — ${SHIFT_REMINDER_LEAD_MINUTES} minutes to go.`,
          );
        }
      }
    }
    // ── Business-hours fallback: employees with NO shift assigned today ──
    // Normal business hours apply (CompanySettings.defaultWorking*), mirroring
    // the auto clock-out fallback. The employee query only runs when a company's
    // default start/end reminder window is actually due (≤2×/day/company).
    const dayName = weekdayName(biz.dateStr);
    const companySettings = await prisma.companySettings.findMany({
      where: { companyProfileId: { not: null } },
      select: {
        companyProfileId: true,
        defaultWorkingStartTime: true,
        defaultWorkingEndTime: true,
        defaultWorkingDays: true,
      },
    });

    for (const settings of companySettings) {
      if (!settings.companyProfileId) continue;
      if (!settings.defaultWorkingDays.includes(dayName)) continue;

      const startDue =
        timeStrToMinutes(settings.defaultWorkingStartTime) !== null &&
        isReminderDue({
          nowMinutesOfDay: biz.minutesOfDay,
          eventMinutes: timeStrToMinutes(settings.defaultWorkingStartTime)!,
          leadMinutes: SHIFT_REMINDER_LEAD_MINUTES,
          windowMinutes: SHIFT_REMINDER_WINDOW_MINUTES,
        });
      const endDue =
        timeStrToMinutes(settings.defaultWorkingEndTime) !== null &&
        isReminderDue({
          nowMinutesOfDay: biz.minutesOfDay,
          eventMinutes: timeStrToMinutes(settings.defaultWorkingEndTime)!,
          leadMinutes: SHIFT_REMINDER_LEAD_MINUTES,
          windowMinutes: SHIFT_REMINDER_WINDOW_MINUTES,
        });
      if (!startDue && !endDue) continue;

      // Employees of this company WITHOUT a working shift today.
      const scheduledToday = await prisma.shift.findMany({
        where: {
          companyProfileId: settings.companyProfileId,
          status: { in: ['scheduled', 'active'] },
          date: parseDate(biz.dateStr),
          shiftType: { in: ['full_day', 'half_day'] },
        },
        select: { employeeId: true, employeeEmail: true },
      });
      const scheduledKeys = new Set(
        scheduledToday.flatMap((s) =>
          [
            s.employeeId ? `id:${s.employeeId}` : null,
            s.employeeEmail ? `email:${s.employeeEmail.toLowerCase()}` : null,
          ].filter((v): v is string => v !== null),
        ),
      );
      const unscheduled = await prisma.employee.findMany({
        where: { companyProfileId: settings.companyProfileId, status: 'active' },
        select: { id: true, email: true },
      });

      for (const emp of unscheduled) {
        if (
          scheduledKeys.has(`id:${emp.id}`) ||
          scheduledKeys.has(`email:${emp.email.toLowerCase()}`)
        )
          continue;
        if (startDue) {
          fireShiftReminderOnce(
            `default-start:${settings.companyProfileId}:${biz.dateStr}:${emp.id}`,
            emp.email,
            'Workday Starting Soon',
            `Your workday starts at ${settings.defaultWorkingStartTime} — ${SHIFT_REMINDER_LEAD_MINUTES} minutes to go.`,
          );
        }
        if (endDue) {
          fireShiftReminderOnce(
            `default-end:${settings.companyProfileId}:${biz.dateStr}:${emp.id}`,
            emp.email,
            'Workday Ending Soon',
            `Your workday ends at ${settings.defaultWorkingEndTime} — ${SHIFT_REMINDER_LEAD_MINUTES} minutes to go.`,
          );
        }
      }
    }
  } catch (err) {
    logger.error('[cron] Shift reminder error:', err);
  } finally {
    await releaseLock(jobName);
  }
}

let cronInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the cron runner. Runs every 60 seconds.
 * Each job runs inside an unrestricted tenant transaction (RLS bridge) —
 * background work is a master/system concern and must see all tenants.
 */
export function startCron(): void {
  if (cronInterval) return;

  logger.info('[cron] Starting background job runner (60s interval)');

  const runJobs = async (): Promise<void> => {
    await runUnrestricted(async () => {
      await autoClockOutAtShiftEnd();
      await detectNoShows();
      await sendShiftReminders();
      await purgeRetentionPolicies();
      await closeStaleActiveTimeEntries();
      await reconcileOverdueActiveEntries();
      await sampleAuditLogGrowth();
      await archiveAuditLogs();
      await pruneNativeRefreshTokens();
      pruneStaleConnections();
    });
  };

  cronInterval = setInterval(() => {
    runJobs().catch((err: unknown) => logger.error(err));
  }, 60_000);

  // Run once immediately
  runJobs().catch((err: unknown) => logger.error(err));
}

/**
 * Stop the cron runner.
 */
export function stopCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    logger.info('[cron] Stopped background job runner');
  }
}
