-- Migration: 6_tenant_integrity_and_rls_prepare
--
-- Phase 4 prepares database-level tenant enforcement. Integrity triggers are
-- active immediately for known cross-tenant references. RLS policies are
-- created but deliberately NOT enabled here: the application must first adopt
-- the transaction-local app.current_tenant bridge and pass the controlled
-- preflight before FORCE ROW LEVEL SECURITY is enabled.

CREATE OR REPLACE FUNCTION "timetrack_current_tenant"()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')
$$;

CREATE OR REPLACE FUNCTION "timetrack_legacy_null_access"()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.allow_legacy_null', true) = 'on'
$$;

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
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "timetrack_tenant_integrity" ON "Employee";
CREATE TRIGGER "timetrack_tenant_integrity"
  BEFORE INSERT OR UPDATE ON "Employee"
  FOR EACH ROW EXECUTE FUNCTION "timetrack_enforce_tenant_integrity"();

DROP TRIGGER IF EXISTS "timetrack_tenant_integrity" ON "Shift";
CREATE TRIGGER "timetrack_tenant_integrity"
  BEFORE INSERT OR UPDATE ON "Shift"
  FOR EACH ROW EXECUTE FUNCTION "timetrack_enforce_tenant_integrity"();

DROP TRIGGER IF EXISTS "timetrack_tenant_integrity" ON "TimeEntry";
CREATE TRIGGER "timetrack_tenant_integrity"
  BEFORE INSERT OR UPDATE ON "TimeEntry"
  FOR EACH ROW EXECUTE FUNCTION "timetrack_enforce_tenant_integrity"();

DROP TRIGGER IF EXISTS "timetrack_tenant_integrity" ON "EmployeeGeofence";
CREATE TRIGGER "timetrack_tenant_integrity"
  BEFORE INSERT OR UPDATE ON "EmployeeGeofence"
  FOR EACH ROW EXECUTE FUNCTION "timetrack_enforce_tenant_integrity"();

-- RLS policy preparation. These policies remain dormant until the explicit
-- operator workflow enables and forces RLS after runtime-bridge verification.
DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "CompanyProfile";
CREATE POLICY "timetrack_tenant_isolation" ON "CompanyProfile"
  USING ("timetrack_current_tenant"() = '*' OR "id" = "timetrack_current_tenant"())
  WITH CHECK ("timetrack_current_tenant"() = '*' OR "id" = "timetrack_current_tenant"());

DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "User";
CREATE POLICY "timetrack_tenant_isolation" ON "User"
  USING ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"() OR ("companyProfileId" IS NULL AND "timetrack_legacy_null_access"()))
  WITH CHECK ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"());

DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "Employee";
CREATE POLICY "timetrack_tenant_isolation" ON "Employee"
  USING ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"() OR ("companyProfileId" IS NULL AND "timetrack_legacy_null_access"()))
  WITH CHECK ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"());

DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "Shift";
CREATE POLICY "timetrack_tenant_isolation" ON "Shift"
  USING ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"() OR ("companyProfileId" IS NULL AND "timetrack_legacy_null_access"()))
  WITH CHECK ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"());

DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "TimeEntry";
CREATE POLICY "timetrack_tenant_isolation" ON "TimeEntry"
  USING ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"() OR ("companyProfileId" IS NULL AND "timetrack_legacy_null_access"()))
  WITH CHECK ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"());

DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "CompanySettings";
CREATE POLICY "timetrack_tenant_isolation" ON "CompanySettings"
  USING ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"())
  WITH CHECK ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"());
DROP POLICY IF EXISTS "timetrack_company_settings_global_read" ON "CompanySettings";
CREATE POLICY "timetrack_company_settings_global_read" ON "CompanySettings"
  FOR SELECT
  USING ("timetrack_current_tenant"() = '*' OR "companyProfileId" IS NULL OR "companyProfileId" = "timetrack_current_tenant"());

DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "Geofence";
CREATE POLICY "timetrack_tenant_isolation" ON "Geofence"
  USING ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"() OR ("companyProfileId" IS NULL AND "timetrack_legacy_null_access"()))
  WITH CHECK ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"());

DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "EmployeeGeofence";
CREATE POLICY "timetrack_tenant_isolation" ON "EmployeeGeofence"
  USING ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"() OR ("companyProfileId" IS NULL AND "timetrack_legacy_null_access"()))
  WITH CHECK ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"());

DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "LocationPreset";
CREATE POLICY "timetrack_tenant_isolation" ON "LocationPreset"
  USING ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"())
  WITH CHECK ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"());

DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "AuditLog";
CREATE POLICY "timetrack_tenant_isolation" ON "AuditLog"
  USING ("timetrack_current_tenant"() = '*' OR "companyProfileId" = "timetrack_current_tenant"() OR ("companyProfileId" IS NULL AND "timetrack_legacy_null_access"()))
  WITH CHECK ("timetrack_current_tenant"() = '*' OR "companyProfileId" IS NULL OR "companyProfileId" = "timetrack_current_tenant"());

DROP POLICY IF EXISTS "timetrack_tenant_isolation" ON "EmploymentHistory";
CREATE POLICY "timetrack_tenant_isolation" ON "EmploymentHistory"
  USING (
    "timetrack_current_tenant"() = '*'
    OR EXISTS (
      SELECT 1 FROM "Employee" e
      WHERE e."id" = "EmploymentHistory"."employeeId"
        AND (e."companyProfileId" = "timetrack_current_tenant"() OR (e."companyProfileId" IS NULL AND "timetrack_legacy_null_access"()))
    )
  )
  WITH CHECK (
    "timetrack_current_tenant"() = '*'
    OR EXISTS (
      SELECT 1 FROM "Employee" e
      WHERE e."id" = "EmploymentHistory"."employeeId"
        AND e."companyProfileId" = "timetrack_current_tenant"()
    )
  );