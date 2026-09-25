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
- **STATUS 2026-09-14 (Phase 1):** tracked-file redaction completed
  (`docs/AUDIT_REPORT.md` password references redacted); full executable steps
  now live in `docs/SECURITY_REMEDIATION_RUNBOOK.md`. Steps 1–3 remain
  owner-only (Railway/secret-manager access + GitHub force-push), deferred
  under the current no-push/no-deploy freeze.

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

## 004 — Railway production snapshot restored to local production clone

- **Date:** 2026-09-07
- **Author:** operator + Cline
- **Target:** local PostgreSQL database `timetrack_prod` on `localhost:5433`
- **Source:** Railway production PostgreSQL database `railway`, accessed through Railway's public TCP proxy using runtime environment variables only
- **What changed:**
  1. Created a custom-format rollback dump of the pre-refresh local database at `backups/timetrack_prod-before-railway-20260907-062718.dump` (SHA-256: `7B1A624D2EBC3BAD064F8E2114C8D8EEA0824D127586418520B112FD08D65E1B`).
  2. Created a custom-format snapshot of Railway production with `pg_dump --no-owner --no-privileges`.
  3. Replaced the local `timetrack_prod` contents with `pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction`.
  4. Removed the temporary production snapshot and retained the local rollback dump under the git-ignored `backups/` directory.
- **Why:** refresh the local production clone with the current Railway production data for local investigation/development.
- **Verification:** all 14 public tables and their row counts matched between Railway production and local `timetrack_prod`: `AuditLog` 2,837; `CompanyProfile` 4; `CompanySettings` 5; `CronLock` 0; `Employee` 85; `EmployeeGeofence` 1; `EmploymentHistory` 168; `Geofence` 19; `LocationPreset` 0; `RetentionPolicy` 3; `Shift` 144; `TimeEntry` 380; `User` 90; `_prisma_migrations` 3.
- **Rollback path:** restore `backups/timetrack_prod-before-railway-20260907-062718.dump` into local `timetrack_prod` with PostgreSQL `pg_restore --clean --if-exists`; the archive was verified readable and is git-ignored.

## 005 — Local production clone restored to local pre-production database

- **Date:** 2026-09-07
- **Author:** operator + Cline
- **Target:** local PostgreSQL database `timetrack_pre-prod` on `localhost:5433`
- **Source:** local PostgreSQL database `timetrack_prod` on the same PostgreSQL instance
- **What changed:**
  1. Created a custom-format rollback dump of the pre-refresh `timetrack_pre-prod` database at `backups/timetrack_pre-prod-before-prod-sync-20260907-063236.dump` (SHA-256: `E09EF08DDE58C3C54CB046481A2678DFE2058750BF67040D04A56E66DC436228`).
  2. Created a custom-format snapshot of local `timetrack_prod` with `pg_dump --no-owner --no-privileges`.
  3. Replaced the local `timetrack_pre-prod` contents with `pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction`.
  4. Removed the temporary `timetrack_prod` source snapshot and retained the pre-production rollback dump under the git-ignored `backups/` directory.
- **Why:** refresh local pre-production with the current local production clone for local testing and investigation.
- **Verification:** all 14 public tables and their row counts match between `timetrack_prod` and `timetrack_pre-prod`: `AuditLog` 2,837; `CompanyProfile` 4; `CompanySettings` 5; `CronLock` 0; `Employee` 85; `EmployeeGeofence` 1; `EmploymentHistory` 168; `Geofence` 19; `LocationPreset` 0; `RetentionPolicy` 3; `Shift` 144; `TimeEntry` 380; `User` 90; `_prisma_migrations` 3.
- **Rollback path:** restore `backups/timetrack_pre-prod-before-prod-sync-20260907-063236.dump` into local `timetrack_pre-prod` with PostgreSQL `pg_restore --clean --if-exists`; the archive was verified readable and is git-ignored.

## 004 — Orphaned seed geofence removal (pre-RLS hygiene)

- **Date:** 2026-09-14 (Phase 4 preflight)
- **Author:** operator + Cline
- **Target:** working database (local production clone, `server/.env` DSN)
- **What changed:** deleted one `Geofence` row
  (`id=cmt01sx7t0008p13zgifn6etz`, name `Main Office`) with
  `companyProfileId IS NULL` and zero `EmployeeGeofence` assignments —
  a leftover seed artifact blocking strict-tenant preflight.
- **Why:** `tenant:preflight --strict` reported 1 strict null-tenant row;
  RLS/NOT-NULL hardening requires zero legacy-null rows in strict tables.
- **SQL executed:**
  ```sql
  DELETE FROM "Geofence" WHERE id = 'cmt01sx7t0008p13zgifn6etz'
    AND "companyProfileId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "EmployeeGeofence" eg WHERE eg."geofenceId" = "Geofence".id);
  ```
- **Rollback path:** none retained — the row carried no assignments; a
  replacement geofence is created through normal Settings → Locations UI.
