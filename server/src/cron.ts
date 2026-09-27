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
import { notifyEmployeePush, notifyCompanyManagersPush } from './push.js';
import { parseDate } from './overlap.js';
import { singleEmployeeIdentityFilter } from './domain/employeeIdentity.js';
import { resolveWorkingEndFromSchedules } from './locationWorkingHours.js';
import { parseWorkingHoursSchedules, type WorkingHoursSchedule } from './workingHoursSchedules.js';
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
 * Prune the durable reminder/alert dedupe ledger.
 *
 * ReminderLog rows only need to outlive the longest plausible reminder window
 * (a 5-minute lead + the 2-minute window + CronLock churn + a restart). 72h is
 * generous headroom and keeps the table at roughly (reminders + alerts)/day × 3,
 * so it stays tiny forever. Runs under its own lock on the retention cadence.
 */
async function pruneReminderLogs(): Promise<void> {
  const jobName = 'reminder-log-prune';
  if (!(await acquireLock(jobName, 60_000))) return;
  try {
    const cutoff = new Date(Date.now() - 72 * 3_600_000);
    const { count } = await prisma.reminderLog.deleteMany({
      where: { sentAt: { lt: cutoff } },
    });
    if (count > 0) logger.info(`[cron] Pruned ${count} ReminderLog row(s) older than 72h.`);
  } catch (err) {
    logger.error('[cron] Reminder log prune error:', err);
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
 * True when the employee behind an active entry has ANY geofence assignment
 * (legacy Employee.geofenceId column or an EmployeeGeofence join row). The
 * company-default working-hours close must only apply to employees with no
 * location configured at all.
 */
async function employeeHasGeofenceAssignment(entry: {
  employeeId: string | null;
  employeeEmail: string;
  companyProfileId: string | null;
}): Promise<boolean> {
  const employee = await prisma.employee.findFirst({
    where: {
      ...(entry.companyProfileId ? { companyProfileId: entry.companyProfileId } : {}),
      ...(entry.employeeId
        ? { id: entry.employeeId }
        : { email: { equals: entry.employeeEmail, mode: 'insensitive' } }),
    },
    select: { id: true, geofenceId: true, employeeGeofences: { select: { id: true } } },
  });
  if (!employee) return false;
  return Boolean(employee.geofenceId) || employee.employeeGeofences.length > 0;
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

    // Employees without a scheduled shift use the per-day working-hours
    // schedules explicitly configured (migration 20) on the exact location
    // where they clocked in — location hours take PRIORITY. The company
    // default schedules only apply when the employee has NO geofence
    // assignment at all. An empty schedule list means "not explicitly
    // configured" and never auto-closes (fixes the implicit-17:00 closes).
    // A shift remains authoritative; this fallback is skipped whenever an
    // open scheduled/active shift with an end time exists for the employee
    // on the current business day.
    // BOUNDED SCAN (Cycle 17): this previously loaded EVERY active entry
    // platform-wide with two joins on every 60s tick — unbounded growth as the
    // tenant/employee count rises. Entries older than 48h are the stale-close
    // job's responsibility, not this working-end fallback, so they are excluded
    // here. A hard cap keeps a single tick from ballooning: reaching it is a
    // visibility event (warn + metric), never a silent truncation.
    const WORKING_END_SCAN_MAX_AGE_MS = 48 * 3_600_000;
    const WORKING_END_SCAN_MAX_ROWS = 1000;
    const locationEntries = await prisma.timeEntry.findMany({
      where: {
        status: 'active',
        clockIn: { gte: new Date(Date.now() - WORKING_END_SCAN_MAX_AGE_MS) },
      },
      include: { geofence: true, companyProfile: { include: { settings: true } } },
      orderBy: { clockIn: 'asc' },
      take: WORKING_END_SCAN_MAX_ROWS,
    });
    if (locationEntries.length >= WORKING_END_SCAN_MAX_ROWS) {
      recordAutoClockOutcome('working_end_scan_capped');
      logger.warn(
        `[cron] Shift-end auto clock-out scan hit the ${WORKING_END_SCAN_MAX_ROWS} active-entry cap. ` +
          'Consider increasing the cap or the job cadence if this recurs.',
      );
    }
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
      if (
        (entry.employeeId && openShiftKeys.has(`id:${entry.employeeId}`)) ||
        openShiftKeys.has(`email:${entry.employeeEmail.toLowerCase()}`)
      )
        continue;

      const location = entry.geofence;
      let schedules: WorkingHoursSchedule[];
      let hoursLabel: string;
      if (location) {
        schedules = parseWorkingHoursSchedules(location.workingHoursSchedules);
        hoursLabel = location.name;
      } else {
        if (!companyDefaultCloseEnabled) continue;
        // Company default hours ONLY fall into place when no geofence has
        // been set for the employee (legacy column or multi-location join).
        if (await employeeHasGeofenceAssignment(entry)) continue;
        const companySettings = entry.companyProfile?.settings?.[0];
        schedules = parseWorkingHoursSchedules(companySettings?.defaultWorkingHoursSchedules);
        hoursLabel = 'company default hours';
      }
      if (schedules.length === 0) continue; // not explicitly configured

      const clockOut = resolveWorkingEndFromSchedules({
        clockIn: entry.clockIn,
        timezone: tz,
        schedules,
      });
      if (!clockOut || clockOut.getTime() > now.getTime()) continue;

      await closeActiveEntryAtWorkingEnd(entry, clockOut, hoursLabel);
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
// the auto clock-out fallback semantics. Dedupe is two layers: an in-memory
// Map (fast path for same-process repeats, keys pruned after 3 h) AND a
// durable ReminderLog insert (Cycle 17) so a restart or second replica inside
// the reminder window cannot re-fire. The CronLock still guarantees only one
// instance runs the job per tick.
const SHIFT_REMINDER_LEAD_MINUTES = 5;
const SHIFT_REMINDER_WINDOW_MINUTES = 2; // > 60s tick so jitter cannot skip a window
const sentShiftReminders = new Map<string, number>();

function pruneShiftReminderKeys(nowMs: number): void {
  for (const [key, sentAt] of sentShiftReminders) {
    if (nowMs - sentAt > 3 * 3_600_000) sentShiftReminders.delete(key);
  }
}

function fireShiftReminderOnce(
  key: string,
  email: string,
  title: string,
  body: string,
  companyProfileId?: string | null,
): void {
  if (sentShiftReminders.has(key)) return;
  sentShiftReminders.set(key, Date.now());
  // companyProfileId scopes the push-token lookup AND lands `companyId` on the
  // Expo payload (spec §2), so a stale cross-company registration cannot receive
  // this reminder.
  // DURABLE DEDUPE (Cycle 17): the in-memory set only protects a single process.
  // claimReminderOnce() additionally records the key in ReminderLog and skips
  // the send if a prior process/replica already claimed it, so a deploy inside
  // the reminder window cannot fire twice. The push stays fire-and-forget.
  void claimReminderOnce(key, 'shift_reminder').then((first) => {
    if (first)
      void notifyEmployeePush(
        email,
        title,
        body,
        { type: 'shift_reminder' },
        companyProfileId ?? null,
      );
  });
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
        companyProfileId: true,
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
          shift.companyProfileId,
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
            shift.companyProfileId,
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

      // Employees of this company WITHOUT ANY shift today.
      //
      // LEAVE EXCLUSION (Cycle 17): this probe must NOT filter to working
      // shift types. It answers "is this employee already accounted for
      // today?", not "is this employee working today?". Filtering to
      // full_day/half_day made an employee on approved Leave/Sick/PTO look
      // UNSCHEDULED, so they fell through to the company-default branch below
      // and were told "Your workday starts at 08:00" while on leave.
      //
      // Note the deliberate asymmetry with the shift-based branch above, which
      // DOES filter by WORKING_SHIFT_TYPES: there we decide whether to send a
      // reminder FOR a shift (leave earns none); here we decide whether a
      // shift row exists AT ALL (leave must still suppress the fallback).
      const scheduledToday = await prisma.shift.findMany({
        where: {
          companyProfileId: settings.companyProfileId,
          status: { in: ['scheduled', 'active'] },
          date: parseDate(biz.dateStr),
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
            settings.companyProfileId,
          );
        }
        if (endDue) {
          fireShiftReminderOnce(
            `default-end:${settings.companyProfileId}:${biz.dateStr}:${emp.id}`,
            emp.email,
            'Workday Ending Soon',
            `Your workday ends at ${settings.defaultWorkingEndTime} — ${SHIFT_REMINDER_LEAD_MINUTES} minutes to go.`,
            settings.companyProfileId,
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

// ── Spec §3: real-time manager attendance-alert push (closed app) ─────────
// Pushes a notification to each company's admins/managers the moment a CRITICAL
// alert is flagged today: a duplicate punch (migration 23 flag) or a no-show
// shift (cron grace-deadline status). Late/early/absence stay in-app only —
// they are informational, while duplicates and no-shows need a manager decision.
// Dedupe is per-instance in memory (company:alertId), pruned after 3h — the same
// bounded-map pattern as the shift reminders above. Tenant isolation is enforced
// inside notifyCompanyManagersPush (hard companyProfileId filter on token lookup).
const sentManagerAlerts = new Map<string, number>();

function pruneManagerAlertKeys(nowMs: number): void {
  for (const [key, sentAt] of sentManagerAlerts) {
    if (nowMs - sentAt > 3 * 3_600_000) sentManagerAlerts.delete(key);
  }
}

function fireManagerAlertOnce(
  key: string,
  companyProfileId: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): void {
  if (sentManagerAlerts.has(key)) return;
  sentManagerAlerts.set(key, Date.now());
  // DURABLE DEDUPE (Cycle 17): same rationale as fireShiftReminderOnce — a
  // restart or a second replica within the alert window must not re-send a
  // duplicate/no-show alert a manager already actioned.
  void claimReminderOnce(key, 'manager_alert').then((first) => {
    if (first) void notifyCompanyManagersPush(companyProfileId, title, body, data);
  });
}

/**
 * Claim a cron reminder/alert dedupe key durably in ReminderLog.
 *
 * Returns `true` when this call is the FIRST claimant (the caller should send),
 * `false` when a previous process/replica already claimed it. The in-memory Map
 * handles same-process repeats synchronously; this table makes the claim survive
 * restarts and multi-replica scheduling. A P2002 unique-constraint violation is
 * the expected \"already sent\" signal, not an error.
 */
async function claimReminderOnce(key: string, kind: string): Promise<boolean> {
  try {
    await prisma.reminderLog.create({ data: { dedupeKey: key, kind } });
    return true;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2002') return false; // already claimed — skip the send
    logger.warn('[cron] Reminder dedupe claim failed (failing open to send):', err);
    return true; // a dedupe error must never suppress a legitimate reminder
  }
}

async function pushManagerAttendanceAlerts(): Promise<void> {
  const jobName = 'manager-attendance-alerts';
  if (!(await acquireLock(jobName, 55_000))) return;
  try {
    pruneManagerAlertKeys(Date.now());
    const tz = getBusinessTimezone();
    const biz = businessNow(tz);
    const todayDate = parseDate(biz.dateStr);

    const companies = await prisma.companyProfile.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    for (const company of companies) {
      const duplicates = await prisma.timeEntry.findMany({
        where: {
          companyProfileId: company.id,
          isFlaggedDuplicate: true,
          date: todayDate,
        },
        select: { id: true, employeeName: true, employeeEmail: true },
        take: 50,
      });
      for (const d of duplicates) {
        fireManagerAlertOnce(
          `duplicate:${company.id}:${d.id}`,
          company.id,
          'Duplicate punch needs review',
          `${d.employeeName ?? d.employeeEmail} has a possible duplicate punch today.`,
          { alertType: 'duplicate', timeEntryId: d.id },
        );
      }

      const noShows = await prisma.shift.findMany({
        where: {
          companyProfileId: company.id,
          status: 'no_show',
          date: todayDate,
        },
        select: { id: true, employeeName: true },
        take: 50,
      });
      for (const s of noShows) {
        fireManagerAlertOnce(
          `no-show:${company.id}:${s.id}`,
          company.id,
          'Employee marked no-show',
          `${s.employeeName ?? 'An employee'} was marked a no-show today.`,
          { alertType: 'no_show' },
        );
      }
    }
  } catch (err) {
    logger.error('[cron] Manager attendance-alert push error:', err);
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
      await pushManagerAttendanceAlerts();
      await purgeRetentionPolicies();
      await pruneReminderLogs();
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
