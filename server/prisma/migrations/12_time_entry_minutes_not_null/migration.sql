-- Migration: 12_time_entry_minutes_not_null
--
-- Phase 4 (2026-09-14) DB5 completion: makes `totalMinutes` the guaranteed
-- exact payable duration. The migration is self-sufficient — it backfills
-- any remaining NULL from the legacy `totalHours` before enforcing the
-- constraint, so it applies cleanly to any database (fresh or upgraded).
--
-- ORDER-INDEPENDENCE (2026-09-15): Prisma applies migrations in
-- lexicographic directory order, so on a FRESH database this file runs
-- BEFORE 5_time_entry_integer_minutes. The guarded ADD COLUMN below makes
-- the chain succeed in either order (5 then becomes a no-op).

ALTER TABLE "TimeEntry"
  ADD COLUMN IF NOT EXISTS "totalMinutes" INTEGER;

UPDATE "TimeEntry"
   SET "totalMinutes" = ROUND(("totalHours" * 60)::numeric)::integer
 WHERE "totalMinutes" IS NULL
   AND "totalHours" IS NOT NULL;

-- LIVE-SESSION SAFETY (2026-09-15): open (status = 'active') entries have no
-- payable duration yet and always carry NULL totalHours. The application
-- itself creates clock-ins with totalMinutes = 0 (server/src/application/
-- attendance.ts) and writes the exact duration at clock-out, so backfill
-- open rows with the same sentinel instead of aborting the deploy — a
-- clocked-in employee must never hard-fail a production cutover. Verified
-- against the Railway production clone: the only NULL-duration row was a
-- live active session.
UPDATE "TimeEntry"
   SET "totalMinutes" = 0
 WHERE "totalMinutes" IS NULL
   AND status = 'active';

-- Rows still NULL here are non-active entries with no payable duration
-- information at all (NULL totalHours); they would violate the constraint,
-- so fail loudly.
DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*)::integer INTO remaining FROM "TimeEntry" WHERE "totalMinutes" IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION
      'Migration 12 aborted: % TimeEntry row(s) have neither totalMinutes nor totalHours. Resolve them before deploying.',
      remaining;
  END IF;
END $$;

ALTER TABLE "TimeEntry" ALTER COLUMN "totalMinutes" SET NOT NULL;