- **Verification:** `npm run tenant:preflight -- --strict` now reports
  `Strict null-tenant rows: 0`.

## 005 — Local clone reseed incident + recovery from backup

- **Date:** 2026-09-14 (Phase 4 RLS validation session)
- **Author:** Cline (recovered by the same operator within the session)
- **Target:** LOCAL working database (`timetrack_prod` clone, `server/.env`).
  Production (Railway) was NOT affected.
- **What happened:** to mirror CI's fresh-seed E2E precondition, the local
  clone was re-seeded (`npm run seed`). The seed script is fully destructive
  by design and replaced real tenant data (92 users / 87 employees,
  incl. `raees@smartpatel.co.za`) with the demo dataset.
- **Recovery:** restored from the Phase 1 drill snapshot
  `backups/timetrack_backup_2026-09-14T17-24-32.dump` (drop → create →
  `pg_restore --no-owner --no-privileges`), then:
  1. `prisma migrate deploy` (elevated role) re-applied migrations 8–12.
  2. `npm run db:runtime-role -- --apply` re-provisioned `timetrack_app`.
  3. `npm run tenant:rls:enable -- --apply --confirm` re-armed RLS.
  4. Re-applied the recorded DATA_CHANGES 004 orphan-geofence deletion.
- **Verification:** `raees@smartpatel.co.za` present; 92 users / 87 employees
  restored; RLS preflight clean; unbridged app-role reads see 0 rows.
- **Lesson / process change:** never run the destructive seed against a
  database that holds real data. E2E state resets on the local clone should
  use a dedicated scratch database or a snapshot-restore afterwards.

## 006 — Railway production snapshot restored to local production clone

- **Date:** 2026-09-14
- **Author:** operator + Cline
- **Target:** local PostgreSQL database `timetrack_prod` on `localhost:5433`
- **Source:** Railway production PostgreSQL database `railway` (project
  `TimeTrack`, environment `production`, service `Postgres`), reached through
  Railway's public TCP proxy. Credentials were read at runtime with
  `railway variable list -s Postgres --kv` and were never written to disk or
  to this repo.
- **What changed:**
  1. Created a custom-format rollback dump of the pre-refresh local database
     at `backups/timetrack_prod-before-railway-20260914-230922.dump`
     (SHA-256: `BCD37E8E0875BE5D569AC72A7C5AC8994F6A140DCF8CB40D8E739D4AC31DF686`,
     240,712 bytes). Unlike entries 004/005 this dump was taken **without**
     `--no-privileges`, so the 60 `timetrack_app` table grants and the RLS
     policy definitions are recoverable from it.
  2. Verified the archive readable (`pg_restore -l`, 186 TOC entries) before
     any destructive step.
  3. Created a custom-format snapshot of Railway production with
     `pg_dump -Fc --no-owner --no-privileges`.
  4. Replaced local `timetrack_prod` via `dropdb --if-exists --force` →
     `createdb -O postgres` → `pg_restore --no-owner --no-privileges
--exit-on-error --single-transaction`. Encoding/collation were preserved
     (`UTF8` / `English_South Africa.1252`).
  5. Deleted the temporary production snapshot; retained the local rollback
     dump under the git-ignored `backups/` directory.
- **Method note (important):** the `pg_restore --clean --if-exists` approach
  used in entry 004 **no longer works** for this refresh and was aborted
  atomically by `--single-transaction` (no data was lost). The local clone had
  drifted ahead of production (migrations 0–12 applied vs 0–2 on Railway), so
  its extra objects blocked the clean phase:
  `cannot drop constraint Geofence_pkey ... constraint TimeEntry_geofenceId_fkey
depends on index Geofence_pkey`. Drop → create → restore is now the correct
  procedure whenever the clone is ahead of production.
- **Why:** refresh the local production clone with current Railway production
  data for local investigation/development.
- **Verification:** all 14 public tables and their row counts match between
  Railway production and local `timetrack_prod`: `AuditLog` 3,701;
  `CompanyProfile` 4; `CompanySettings` 5; `CronLock` 0; `Employee` 85;
  `EmployeeGeofence` 7; `EmploymentHistory` 168; `Geofence` 19;
  `LocationPreset` 0; `RetentionPolicy` 3; `Shift` 144; `TimeEntry` 585;
  `User` 90; `_prisma_migrations` 3. Indexes 60, foreign keys 16.
- **Known consequence — local Phase 4 hardening was replaced (expected):**
  `timetrack_prod` is now an exact mirror of production, so it no longer
  carries the local-only Phase 4 state. Measured after the restore:
  `rls_tables=0`, `policies=0`, `grants_to_timetrack_app=0`, `migrations=3`
  (`0_init`, `1_session_revocation_and_unique_index`,
  `2_employee_geofence_multi_location`), and the local-only `AuditLogArchive`
  table (migration `11_audit_log_archive`) is gone.
