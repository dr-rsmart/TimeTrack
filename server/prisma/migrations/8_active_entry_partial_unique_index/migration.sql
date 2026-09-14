-- Migration: 8_active_entry_partial_unique_index
--
-- Moves the runtime partial unique index (previously created at every server
-- boot by server/src/index.ts `ensureDatabaseIndexes`) into a recorded
-- migration. This guarantees the one-active-punch invariant is a database
-- contract applied by `prisma migrate deploy`, not a boot-time side effect.
-- The boot-time creation was removed in Phase 2 (2026-09-14).

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_time_entry_employee"
  ON "TimeEntry"("employeeEmail")
  WHERE status = 'active';
