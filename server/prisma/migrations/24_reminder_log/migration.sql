-- Migration 24: durable cron reminder/alert dedupe ledger (Cycle 17).
--
-- The shift-reminder and manager-attendance-alert cron jobs deduped only in
-- process memory. A deploy/restart inside a reminder window, or a second
-- replica winning the CronLock lease on a later tick, could send the same
-- "Workday Starting Soon" / manager alert twice. This table makes dedupe
-- atomic and durable via a unique dedupeKey; rows are pruned after 72h by the
-- retention job. The in-memory Map stays as a fast-path cache in front of it.
--
-- ReminderLog is a system/operational table written only by the cron runner
-- under the unrestricted (tenant '*') bridge. It carries no companyProfileId,
-- so it is intentionally NOT tenant-scoped and must NOT receive a tenant RLS
-- policy: the cron path must be able to see every row regardless of tenant.

CREATE TABLE IF NOT EXISTS "ReminderLog" (
  "id" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'shift_reminder',
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReminderLog_dedupeKey_key"
  ON "ReminderLog"("dedupeKey");

CREATE INDEX IF NOT EXISTS "ReminderLog_kind_idx"
  ON "ReminderLog"("kind");

CREATE INDEX IF NOT EXISTS "ReminderLog_sentAt_idx"
  ON "ReminderLog"("sentAt");

-- Rollback:
--   DROP TABLE IF EXISTS "ReminderLog";