- **Schema is now behind `server/prisma/schema.prisma` (migrations 3–12 pending).**
  Verified concretely: `TimeEntry` has no `minutes` column (migration
  `5_time_entry_integer_minutes`; it still uses `totalHours`) and no
  `geofenceId` column (migration `7_location_working_hours_and_entry_geofence`;
  it still uses the denormalised `geofenceName`/`geofenceLatitude`/…
  columns). `User.pwdEpoch` IS present (added manually in entry 003).
  Consequence: the current API build will not work against this clone until
  the schema is brought forward. `server/.env` also still points
  `DATABASE_URL` at the `timetrack_app` runtime role, which currently has zero
  grants. Re-provision in this order:
  1. `cd server && npm run db:migrate:deploy` (uses `MIGRATE_DATABASE_URL`,
     the elevated `postgres` role) to apply migrations 3–12.
  2. `npm run db:runtime-role -- --apply` to re-provision `timetrack_app`.
  3. `npm run tenant:preflight -- --strict` — this WILL report 1 strict
     null-tenant row: the orphaned seed geofence
     `id=cmt01sx7t0008p13zgifn6etz`, name `Main Office`, is present again
     because it still exists in production data (entry 004 deleted it locally
     only). Re-apply that recorded deletion before step 4.
  4. `npm run tenant:rls:enable -- --apply --confirm` to re-arm RLS.
- **Rollback path:** restore
  `backups/timetrack_prod-before-railway-20260914-230922.dump` into a freshly
  created `timetrack_prod` with `pg_restore --no-owner` (privileges and RLS
  policies are included in this archive). The archive was verified readable
  and is git-ignored.

## 007 — Local production clone restored to local pre-production database

- **Date:** 2026-09-14
- **Author:** operator + Cline
- **Target:** local PostgreSQL database `timetrack_pre-prod` on `localhost:5433`
- **Source:** local PostgreSQL database `timetrack_prod` on the same PostgreSQL
  instance (itself refreshed from Railway production in entry 006, performed
  immediately beforehand in the same session).
- **What changed:**
  1. Created a custom-format rollback dump of the pre-refresh
     `timetrack_pre-prod` database at
     `backups/timetrack_pre-prod-before-prod-sync-20260914-230922.dump`
     (SHA-256: `5A7328448BD578D1BD7614E172E3D0EC1B7EE90D7AE6ED3107CD65D01CFEC250`,
     204,575 bytes), taken without `--no-privileges` for a complete rollback.
  2. Verified the archive readable (`pg_restore -l`, 124 TOC entries) before
     any destructive step.
  3. Created a custom-format snapshot of local `timetrack_prod` with
     `pg_dump -Fc --no-owner --no-privileges`.
  4. Replaced `timetrack_pre-prod` via `dropdb --if-exists --force` →
     `createdb -O postgres` → `pg_restore --no-owner --no-privileges
--exit-on-error --single-transaction`. Two idle pgAdmin 4 sessions were
     terminated first. Encoding/collation preserved
     (`UTF8` / `English_South Africa.1252`).
  5. Deleted the temporary `timetrack_prod` source snapshot; retained the
     pre-production rollback dump under the git-ignored `backups/` directory.
- **Why:** refresh local pre-production with the current local production clone
  so both non-production databases mirror live Railway production data for
  local testing and investigation.
- **Verification:** all 14 public tables and their row counts match between
  `timetrack_prod` and `timetrack_pre-prod`: `AuditLog` 3,701;
  `CompanyProfile` 4; `CompanySettings` 5; `CronLock` 0; `Employee` 85;
  `EmployeeGeofence` 7; `EmploymentHistory` 168; `Geofence` 19;
  `LocationPreset` 0; `RetentionPolicy` 3; `Shift` 144; `TimeEntry` 585;
  `User` 90; `_prisma_migrations` 3. Both databases report identical
  `indexes=60` and `fk_constraints=16`.
- **Note:** `timetrack_pre-prod` had no RLS policies and no `timetrack_app`
  grants before this change, so no local hardening was lost here. It inherits
  the same "re-provision before use" caveat recorded in entry 006 if it is
  pointed at the `timetrack_app` runtime role.
- **Rollback path:** restore
  `backups/timetrack_pre-prod-before-prod-sync-20260914-230922.dump` into a
  freshly created `timetrack_pre-prod` with `pg_restore --no-owner`; the
  archive was verified readable and is git-ignored.

## 008 - Additive migrations 13-16 and production cutover notes

- **Date:** 2026-09-15
- **Author:** Cline

## 009 — Railway production snapshot restored to local production clone

- **Date:** 2026-09-15
- **Author:** operator + Cline
- **Target:** local PostgreSQL database `timetrack_prod` on `localhost:5433`
- **Source:** Railway production PostgreSQL database `railway` (project
  `TimeTrack`, environment `production`, service `Postgres`, PostgreSQL 18.6),
  reached through Railway's public TCP proxy (`RAILWAY_TCP_PROXY_DOMAIN`).
  Credentials were read at runtime with `railway variables --service Postgres
--json` into a temporary file outside the repo and deleted afterwards;
  nothing was written to this repo.
