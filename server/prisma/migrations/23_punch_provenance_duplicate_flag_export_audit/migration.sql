-- Migration 23: punch provenance, duplicate flagging, and payroll export audit.
--
-- Closes three Feature Specification gaps tracked in docs/SPEC_TRACE.md:
--
--   §7 "GPS + timestamp + device logging" (was 🟡) — TimeEntry previously stored
--      only the matched FENCE's coordinates, not where the device actually was
--      when the punch landed, nor which device took it.
--
--   §7 "2-min duplicate flag + auto-merge" (was ❌) — the 120 s reclockGuard
--      PREVENTS most double punches, but offline-outbox replays and manager
--      proxy punches bypass it. Those are now FLAGGED (corrective) instead of
--      silently accepted, so payroll can resolve them.
--
--   §4 "Export audit trail" (was ❌) — every payroll CSV download is recorded
--      with actor, format, period and row count.
--
-- All TimeEntry additions are nullable or defaulted, so every ALTER is a
-- metadata-only ADD COLUMN with no table rewrite (TimeEntry is the hottest and
-- largest table). IF NOT EXISTS keeps this replay-safe on databases that were
-- provisioned by `prisma db push` rather than the migration chain.

-- ── §7 punch provenance ────────────────────────────────────────────────────
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "punchLatitude" DOUBLE PRECISION;
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "punchLongitude" DOUBLE PRECISION;

-- ── §7 corrective duplicate detection ─────────────────────────────────────
ALTER TABLE "TimeEntry"
  ADD COLUMN IF NOT EXISTS "isFlaggedDuplicate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "duplicateOfId" TEXT;

-- Duplicate-resolution queues are always filtered by tenant + flag together.
CREATE INDEX IF NOT EXISTS "TimeEntry_companyProfileId_isFlaggedDuplicate_idx"
  ON "TimeEntry"("companyProfileId", "isFlaggedDuplicate");

-- duplicateOfId is a self-reference within the same tenant. Deliberately NOT a
-- foreign key: resolution may point at an entry that is later hard-deleted by
-- an admin, and a dangling FK would then block that delete. The column is
-- advisory provenance, not an integrity constraint.

-- ── §4 payroll export audit trail ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PayrollExportLog" (
  "id" TEXT NOT NULL,
  "companyProfileId" TEXT NOT NULL,
  "formatId" TEXT NOT NULL,
  "formatLabel" TEXT NOT NULL,
  "periodFrom" DATE NOT NULL,
  "periodTo" DATE NOT NULL,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "filters" JSONB NOT NULL DEFAULT '{}',
  "actorId" TEXT NOT NULL,
  "actorEmail" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollExportLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PayrollExportLog_companyProfileId_createdAt_idx"
  ON "PayrollExportLog"("companyProfileId", "createdAt");
CREATE INDEX IF NOT EXISTS "PayrollExportLog_companyProfileId_periodFrom_periodTo_idx"
  ON "PayrollExportLog"("companyProfileId", "periodFrom", "periodTo");
CREATE INDEX IF NOT EXISTS "PayrollExportLog_actorId_idx"
  ON "PayrollExportLog"("actorId");

ALTER TABLE "PayrollExportLog" DROP CONSTRAINT IF EXISTS "PayrollExportLog_companyProfileId_fkey";
ALTER TABLE "PayrollExportLog"
  ADD CONSTRAINT "PayrollExportLog_companyProfileId_fkey"
  FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation.
--
-- Unlike the migration-6 tables, PayrollExportLog is created AFTER the runtime
-- transaction-local tenant bridge was adopted and verified (Open-03, closed
-- 2026-09-14), so its policy can be installed and RLS forced atomically in the
-- same migration — there is no window where the table is RLS-protected without
-- a policy, which would deny the `timetrack_app` role entirely.
--
-- Mirrors the LocationPreset/CompanySettings shape: companyProfileId is NOT
-- NULL here, so no legacy-null escape hatch is needed (contrast AuditLog).
DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "PayrollExportLog";
CREATE POLICY "timetrack_tenant_isolation" ON "PayrollExportLog"
  USING ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"())
  WITH CHECK ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"());

ALTER TABLE "PayrollExportLog" ENABLE ROW LEVEL SECURITY;
-- FORCE so the table owner is subject to the policy too; matches the other
-- tenant tables activated by server/enable_tenant_rls.mjs.
ALTER TABLE "PayrollExportLog" FORCE ROW LEVEL SECURITY;

-- Rollback:
--   DROP TABLE IF EXISTS "PayrollExportLog";
--   DROP INDEX IF EXISTS "TimeEntry_companyProfileId_isFlaggedDuplicate_idx";
--   ALTER TABLE "TimeEntry" DROP COLUMN IF EXISTS "duplicateOfId";
--   ALTER TABLE "TimeEntry" DROP COLUMN IF EXISTS "isFlaggedDuplicate";
--   ALTER TABLE "TimeEntry" DROP COLUMN IF EXISTS "punchLongitude";
--   ALTER TABLE "TimeEntry" DROP COLUMN IF EXISTS "punchLatitude";
--   ALTER TABLE "TimeEntry" DROP COLUMN IF EXISTS "deviceId";
