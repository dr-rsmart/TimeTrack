# Migration 1: Session Revocation + Structural Unique Index

## Details
- **Created**: 2026-08-26 (Audit Cycle 15 remediation)
- **Database**: PostgreSQL 15+
- **Applied By**: `npx prisma migrate deploy`

## Changes
1. `User.pwdEpoch` (INTEGER NOT NULL DEFAULT 0)
   - Bumped on every password change/reset; JWTs carrying an older epoch are
     rejected (revocation-on-rotation, closes the 8h stolen-token window).
   - Default 0 = zero-downtime rollout (old tokens remain valid until a
     password event bumps the epoch).
2. `uniq_active_time_entry_employee` partial unique index
   - `ON "TimeEntry"("employeeEmail") WHERE "status" = 'active'`
   - Previously created only at runtime by `ensureDatabaseIndexes()`; now part
     of migration history so any freshly deployed database has the guarantee.
   - `IF NOT EXISTS`: idempotent against databases where the runtime
     ceremony already created it.

## Operator note — switching a db-push-provisioned database to migrate
Databases created with `prisma db push` have no `_prisma_migrations` rows.
To adopt recorded migrations without re-applying them:

```bash
npx prisma migrate resolve --applied 0_init --schema=prisma/schema.prisma
npx prisma migrate resolve --applied 1_session_revocation_and_unique_index --schema=prisma/schema.prisma
```

`scripts/production-start.mjs` auto-detects the two states: recognized
history → `migrate deploy`; no history → safe `db push` (never
`--accept-data-loss`).