- **What changed:**
  1. Created a custom-format rollback dump of the pre-refresh local database
     at `backups/timetrack_prod-before-railway-20260915-203810.dump`
     (SHA-256: `FE3B50B64D139662E4E2C2F63DE938F7D4BCB10978468CB35A4CF5DD40E67FB2`,
     285,020 bytes). Note: taken with `--no-owner --no-privileges`, so unlike
     entry 006 this archive does NOT contain `timetrack_app` grants or RLS
     policy definitions; those are reprovisioned via the documented scripts
     (`db:runtime-role --apply`, `tenant:rls:enable --apply --confirm`).
  2. Created a custom-format snapshot of Railway production with
     `pg_dump -Fc --no-owner --no-privileges` (112 TOC entries, verified
     readable with `pg_restore -l` before any destructive step).
  3. Table-inventory comparison before restore: Railway production has 14
     public tables; local `timetrack_prod` contained all 14 plus 4 local-only
     tables (`AuditLogArchive`, `DevicePushToken`, `NativeRefreshToken`,
     `PayrollPeriodSnapshot`) from local migrations 13–16.
  4. Pre-dropped ALL local FK constraints in the public schema (21 total:
     17 on shared tables incl. the local-only `TimeEntry_geofenceId_fkey`,
     plus 4 from the local-only tables to `User`/`CompanyProfile`) so the
     `pg_restore --clean` phase was not blocked by schema drift — the same
     class of failure recorded in entry 006. An initial restore attempt
     without this step aborted atomically (`--single-transaction`,
     `--exit-on-error`); no data was touched.
  5. Replaced the 14 shared tables via `pg_restore --clean --if-exists
--no-owner --no-privileges --exit-on-error --single-transaction`
     (connections terminated first). The 4 local-only tables and their data
     (`NativeRefreshToken` 2 rows, others empty) were preserved untouched.
  6. Re-added the 4 local-only-table FK constraints exactly as before
     (`DevicePushToken_userId_fkey`, `DevicePushToken_companyProfileId_fkey`,
     `NativeRefreshToken_userId_fkey`,
     `PayrollPeriodSnapshot_companyProfileId_fkey`); validation passed with
     no orphaned rows, nothing deleted.
  7. Deleted the temporary production snapshot and all credential-bearing
     temp files; retained the local rollback dump under the git-ignored
     `backups/` directory.
- **Why:** refresh the local production clone with the current Railway
  production data for local investigation/development.
- **Verification:** all 14 shared public tables and their row counts match
  Railway production exactly: `AuditLog` 3,857; `CompanyProfile` 4;
  `CompanySettings` 5; `CronLock` 0; `Employee` 85; `EmployeeGeofence` 7;
  `EmploymentHistory` 168; `Geofence` 19; `LocationPreset` 0;
  `RetentionPolicy` 3; `Shift` 866; `TimeEntry` 614; `User` 90;
  `_prisma_migrations` 3. Post-restore state: `indexes=74`,
  `fk_constraints=20` (16 from the production schema + 4 re-added).
- **Post-restore state notes (same caveats as entry 006):** the shared tables
  now carry the production schema (`_prisma_migrations` = 3). RLS is not
  armed (`rls_enabled_tables=0`). `timetrack_app` table grants were
  automatically re-applied (72) via this database's default privileges. The
  orphaned seed geofence `id=cmt01sx7t0008p13zgifn6etz` is present again
  because it still exists in production data (1 null-tenant geofence). Before
  re-arming RLS, follow entry 006's re-provision order:
  `npm run db:migrate:deploy` → `npm run db:runtime-role -- --apply` →
  re-apply the entry 004 orphan-geofence deletion →
  `npm run tenant:rls:enable -- --apply --confirm`.
- **Rollback path:** restore
  `backups/timetrack_prod-before-railway-20260915-203810.dump` into
  `timetrack_prod` with `pg_restore --clean --if-exists --no-owner` (grants
  and RLS are NOT in the archive — reprovision them afterwards with the
  scripts above). The archive was verified readable and is git-ignored.

## 010 — Local production clone restored to local pre-production database

- **Date:** 2026-09-15
- **Author:** operator + Cline
- **Target:** local PostgreSQL database `timetrack_pre-prod` on `localhost:5433`
- **Source:** local PostgreSQL database `timetrack_prod` on the same
  PostgreSQL instance (itself refreshed from Railway production in entry 009,
  performed immediately beforehand in the same session).
