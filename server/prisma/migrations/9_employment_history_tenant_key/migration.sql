-- Migration: 9_employment_history_tenant_key
--
-- Phase 2 (2026-09-14): EmploymentHistory was the only tenant-scoped entity
-- without a tenant key, which made it invisible to the tenant auto-stamp /
-- assertTenantMatch backstops and forced its RLS policy to JOIN through
-- Employee. This migration gives it a first-class tenant key.

-- 1. Add the column (nullable: existing rows are legacy-null until backfill).
ALTER TABLE "EmploymentHistory" ADD COLUMN IF NOT EXISTS "companyProfileId" TEXT;

-- 2. Backfill from the referenced employee's tenant.
UPDATE "EmploymentHistory" eh
   SET "companyProfileId" = e."companyProfileId"
  FROM "Employee" e
 WHERE eh."employeeId" = e."id"
   AND eh."companyProfileId" IS NULL;

-- 3. Index the tenant key.
CREATE INDEX IF NOT EXISTS "EmploymentHistory_companyProfileId_idx"
  ON "EmploymentHistory"("companyProfileId");

-- 4. Extend the cross-tenant integrity trigger to EmploymentHistory → Employee.
CREATE OR REPLACE FUNCTION "timetrack_enforce_tenant_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  row_tenant text;
  reference_id text;
  reference_tenant text;
BEGIN
  row_tenant := NULLIF(to_jsonb(NEW)->>'companyProfileId', '');

  -- A tenant row may remain legacy-null during the migration period. Whenever
  -- both sides are known, however, they must never cross tenant boundaries.
  IF TG_TABLE_NAME IN ('Shift', 'TimeEntry') THEN
    reference_id := NULLIF(to_jsonb(NEW)->>'employeeId', '');
    IF reference_id IS NOT NULL AND row_tenant IS NOT NULL THEN
      SELECT "companyProfileId" INTO reference_tenant
      FROM "Employee" WHERE "id" = reference_id;
      IF reference_tenant IS NOT NULL AND reference_tenant <> row_tenant THEN
        RAISE EXCEPTION 'Cross-tenant employee reference rejected for %.%', TG_TABLE_NAME, 'employeeId'
          USING ERRCODE = '23514', DETAIL = 'companyProfileId does not match Employee.companyProfileId';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'Employee' THEN
    reference_id := NULLIF(to_jsonb(NEW)->>'managerId', '');
    IF reference_id IS NOT NULL AND row_tenant IS NOT NULL THEN
      SELECT "companyProfileId" INTO reference_tenant
      FROM "Employee" WHERE "id" = reference_id;
      IF reference_tenant IS NOT NULL AND reference_tenant <> row_tenant THEN
        RAISE EXCEPTION 'Cross-tenant manager reference rejected'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    reference_id := NULLIF(to_jsonb(NEW)->>'geofenceId', '');
    IF reference_id IS NOT NULL AND row_tenant IS NOT NULL THEN
      SELECT "companyProfileId" INTO reference_tenant
      FROM "Geofence" WHERE "id" = reference_id;
      IF reference_tenant IS NOT NULL AND reference_tenant <> row_tenant THEN
        RAISE EXCEPTION 'Cross-tenant employee geofence reference rejected'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'EmployeeGeofence' THEN
    IF row_tenant IS NOT NULL THEN
      reference_id := NULLIF(to_jsonb(NEW)->>'employeeId', '');
      IF reference_id IS NOT NULL THEN
        SELECT "companyProfileId" INTO reference_tenant
        FROM "Employee" WHERE "id" = reference_id;
        IF reference_tenant IS NOT NULL AND reference_tenant <> row_tenant THEN
          RAISE EXCEPTION 'Cross-tenant EmployeeGeofence employee reference rejected'
            USING ERRCODE = '23514';
        END IF;
      END IF;

      reference_id := NULLIF(to_jsonb(NEW)->>'geofenceId', '');
      IF reference_id IS NOT NULL THEN
        SELECT "companyProfileId" INTO reference_tenant
        FROM "Geofence" WHERE "id" = reference_id;
        IF reference_tenant IS NOT NULL AND reference_tenant <> row_tenant THEN
          RAISE EXCEPTION 'Cross-tenant EmployeeGeofence geofence reference rejected'
            USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'EmploymentHistory' THEN
    IF row_tenant IS NOT NULL THEN
      reference_id := NULLIF(to_jsonb(NEW)->>'employeeId', '');
      IF reference_id IS NOT NULL THEN
        SELECT "companyProfileId" INTO reference_tenant
        FROM "Employee" WHERE "id" = reference_id;
        IF reference_tenant IS NOT NULL AND reference_tenant <> row_tenant THEN
          RAISE EXCEPTION 'Cross-tenant EmploymentHistory employee reference rejected'
            USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "timetrack_tenant_integrity" ON "EmploymentHistory";
CREATE TRIGGER "timetrack_tenant_integrity"
  BEFORE INSERT OR UPDATE ON "EmploymentHistory"
  FOR EACH ROW EXECUTE FUNCTION "timetrack_enforce_tenant_integrity"();

-- 5. RLS policy now reads the direct tenant key (consistent with other tables).
DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "EmploymentHistory";
CREATE POLICY "timetrack_tenant_isolation" ON "EmploymentHistory"
  USING (
    "timetrack_current_tenant"() = '*'
    OR "companyProfileId" = "timetrack_current_tenant"()
    OR ("companyProfileId" IS NULL AND "timetrack_legacy_null_access"())
  )
  WITH CHECK (
    "timetrack_current_tenant"() = '*'
    OR "companyProfileId" = "timetrack_current_tenant"()
  );

-- 6. EmployeeGeofence tenant NOT NULL (Open-11, added 2026-09-15).
-- ORDER-INDEPENDENCE: Prisma applies migrations lexicographically, so on a
-- fresh database 17_tenant_columns_not_null runs BEFORE 2 creates
-- EmployeeGeofence. This file sorts LAST, so the constraint is enforced
-- here; 17 covers databases where the table already exists. Both paths are
-- guarded and fail loudly on legacy NULL rows.
DO $$
DECLARE
  null_rows integer;
BEGIN
  IF to_regclass('public."EmployeeGeofence"') IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*)::integer INTO null_rows
  FROM "EmployeeGeofence" WHERE "companyProfileId" IS NULL;
  IF null_rows > 0 THEN
    RAISE EXCEPTION
      'EmployeeGeofence NOT NULL aborted: % legacy NULL tenant row(s) remain. Backfill them first.',
      null_rows;
  END IF;
  ALTER TABLE "EmployeeGeofence" ALTER COLUMN "companyProfileId" SET NOT NULL;
END $$;
