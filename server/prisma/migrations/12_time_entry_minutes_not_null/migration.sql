-- Migration: 12_time_entry_minutes_not_null
--
-- Phase 4 (2026-09-14) DB5 completion: makes `totalMinutes` the guaranteed
-- exact payable duration. The migration is self-sufficient — it backfills
-- any remaining NULL from the legacy `totalHours` before enforcing the
-- constraint, so it applies cleanly to any database (fresh or upgraded).

UPDATE "TimeEntry"
   SET "totalMinutes" = ROUND(("totalHours" * 60)::numeric)::integer
 WHERE "totalMinutes" IS NULL
   AND "totalHours" IS NOT NULL;

ALTER TABLE "TimeEntry" ALTER COLUMN "totalMinutes" SET NOT NULL;