- **What changed:**
  1. Created a custom-format rollback dump of the pre-refresh
     `timetrack_pre-prod` database at
     `backups/timetrack_pre-prod-before-prod-sync-20260915-203811.dump`
     (SHA-256: `CAC01DBA423F13409BBB4C366870ED26E8A1ADDB2D72BE462F8D10D0145079C4`,
     249,594 bytes), taken with `--no-owner --no-privileges` (pre-prod had no
     RLS policies and no `timetrack_app` grants before this change, so no
     hardening was lost).
  2. Created a custom-format snapshot of local `timetrack_prod` with
     `pg_dump -Fc --no-owner --no-privileges` (286,096 bytes).
  3. Pre-dropped all FK constraints in `timetrack_pre-prod`, terminated
     active connections, then replaced it via `pg_restore --clean --if-exists
--no-owner --no-privileges --exit-on-error --single-transaction`. The
     restore also created the 4 local-only tables there for full parity with
     the clone.
  4. Deleted the temporary `timetrack_prod` source snapshot; retained the
     pre-production rollback dump under the git-ignored `backups/` directory.
- **Why:** refresh local pre-production with the current local production
  clone so both non-production databases mirror live Railway production data
  for local testing and investigation.
- **Verification:** all 18 public tables and their row counts match between
  `timetrack_prod` and `timetrack_pre-prod` (0 mismatches): `AuditLog` 3,857;
  `AuditLogArchive` 0; `CompanyProfile` 4; `CompanySettings` 5; `CronLock` 0;
  `DevicePushToken` 0; `Employee` 85; `EmployeeGeofence` 7;
  `EmploymentHistory` 168; `Geofence` 19; `LocationPreset` 0;
  `NativeRefreshToken` 2; `PayrollPeriodSnapshot` 0; `RetentionPolicy` 3;
  `Shift` 866; `TimeEntry` 614; `User` 90; `_prisma_migrations` 3. Both
  databases report identical `indexes=74` and `fk_constraints=20`.
- **Rollback path:** restore
  `backups/timetrack_pre-prod-before-prod-sync-20260915-203811.dump` into
  `timetrack_pre-prod` with `pg_restore --clean --if-exists --no-owner`; the
  archive was verified readable and is git-ignored.

  `_prisma_migrations` 3. Post-restore state: `indexes=74`,
  `fk_constraints=20` (16 from the production schema + 4 re-added).

- **Target:** every environment at next deploy. Not applied locally yet: the
  local runtime role cannot read _prisma_migrations, so application must happen
  through MIGRATE_DATABASE_URL (elevated role) in staging first.
- **What changes:**
  1. Migration 13 adds CompanySettings.defaultWorkingStartTime /
     defaultWorkingEndTime / defaultWorkingDays with constant defaults
     (metadata-only ADD COLUMN, no table rewrite).
  2. Migration 14 creates DevicePushToken and PayrollPeriodSnapshot plus their
     indexes and foreign keys.
  3. Migration 15 creates NativeRefreshToken plus indexes and foreign key.
  4. Migration 16 creates three additive indexes on TimeEntry and AuditLog
     (plain CREATE INDEX; tables are small so the brief SHARE lock is
     sub-second).
- **Data impact:** none. No DROP, no column type change, no backfill UPDATE and
  no modification of existing rows. Active time entries (status = active) are
  untouched by every migration.
- **Behaviour at cutover:** the new company-default end-of-day auto clock-out
  applies to active entries that have neither an open shift nor an assigned
  location. Such entries are closed at the configured end instant, stamped
  updatedBy = system:cron and written to the audit log. Set
  COMPANY_DEFAULT_HOURS_CLOSE=false during the cutover window to preserve the
  legacy behaviour (16h stale close only) for sessions already active.
- **Rollback:** redeploy the previous commit. All new objects are additive and
  are ignored by the old code, so no data undo is required.

## 010 — Migration 17 (tenant columns NOT NULL) + fresh-database ordering repair

- **Date:** 2026-09-15
- **Author:** Cline
- **Target:** recorded migration history (`server/prisma/migrations`). No live
  database was modified by this entry; deployment remains owner-gated behind
  `npm run db:migrate:preflight` + `prisma migrate deploy`.
- **What changed:**
  1. **New migration `17_tenant_columns_not_null`** (closes Open-11): sets
     `companyProfileId` NOT NULL on `Employee`, `Shift`, `TimeEntry`,
     `Geofence`, `EmployeeGeofence`. Guarded — aborts before any DDL when
     legacy NULL-tenant rows remain. `schema.prisma` aligned (five models now
     non-nullable); server type fallout fixed in `application/attendance.ts`,
     `routes/employees.ts`, `routes/reports.ts`, `routes/settings.ts`,
     `routes/shifts.ts` (shift creation now fails fast without a tenant).
  2. **Fresh-database ordering repair (P0, pre-existing):** Prisma applies
     migrations in LEXICOGRAPHIC directory order, so `12_time_entry_minutes_
not_null` ran before `5_time_entry_integer_minutes` on any fresh database
     (CI included) and failed with `column "totalMinutes" does not exist`.
     Made the pending chain order-independent and replay-safe (only pending
     migrations were edited; applied migrations 0–2 are untouched, so no
     checksum violations): 12 pre-creates the column (IF NOT EXISTS) and
     fails loudly on un-backfillable rows; 5 became IF NOT EXISTS; 16 creates
     the `geofenceId` hot-path index conditionally and 7 creates it as the
     fresh-order fallback; 13/14/15 gained IF NOT EXISTS replay guards; 9
     (sorts last) enforces `EmployeeGeofence.companyProfileId` NOT NULL for
     the fresh-order case, 17 covers databases where the table exists.
