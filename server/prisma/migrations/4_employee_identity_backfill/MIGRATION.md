# Migration 4 — Employee identity backfill

- **Why:** historical rows identified employees only by email; the identity
  resolution rules (see `server/identity_migration_rules.mjs` and
  `server/src/domain/employeeIdentity.ts`) needed a canonical backfill.
- **What:** backfills employee identity references for time entries/shifts
  based on the approved identity resolution rules.
- **Rollback:** review `server/resolve_employee_identity.mjs` (dry-run by
  default) — this migration is a data backfill, reversal is a targeted UPDATE
  from backups.
- **Notes:** preflight tooling: `npm run identity:preflight`, then
  `npm run identity:resolve -- --apply` for any remaining drift.
