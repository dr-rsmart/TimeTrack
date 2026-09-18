-- Migration 21: Saturday overtime multiplier (mirrors Sunday).
--
-- Adds a Saturday overtime switch + multiplier to CompanySettings so
-- Saturday work can be classified and weighted like Sunday work (precedence:
-- Public Holiday > Sunday > Saturday). Defaults to DISABLED (false) so no
-- existing payroll calculation changes until an admin opts in.
--
-- Metadata-only ADD COLUMNs with constant defaults — no table rewrite.
-- IF NOT EXISTS: replay-safe on databases provisioned by db-push.

ALTER TABLE "CompanySettings"
  ADD COLUMN IF NOT EXISTS "saturdayOvertimeEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "saturdayOvertimeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5;

-- Rollback:
--   ALTER TABLE "CompanySettings" DROP COLUMN "saturdayOvertimeEnabled";
--   ALTER TABLE "CompanySettings" DROP COLUMN "saturdayOvertimeMultiplier";