- **Verification:** scratch database on localhost:5433 — full 18-migration
  `prisma migrate deploy` chain applied cleanly in lexicographic order, demo
  seed succeeded under NOT NULL enforcement, `information_schema` confirmed
  all five tenant columns `is_nullable = NO`; scratch dropped afterwards.
  Frontend+server typecheck clean; 34 unit suites / 291 tests green.
- **Rollback:** see `17_tenant_columns_not_null/MIGRATION.md` (DROP NOT NULL
  per column). The ordering guards are no-ops on chronologically-migrated
  databases and require no undo.

## 011 — Migration chain (3–17) applied to the local production clone + live-session hardening of migration 12

- **Date:** 2026-09-15
- **Author:** Cline
- **Target:** local PostgreSQL database `timetrack_prod` on `localhost:5433`
  (the Railway production clone refreshed in entry 009), plus one edit to the
  recorded migration history (`12_time_entry_minutes_not_null`).
- **Rollback dump taken first:**
  `backups/timetrack_backup_2026-09-15T19-43-53.dump` (0.27 MB,
  `pg_dump -Fc --no-owner --no-privileges`, git-ignored) — captures the clone
  exactly as entry 009 left it, including the 3 local-only tables dropped below.
- **What changed:**
  1. Re-applied the entry 004 guarded orphan-geofence deletion (exact recorded
     SQL; 1 row deleted: `id=cmt01sx7t0008p13zgifn6etz`, null-tenant, zero
     `EmployeeGeofence` assignments). This is a hard prerequisite for
     migration 17, which aborts on any NULL-tenant row.
  2. **Migration 12 hardened (live-session safety).** The first
     `migrate deploy` attempt failed at 12 (P3018): production data contains a
     live active session (`tintswalob64@gmail.com`, clocked in
     2026-09-15T07:12Z) and active entries never carry `totalHours` until
     closed — the old guard would abort ANY deploy while an employee is
     clocked in. 12 now backfills active rows with `totalMinutes = 0`, the
     same sentinel `application/attendance.ts` writes at clock-in (exact
     duration is written at clock-out). The loud abort remains for non-active
     rows with no duration data. The failed clone attempt was cleared with
     `prisma migrate resolve --rolled-back 12_time_entry_minutes_not_null`.
     The file was edited BEFORE 12 had been successfully applied on any
     persistent database (Railway never attempted it; scratch DBs were
     discarded), so no Prisma checksum is violated anywhere.
  3. Dropped the 3 local-only tables preserved by entry 009
     (`DevicePushToken`, `PayrollPeriodSnapshot`, `NativeRefreshToken` —
     artifacts of local pre-restore migration runs; they do NOT exist in
     Railway production) after migration 14 failed with `relation
"DevicePushToken_token_key" already exists`. Cleared with
     `prisma migrate resolve --rolled-back 14_push_tokens_and_payroll_snapshots`.
     This failure was clone-specific and cannot occur in production.
  4. Ran the full `prisma migrate deploy`: all 15 pending migrations (3–17 in
     lexicographic order) applied cleanly; `prisma migrate status` now reports
     "Database schema is up to date!" (18/18).
- **Why:** §12.1 pre-deployment gate 6 (`npm run predeploy`) and, more
  importantly, first real proof that the pending chain applies to the ACTUAL
  Railway production schema + data — the scratch-DB verification (entry 010)
  never exercised a live active session or the production drift.
- **PRODUCTION PREREQUISITE (before the Railway deploy):** apply the entry 004
  guarded deletion to Railway production — the orphan geofence still exists
  there. Without it, migration 17 aborts and `production-start.mjs` hard-fails
  the boot. Migration 12 is now live-session safe, so a clocked-in employee no
  longer blocks the cutover window.
- **Verification:** `npm run predeploy` exit 0 — env check ✅, db check ✅
  (orphan probe repaired for the post-migration-17 schema in
  `server/db_check.mjs`), migration preflight ✅ ("Database schema is up to
  date!"), 38 suites / 329 tests ✅.
- **Post-state notes:** clone RLS is still NOT armed (`rls_enabled_tables=0`);
  re-provision per entry 009's order (`db:runtime-role --apply`, then
  `tenant:rls:enable --apply --confirm`) — owner-gated. `timetrack_app` grants
  on the new tables come from the database's default privileges.
