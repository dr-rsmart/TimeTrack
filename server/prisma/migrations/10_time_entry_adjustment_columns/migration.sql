-- Migration: 10_time_entry_adjustment_columns
--
-- Reconciliation migration (Phase 2, 2026-09-14). These TimeEntry columns
-- existed in schema.prisma and in db-push-provisioned databases but were
-- missing from the recorded migration history, which made `prisma migrate
-- deploy` on a fresh database diverge from the code (Prisma P2022 on
-- TimeEntry.isManuallyAdjusted). Discovered by the fresh-database CI path.
--
-- IF NOT EXISTS keeps this idempotent for production databases where the
-- columns were already created by the historical db-push provisioning.

ALTER TABLE "TimeEntry"
  ADD COLUMN IF NOT EXISTS "adjustedById" TEXT,
  ADD COLUMN IF NOT EXISTS "adjustedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "adjustmentReason" TEXT,
  ADD COLUMN IF NOT EXISTS "isManuallyAdjusted" BOOLEAN NOT NULL DEFAULT false;
