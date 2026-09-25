-- Migration 22: Late-penalty rate (Cost of Late Coming).
--
-- Adds a per-employee late-penalty rate in ZAR. When NULL the Cost-of-Late
-- report falls back to "hourlyRate"; when set, this rate prices late
-- clock-ins / early clock-outs instead. This lets payroll apply a distinct
-- penalty rate (e.g. an overtime rate) without touching the regular hourly
-- rate.
--
-- Metadata-only ADD COLUMN (nullable, no default) — no table rewrite.
-- IF NOT EXISTS: replay-safe on databases provisioned by db-push.

ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "latePenaltyRate" DECIMAL(10,2);

-- Rollback:
--   ALTER TABLE "Employee" DROP COLUMN "latePenaltyRate";
