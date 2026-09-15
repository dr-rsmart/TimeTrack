-- Safe additive indexes for cron reconciliation, tenant-scoped reporting,
-- push-token lookup, and audit retention scans.
CREATE INDEX IF NOT EXISTS "TimeEntry_companyProfileId_status_clockIn_idx"
  ON "TimeEntry"("companyProfileId", "status", "clockIn");
CREATE INDEX IF NOT EXISTS "TimeEntry_companyProfileId_geofenceId_status_idx"
  ON "TimeEntry"("companyProfileId", "geofenceId", "status");
CREATE INDEX IF NOT EXISTS "AuditLog_companyProfileId_createdAt_idx"
  ON "AuditLog"("companyProfileId", "createdAt");