- **Rollback path:** restore `backups/timetrack_backup_2026-09-15T19-43-53.dump`
  with `pg_restore --clean --if-exists --no-owner --no-privileges`; the
  migration-12 edit is documented in its `MIGRATION.md` and needs no data undo.

## 012 — Production cutover prerequisite applied to Railway production (§12.1 gate 0)

- **Date:** 2026-09-15
- **Author:** operator + Cline
- **Target:** Railway production PostgreSQL (project `TimeTrack`, environment
  `production`, service `Postgres`), reached through Railway's public TCP
  proxy. Credentials were read at runtime with
  `railway variables --service Postgres --json` into a temporary file outside
  the repo and deleted afterwards; nothing credential-bearing was written to
  this repo or echoed to any log.
- **Pre-deploy snapshot:**
  `backups/railway-prod-before-deploy-20260915-215339.dump`
  (`pg_dump -Fc --no-owner --no-privileges`, 270,239 bytes; SHA-256:
  `C50E7A5ECB6DD4230C8A5E42C233760B4A14BFB9730E3F12DD8C60A4392636E0`;
  verified readable with `pg_restore -l` — 123 TOC entries — before any
  destructive step; git-ignored).
- **What changed:** re-applied the entry 004 guarded orphan-geofence deletion
  to Railway production (the exact recorded SQL, wrapped in a transaction
  with a post-check): `DELETE 1` — `id=cmt01sx7t0008p13zgifn6etz`, name
  `Main Office`, `companyProfileId IS NULL`, zero `EmployeeGeofence`
  assignments. This was §12.1 gate 0: migration 17 aborts on any NULL-tenant
  row and `production-start.mjs` hard-fails the deploy.
- **Staff-hours impact:** none. Zero `TimeEntry` rows were touched; the
  deletion removed one unassigned leftover seed geofence. Post-state scan:
  0 NULL-tenant rows across `Employee`, `Shift`, `TimeEntry`, `Geofence`,
  `EmployeeGeofence` — migration 17's guard set is fully satisfied.
- **Also set:** `COMPANY_DEFAULT_HOURS_CLOSE=false` on the `TimeTrack`
  service for the first deployment cycle (§12.2), so sessions already active
  at cutover keep the legacy close behaviour; remove the override after the
  first cycle.
- **Rollback path:** restore
  `backups/railway-prod-before-deploy-20260915-215339.dump` with
  `pg_restore --clean --if-exists --no-owner --no-privileges` (as with
  entries 006/009 the archive carries no grants/RLS — reprovision per the
  documented order), or re-insert the single geofence row from the archive.

## 013 — Migration 19: Employee.hourlyRate (Cost of Late Coming)

- **Date:** 2026-09-16
- **Author:** Cline (feature batch: owner backlog items 1/3/4/5/6/9)
- **Target:** local `timetrack_prod` clone on `localhost:5433`. Production
  application rides the normal deploy path (`db:migrate:deploy:elevated` /
  guarded preflight) — the SQL is idempotent (`ADD COLUMN IF NOT EXISTS`).
- **What changed:** `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS
"hourlyRate" DECIMAL(10,2)` — metadata-only, nullable, no default, no table
  rewrite, no modification of existing rows. Prisma schema aligned
  (`hourlyRate Decimal? @db.Decimal(10, 2)`); Prisma Client regenerated.
- **Why:** the Cost of Late Coming report converts late clock-in / early
  clock-out minutes into hours lost and Rand lost using a per-employee hourly
  rate (ZAR). Written by POST/PUT `/employees`; read by
  GET `/reports/attendance-cost` and GET `/reports/payroll`.
- **Applied with:** the elevated `MIGRATE_DATABASE_URL` role via
  `prisma db execute --file prisma/migrations/19_employee_hourly_rate/migration.sql`
  ("Script executed successfully."). The runtime `timetrack_app` role cannot
  ALTER tables by design (least privilege) — a plain `db push` was attempted
  first, aborted safely on a pre-existing local drift (DropForeignKey step)
  and changed nothing; the targeted `db execute` avoided touching that drift.
- **Staff-hours impact:** none. Zero existing rows modified; the column is
  NULL for every employee until a rate is set on the profile.
- **Rollback path:** `ALTER TABLE "Employee" DROP COLUMN IF EXISTS
"hourlyRate";` (elevated role) + revert the schema line and regenerate the
  client. No data outside the column is affected.
- **Addendum (same day, migration-history booking):** the strict migration
  preflight (predeploy step 2/4) surfaced that migrations 18 AND 19 were
  unbooked in `_prisma_migrations` — and that migration 18's column
  (`TimeEntry.isOfflineSynced`) had never actually been applied to this
  database (pre-existing drift from the db-push workflow, not from this
  entry). Resolution: `prisma migrate deploy` run with the elevated
  `MIGRATE_DATABASE_URL` role — applied 18 (plain ADD COLUMN, column was
  absent), re-ran 19 idempotently (`IF NOT EXISTS` no-op), and booked BOTH
  in `_prisma_migrations`. Post-state verified: both columns present
  (information_schema probe), `prisma migrate status` clean, full
  `npm run predeploy` pipeline green end-to-end including the new step 4/4
  OpenAPI Contract Drift Guard. Production note: the same `migrate deploy`
  (elevated) is the deploy-path action; 19 is idempotent, 18 is NOT — run
  deploy rather than db push so history stays booked.

