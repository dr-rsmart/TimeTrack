# Migration 10 — TimeEntry adjustment columns

- **Why:** `adjustedById`, `adjustedByName`, `adjustmentReason` and
  `isManuallyAdjusted` existed in schema.prisma (and in db-push-provisioned
  databases) but were missing from the recorded migration history. Fresh-db
  `migrate deploy` therefore diverged from the code (Prisma P2022).
  Discovered by the Phase 2 fresh-database CI verification.
- **What:** adds the four columns idempotently (`IF NOT EXISTS`).
- **Rollback:**
  ```sql
  ALTER TABLE "TimeEntry"
    DROP COLUMN IF EXISTS "adjustedById",
    DROP COLUMN IF EXISTS "adjustedByName",
    DROP COLUMN IF EXISTS "adjustmentReason",
    DROP COLUMN IF EXISTS "isManuallyAdjusted";
  ```
- **Process note:** after this migration,
  `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma`
  reports zero remaining drift.
