-- Migration: 3_attendance_idempotency
-- Adds durable retry keys for clock-in/out requests.
-- Nullable columns preserve compatibility with existing historical entries;
-- PostgreSQL unique indexes allow multiple NULL values.

ALTER TABLE "TimeEntry"
  ADD COLUMN IF NOT EXISTS "clockInIdempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "clockOutIdempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "TimeEntry_clockInIdempotencyKey_key"
  ON "TimeEntry"("clockInIdempotencyKey");

CREATE UNIQUE INDEX IF NOT EXISTS "TimeEntry_clockOutIdempotencyKey_key"
  ON "TimeEntry"("clockOutIdempotencyKey");