-- Migration: 1_session_revocation_and_unique_index
-- Created: 2026-08-26 (Audit Cycle 15 remediation)
--
-- 1) User.pwdEpoch — session revocation-on-rotation.
--    Every password change/reset bumps this epoch; JWTs carrying an older
--    epoch are rejected in requireAuth (see middleware/auth.ts). Default 0
--    keeps all pre-existing tokens valid at rollout.
--
-- 2) uniq_active_time_entry_employee — moved from runtime boot ceremony
--    (index.ts ensureDatabaseIndexes) into migration history so the
--    duplicate-active-punch guarantee is structural and reproducible on any
--    `prisma migrate deploy` target. IF NOT EXISTS keeps this idempotent for
--    databases where the boot ceremony already created the index.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "pwdEpoch" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex (concurrency backstop: at most ONE active punch per employee)
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_time_entry_employee"
ON "TimeEntry"("employeeEmail")
WHERE "status" = 'active';
