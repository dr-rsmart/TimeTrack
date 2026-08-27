# Production Data Change Register

**Purpose:** every direct mutation of production (or production-clone) data outside
the application's normal request flow MUST be recorded here before or immediately
after it is performed. No exceptions. An untracked "DB surgery" is an unauditable
incident waiting to happen — Audit Cycle 16 (2026-08-27) found exactly one such
case (entry 001 below), which motivates this register.

**Rules:**
1. One numbered entry per change, newest at the bottom.
2. Include: date, author, target database, what changed, why, and the roll-forward/
   rollback path.
3. Prefer code + migration + redeploy over manual SQL. When manual SQL is unavoidable
   (e.g. one-off onboarding reconciliation), paste the exact statements used.
4. If the change papers over a code defect, link the fixing commit — the data fix
   is only temporary until that code ships.

---

## 001 — Lakewood Hotel & Conference Centre: user-account reconciliation

- **Date:** 2026-08-26 (performed in a Cline assistance session)
- **Author:** operator + Cline (script run against the working database referenced
  by `server/.env`, DATABASE_URL not recorded)
- **Target:** live working database (company filtered by name `LIKE %Lakewood%`)
- **What changed (executed via a throwaway script `server/fix-lakewood.js`,
  since deleted):**
  1. Deleted conflicting/duplicate `User` rows for Lakewood staff whose login email
     diverged from their `Employee` record (e.g. `ayabangasobekwa22@gmail.com` vs
     `ayabongasobekwa22@gmail.com`).
  2. Recreated login accounts with emails synced to the `Employee` records, default
     password `Password123`, `mustChangePassword = true`.
  3. Cleared lingering `mustChangePassword` blocks for staff meant to be past rotation.
  4. Verified all Lakewood employees reference the active company geofence.
- **Why:** staff could not log in / clock in; email drift between `Employee.email`
  and `User.email` plus forced-reset flags were blocking authentication.
- **Temporary aspect (important):** at the time, the deployed code had a session bug
  (Audit-16 finding NB2 — `/login` did not stamp `pwdEpoch`), so any account with a
  rotated password was locked out; recreating accounts at `pwdEpoch = 0` masked that
  bug. The permanent fix is the committed `pwdEpoch` login stamp + regression spec
  `tests/e2e/session-revocation.spec.ts`. If new login lockouts appear, verify the
  fix is DEPLOYED before doing more data surgery.
- **Rollback path:** none retained (rows were deleted) — lowest-risk recovery is to
  re-run account provisioning via the normal Employee CRUD (which auto-creates users).
- **Follow-up (code-side, completed in Audit-16 hotfix):** email normalization at
  write paths (login self-heal exists in `routes/auth.ts`), plus the ongoing policy
  decision tracked as finding NB6 (cross-tenant same-email employees).

## 002 — Secrets purge from operational scripts (no data change; recorded for auditability)

- **Date:** 2026-08-27
- **Author:** Cline (Audit Cycle 16 remediation)
- **Target:** repository (not the database)
- **What changed:** hard-coded connection strings (including a **production Railway
  PostgreSQL DSN with credentials**, finding NB1) removed from
  `scripts/sync-prod-to-local.mjs`, `scripts/sync-prod-to-preprod.mjs`, and
  `scripts/verify-prod-timetrack.mjs`; scripts now source credentials from
  environment variables only. `.gitleaks.toml` gained a `db-connection-uri` rule.
- **REQUIRED EXTERNAL ACTION (owner must perform):**
  1. **Rotate the Railway PostgreSQL password immediately** — treat the committed
     DSN as compromised.
  2. After rotation + optional `git filter-repo` history cleanup, remove the
     `commits` allowlist block in `.gitleaks.toml`.
  3. Move App Store Connect keys out of `eas/` into a secret manager and delete
     the local copies (finding B11/NB-ops).

## 003 — Production migration baseline: pwdEpoch column + `_prisma_migrations` adoption

- **Date:** 2026-08-27
- **Author:** operator + Cline (remediating Railway deploy failures for commits 3ad6dfe/99d1e07)
- **Target:** Railway production PostgreSQL (`railway` DB, accessed via the service's public TCP proxy)
- **Problem:** deploys of the latest commits failed at the build stage — a tracked UTF-16-encoded temp file (`playwright-temp.config.ts`) broke Nixpacks — and, after that was fixed, at container start: `production-start.mjs` ran `prisma migrate deploy` against a db-push-provisioned database with no `_prisma_migrations` table, aborting with P3005 ("database schema is not empty").
- **What changed:**
  1. Read-only verification first: `prisma migrate diff --from-url <prod> --to-schema-datamodel schema.prisma --script` confirmed the ONLY gap was the missing `User.pwdEpoch` column (the partial unique index `uniq_active_time_entry_employee` already existed via the runtime boot ceremony). No destructive changes.
  2. Applied migration `1_session_revocation_and_unique_index` SQL idempotently:
     `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pwdEpoch" INTEGER NOT NULL DEFAULT 0;`
     `CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_time_entry_employee" ON "TimeEntry"("employeeEmail") WHERE "status" = 'active';` (index already existed — no-op)
  3. Baselined migration history per `server/prisma/migrations/1_.../MIGRATION.md`:
     `npx prisma migrate resolve --applied 0_init`
     `npx prisma migrate resolve --applied 1_session_revocation_and_unique_index`
  4. Verified `prisma migrate status` → "Database schema is up to date!". Repo commit 99d1e07 additionally removed the UTF-16 temp files and added them to `.gitignore`.
- **Why:** required for the new code (session revocation via `pwdEpoch` stamped at login) and to move production onto recorded, auditable migration history so future `migrate deploy` starts work.
- **Roll-forward:** nothing extra needed; history is now canonical. Future schema changes go through `prisma migrate dev` locally + `migrate deploy` on start.
- **Rollback path:** the column is additive with default 0 and would only need removal if the pwdEpoch code were reverted (not planned). `_prisma_migrations` rows can be dropped to revert to db-push mode if ever required.
- **Status:** deployment fb4de3ee (commit 99d1e07) is healthy; `/ping` returns 200 from public and Railway healthcheck.
