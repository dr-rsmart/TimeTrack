-- Migration: 5_time_entry_integer_minutes
-- Add an exact persisted duration representation without changing existing
-- totalHours data. Backfill is a separate controlled operational command.

ALTER TABLE "TimeEntry"
  ADD COLUMN "totalMinutes" INTEGER;