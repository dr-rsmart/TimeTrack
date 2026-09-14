# Migration 11 — AuditLog archive table

- **Why:** `AuditLog` is append-only and grows forever; cold-storage
  archival was previously a manual `pg_dump` chore (OPERATIONS.md).
- **What:** creates the `AuditLogArchive` table (same shape + `archivedAt`)
  and indexes. Nothing is moved or purged by this migration.
- **Rollback:** `DROP TABLE IF EXISTS "AuditLogArchive";`
- **Follow-up:** run `npm run audit:archive -- --older-than 365 --dry-run`
  to preview, then without `--dry-run` to move rows older than N days. The
  archive step is audited and recorded in `docs/DATA_CHANGES.md`.