## 2026-09-18 — Railway production → local clone sync (+ migration 20/21 rollout to local DBs)

- **What:** full production snapshot restore into the local clone and
  propagation to local pre-prod:
  1. `npm run db:sync:prod` (`scripts/sync-prod-to-local.mjs`): `pg_dump`
     from the Railway production Postgres (TCP proxy, `sslmode=require`;
     DSN supplied at runtime via `PROD_SNAPSHOT_URL` from the authenticated
     Railway CLI — never written to any repo file) and restore into local
     `timetrack_prod` (`--no-owner --no-privileges --clean --if-exists`).
     18 tables restored; production data now local (User 105, Employee 100,
     Shift 932, TimeEntry 743, Geofence 29, CompanySettings 6, AuditLog
     4059, EmploymentHistory 172, RetentionPolicy 3).
  2. `prisma migrate deploy` against the restored `timetrack_prod`:
     production history carried migrations 0–19; migrations
     `20_working_hours_schedules` and `21_saturday_overtime` were applied
     and booked (both idempotent/replay-safe).
  3. `npm run db:sync:preprod` (`scripts/sync-prod-to-preprod.mjs`): local
     `timetrack_prod` → `timetrack_pre-prod`; record-count verification
     printed ✅ MATCH for all 11 checked tables.
- **Grants:** both restores run as the superuser with `--no-privileges`,
  which drops the runtime role's table grants. Re-granted on BOTH
  databases: `GRANT USAGE, CREATE ON SCHEMA public TO timetrack_app`,
  `GRANT ALL … ON ALL TABLES/ALL SEQUENCES IN SCHEMA public`, plus
  `ALTER DEFAULT PRIVILEGES …` so future migrate-created objects stay
  usable by the runtime role.
- **Why:** develop/test the working-hours-schedules (migration 20) and
  Saturday-overtime (migration 21) features against real production data;
  keep the pre-prod clone byte-identical for release rehearsal.
- **Staff-hours impact:** none on production — this operation only READ
  production (single `pg_dump` snapshot transaction). All writes were to
  local databases.
- **Production state note:** migrations 20/21 are NOT yet applied or booked
  in Railway production (folders uncommitted at sync time). They ship with
  the next deploy via `scripts/production-start.mjs` → `prisma migrate
deploy`; both are replay-safe, 21 defaults Saturday overtime OFF so no
  payroll result changes until an admin enables it.
- **Addendum (same day, production deploy executed):** commit `790810e`
  pushed to `main` at ~13:06 UTC; Railway deployment `2b79412e` built
  (~4.5 min), ran `migrate deploy` (20 + 21 booked at 13:11:41 UTC), passed
  the `/ping` healthcheck and switched traffic with **zero downtime** — the
  previous deployment served continuously until switchover and drained
  gracefully. Verified post-deploy: 3 new `CompanySettings` columns present
  in production, `/ping` 200, **20 active clock-in rows intact** (migrations
  never touch `TimeEntry`), live traffic served by the new bundle, zero 5xx
  responses. Pre-deploy snapshot: `backups/prod-pre-deploy-2026-09-18.sql`
  (1.97 MB; the in-container best-effort backup was skipped — `pg_dump`
  absent from the Nixpacks image — so the manual snapshot was the operative
  pre-deploy backup, alongside Railway PITR). Observed non-fatal noise:
  3× pre-existing `audit.js` P2028 "Transaction already closed" audit-write
  failures (file untouched by this deploy; API responses all 200) — tracked
  as a separate follow-up fix.
- **Rollback path:** local-only — re-run either sync script to re-restore,
  or drop the local databases. No production rollback exists or is needed.

## 2026-09-25 — Migration 22: Employee.latePenaltyRate (Cost of Late Coming)

- **What changed:** `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS
"latePenaltyRate" DECIMAL(10,2)` — metadata-only, nullable, no default, no
  table rewrite, no modification of existing rows. Prisma schema aligned
  (`latePenaltyRate Decimal? @db.Decimal(10, 2)`); Prisma Client regenerated.
- **Why:** the Cost of Late Coming report should price late clock-ins / early
  clock-outs at a dedicated penalty rate when one is configured, falling back
  to `hourlyRate` otherwise. This lets payroll apply e.g. an overtime rate
  without touching the regular hourly rate.
- **Rollout:** ships with the next deploy via `prisma migrate deploy`; the
  column is replay-safe (IF NOT EXISTS) and nullable, so existing payroll
  results are unchanged until a penalty rate is set on an employee profile.
