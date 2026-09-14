-- Migration: 11_audit_log_archive
--
-- Phase 4 (2026-09-14) groundwork for AuditLog cold-storage archival:
-- creates the append-only archive table that long-lived compliance rows are
-- moved into by the operator-gated `npm run audit:archive` tooling.
-- AuditLog itself remains immutable and is NEVER auto-purged; archival is an
-- explicit, audited operational step.

CREATE TABLE IF NOT EXISTS "AuditLogArchive" (
  "id"               TEXT PRIMARY KEY,
  "entity"           TEXT NOT NULL,
  "entityId"         TEXT NOT NULL,
  "action"           TEXT NOT NULL,
  "actorId"          TEXT NOT NULL,
  "actorEmail"       TEXT NOT NULL,
  "actorRole"        TEXT NOT NULL,
  "changes"          JSONB,
  "justification"    TEXT,
  "ipAddress"        TEXT,
  "branch"           TEXT,
  "department"       TEXT,
  "companyProfileId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL,
  "archivedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AuditLogArchive_companyProfileId_idx" ON "AuditLogArchive"("companyProfileId");
CREATE INDEX IF NOT EXISTS "AuditLogArchive_createdAt_idx" ON "AuditLogArchive"("createdAt");
