-- Migration: 17_tenant_columns_not_null
--
-- Phase 2 (2026-09-15) — closes Open-11: enforce NOT NULL on the tenant key
-- of every strict tenant-scoped table (the STRICT_NULL_TABLES set validated
-- by server/tenant_rls_preflight.mjs; LocationPreset is already NOT NULL).
--
-- GUARDED: aborts loudly if any legacy NULL-tenant row remains, so a dirty
-- database can never be silently half-migrated. Backfill/resolve NULL rows
-- first (npm run tenant:preflight -- --strict reports them).
--
-- Rationale: with RLS ENABLED+FORCED and the runtime bridge adopted
-- (Open-03 closed 2026-09-14), NULL tenant keys are no longer a supported
-- state for these tables. DB-level NOT NULL removes the last orphan-row
-- failure class (app-level auto-stamp remains as the first line of defense).

DO $$
DECLARE
  dirty TEXT;
  eg_null integer := 0;
BEGIN
  -- The four base tables always exist (0_init) and can be checked statically.
  SELECT string_agg(t.tbl || '=' || t.c, ', ') INTO dirty
  FROM (
    SELECT 'Employee' AS tbl, count(*) AS c FROM "Employee" WHERE "companyProfileId" IS NULL
    UNION ALL SELECT 'Shift', count(*) FROM "Shift" WHERE "companyProfileId" IS NULL
    UNION ALL SELECT 'TimeEntry', count(*) FROM "TimeEntry" WHERE "companyProfileId" IS NULL
    UNION ALL SELECT 'Geofence', count(*) FROM "Geofence" WHERE "companyProfileId" IS NULL
  ) t
  WHERE t.c > 0;

  -- EmployeeGeofence may not exist yet on a fresh database (created by
  -- migration 2, which sorts after this file) — probe dynamically.
  IF to_regclass('public."EmployeeGeofence"') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::integer FROM "EmployeeGeofence" WHERE "companyProfileId" IS NULL'
      INTO eg_null;
    IF eg_null > 0 THEN
      dirty := coalesce(dirty || ', ', '') || 'EmployeeGeofence=' || eg_null;
    END IF;
  END IF;

  IF dirty IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 17 aborted: legacy NULL tenant rows remain (%). Backfill them first, then re-run migrate deploy.',
      dirty;
  END IF;
END $$;

ALTER TABLE "Employee"         ALTER COLUMN "companyProfileId" SET NOT NULL;
ALTER TABLE "Shift"            ALTER COLUMN "companyProfileId" SET NOT NULL;
ALTER TABLE "TimeEntry"        ALTER COLUMN "companyProfileId" SET NOT NULL;
ALTER TABLE "Geofence"         ALTER COLUMN "companyProfileId" SET NOT NULL;

-- ORDER-INDEPENDENCE (2026-09-15): EmployeeGeofence is created by migration
-- 2, which sorts AFTER this file lexicographically on a fresh database.
-- Enforce the constraint here when the table already exists; migration 9
-- (sorts last) covers the fresh-database ordering.
DO $$
BEGIN
  IF to_regclass('public."EmployeeGeofence"') IS NOT NULL THEN
    ALTER TABLE "EmployeeGeofence" ALTER COLUMN "companyProfileId" SET NOT NULL;
  END IF;
END $$;