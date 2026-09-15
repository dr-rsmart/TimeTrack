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
