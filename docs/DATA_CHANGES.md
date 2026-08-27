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