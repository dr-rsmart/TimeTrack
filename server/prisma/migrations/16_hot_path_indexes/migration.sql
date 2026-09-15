-- Safe additive indexes for cron reconciliation, tenant-scoped reporting,
-- push-token lookup, and audit retention scans.
--
-- ORDER-INDEPENDENCE (2026-09-15): TimeEntry.geofenceId is added by
-- migration 7, which sorts AFTER this file lexicographically on a fresh
-- database — the geofence index is therefore created conditionally.
CREATE INDEX IF NOT EXISTS "TimeEntry_companyProfileId_status_clockIn_idx"
  ON "TimeEntry"("companyProfileId", "status", "clockIn");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'TimeEntry' AND column_name = 'geofenceId'
  ) THEN
    CREATE INDEX IF NOT EXISTS "TimeEntry_companyProfileId_geofenceId_status_idx"
      ON "TimeEntry"("companyProfileId", "geofenceId", "status");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AuditLog_companyProfileId_createdAt_idx"
  ON "AuditLog"("companyProfileId", "createdAt");

-- Fresh-database ordering fallback: when the column arrives later (migration
-- 7), create the index there. See 7_location_working_hours_and_entry_geofence.