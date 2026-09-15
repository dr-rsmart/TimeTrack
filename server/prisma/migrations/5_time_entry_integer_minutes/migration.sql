-- Migration: 5_time_entry_integer_minutes
-- Add an exact persisted duration representation without changing existing
-- totalHours data. Backfill is a separate controlled operational command.
-- IF NOT EXISTS keeps this order-independent: migration 12 (which sorts
-- BEFORE this file lexicographically on a fresh database) may have already
-- created the column as part of its self-sufficient backfill+NOT NULL path.

ALTER TABLE "TimeEntry"
  ADD COLUMN IF NOT EXISTS "totalMinutes" INTEGER;