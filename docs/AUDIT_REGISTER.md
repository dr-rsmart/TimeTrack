# TimeTrack — Living Audit Register

**Purpose:** single authoritative record of remediation history and open
findings. Supersedes the per-cycle audit reports listed below, which are
retained as historical artifacts only — their scores and claims are NOT
current. For current state, trust this register + the code.

**Last updated:** 2026-09-14 (post-Phase-3 remediation)

## Superseded reports

| Report                           | Fate                                                           |
| -------------------------------- | -------------------------------------------------------------- |
| `AUDIT_REPORT.md` (08-18)        | Historical — security remediation log                          |
| `AUDIT_CYCLE15_REPORT.md`        | Historical — B1–B17 issue register                             |
| `E2E_AUDIT_REPORT.md`            | Historical — test-coverage claims superseded                   |
| `SYNC_AUDIT_REPORT.md`           | Historical — replay-buffer constraint still open (see Open-04) |
| `QA_AUDIT_REPORT.md`             | Historical — endpoint inventory migrated to OpenAPI            |
| `TRANSFORMATION_AUDIT_REPORT.md` | Historical — business rules table still accurate               |
| `PERFORMANCE_AUDIT_REPORT.md`    | Historical — k6 protocol still valid                           |
| `OPERATIONS.md`                  | Live (runbook), corrected to real topology                     |

## Remediation status (2026-09-14)

| Phase | Scope                                                                                                             | Status                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1     | Credential redaction, dep hardening (0 crit/high), lint/format/coverage gates, deploy hard-fail, restore drill    | ✅ DONE (owner-only items in `SECURITY_REMEDIATION_RUNBOOK.md`) |
| 2     | tenantWhere consolidation, boot-write removal, migrations 8–10, CSRF guard, /api/v1, pagination envelope, OpenAPI | ✅ DONE                                                         |
| 3     | jsdom component tests, pino logging, husky gate, ADRs, register                                                   | ✅ DONE (sub-items below)                                       |
| 4     | RLS/NOT-NULL arm, CSP, token rotation, scale hardening                                                            | ⏳ In progress / owner-gated                                    |

**Phase 1 tooling (2026-09-15):** `npm run owner:gate`
(`scripts/owner-gate-check.mjs`) mechanically verifies the owner-only items
Open-01/02/12 + REDIS_URL (G1–G5) — exit 0 means every owner gate is closed.
G1 already passes locally (all 75 reachable revisions clean; leaked commits
are unreachable objects). `server/env_check.mjs` now warns loudly when
production runs without Redis (single-instance degraded mode). Frontend
runtime advisory cleared: `react-router-dom` 6 → 7.18.4 (declarative-mode
drop-in; typecheck + 291 unit tests + production build verified).

**Phase 2 (2026-09-15, engineering items):** cron lifecycle transitions
extracted to `server/src/application/scheduling.ts` (DI-tested, 8 specs —
completes REBUILD_STATUS slice 3); AuditLog growth gauge
(`timetrack_audit_log_rows`, 10-min cron sampler) + opt-in daily archival
(`AUDIT_ARCHIVE_ENABLED=true`, `AUDIT_ARCHIVE_OLDER_THAN_DAYS`) + production
Prometheus alerts (`timetrack-production-capacity` group in
`tests/perf/observability/prometheus-alerts.yml`); weekly automated backup +
restore drill (`.github/workflows/restore-drill.yml`, Mondays 03:00 UTC);
Open-09 `max-lines` ratchet armed in both eslint configs.

**Feature batch (2026-09-16, owner backlog items 1/3/4/5/6/9):** Cost of Late
Coming shipped end-to-end — `Employee.hourlyRate` (migration 19, applied to
the local prod-clone via the elevated `MIGRATE_DATABASE_URL` role; runtime
role cannot ALTER by design), pure engine `server/src/domain/attendanceCost.ts`
(late-in/early-out minutes incl. midnight-crossing shifts, leave/half-day
exclusion), `GET /reports/attendance-cost` (hours + Rand lost per employee,
ZAR), Reports "Cost of Late" tab + CSV, hourly-rate field on the employee
profile form. In-app Notification Centre for managers (no separate
notification channel): `GET /reports/attendance-alerts` (late-ins, early-outs,
no-shows, absences over a trailing window) + `NotificationBell` header
dropdown with localStorage unread badge and 60s polling. Shift reminders:
new `shift-reminders` cron job pushes 5 minutes before shift start AND end
(Expo push via DevicePushToken), with company default-working-hours fallback
for employees with no shift that day (`isReminderDue` window + per-instance
dedupe). Reports gained a "Daily Breakdown" tab (per-employee daily clocking
A–Z + `Normal Hours = X / Overtime = Y / Public Holiday = Z` lines) and the
payroll summary export became format-pluggable
(`src/utils/payrollExportFormats.ts`; customer payroll-system formats are a
data-only addition once specs are supplied). Verified: typecheck (web+server),
49 suites / 467 tests, production build, eslint 0 errors.

**Contract-drift closure (2026-09-16, rev 2):** the v1.4.0 report endpoints
were registered in `server/src/openapi.ts` and `server/docs/openapi.json`
regenerated (53 paths, generation verified deterministic). `predeploy-check.mjs`
gained a fail-closed step 4/4 (OpenAPI Contract Drift Guard): it regenerates
the spec and byte-compares against the committed file, aborting the deploy on
any drift and leaving the regenerated spec in place for review. Detection path
verified with a simulated stale spec. Architect review persisted at
`docs/COMPONENT_COMPARISON_MATRIX.md`.

**Deployment-readiness remediation (2026-09-16, audit P0/P2/P4):** store
blocker closed — `https://time-track.tech/privacy` and `/support` (declared in
`scripts/submit-to-app-store.mjs` metadata) previously rendered an empty SPA
shell (live-probed); real public pages `src/pages/Privacy.tsx` (POPIA/GDPR-
aligned, grounded in documented practices: geofence location processing,
IP redaction, append-only audit, RLS, retention) and `src/pages/Support.tsx`
now route OUTSIDE the auth guard, are linked from the Login footer and listed
in `sitemap.xml`. Stale native landmines quarantined: `mobile/android/
AndroidManifest.xml` (nonexistent service/receiver classes, BIND_DEVICE_ADMIN)
and `mobile/ios/Info.plist` (`armv7`, CFBundleVersion 1) moved to
`docs/reference/native-artifacts/` with a DO-NOT-USE README — `app.json` is
the native SSOT (EAS CNG). Railway: duplicate `railway.toml` deleted
(`railway.json` single source), buildCommand now prunes ROOT devDependencies
after build (server devDeps intentionally kept: `prisma` CLI is required by
`production-start.mjs` at boot); PWA manifest gained a maskable icon entry.
Remaining audit items are owner/account-gated: Sentry adoption (needs DSN),
secret rotation (runbook steps 1–3), mobile CI (EAS remote credentials).

## Open findings (tracked)

| ID      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                    | Owner                    | Target                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | --------------------------------------------- |
| Open-01 | Rotate leaked Railway Postgres password + history rewrite                                                                                                                                                                                                                                                                                                                                                                                  | Owner (runbook step 1–2) | Phase 1 completion                            |
| Open-02 | Move Namecheap/iOS/ASC secrets to a secret manager                                                                                                                                                                                                                                                                                                                                                                                         | Owner (runbook step 3)   | Phase 1 completion                            |
| Open-03 | Enable RLS — ✅ DONE 2026-09-14: runtime bridge adopted (transaction-per-request + ALS proxy), least-privilege `timetrack_app` role, RLS ENABLED+FORCED, three-way isolation verified, 78/78 E2E under RLS                                                                                                                                                                                                                                 | —                        | Closed                                        |
| Open-04 | SSE replay buffer per-process -> Redis Streams - DONE 2026-09-15 when REDIS_URL is configured (Redis stream + global INCR sequence); local ring buffer remains the no-Redis fallback                                                                                                                                                                                                                                                       | Engineering              | Closed (with fallback)                        |
| Open-05 | Full refresh-token rotation - DONE 2026-09-15: 15-minute native access tokens plus one-time rotating 30-day refresh tokens, SHA-256 hashed at rest and revoked on use                                                                                                                                                                                                                                                                      | Engineering              | Closed                                        |
| Open-06 | Real CSP beyond `upgrade-insecure-requests` — DONE 2026-09-14 (full CSP shipped)                                                                                                                                                                                                                                                                                                                                                           | —                        | Closed                                        |
| Open-07 | 14 moderate advisories in Expo/mobile build chain (react-router pair cleared via v7.18.4 upgrade 2026-09-15)                                                                                                                                                                                                                                                                                                                               | Engineering              | Expo SDK upgrade — `EXPO_SDK_UPGRADE_PLAN.md` |
| Open-08 | Geofence/auto-clock triplication → shared core                                                                                                                                                                                                                                                                                                                                                                                             | Engineering              | Phase 3 remainder                             |
| Open-09 | Oversized modules (>700 LOC) — RATCHET ARMED 2026-09-15: `max-lines` (700, warn) in both eslint configs blocks growth; offenders: server `application/attendance.ts` (869), `routes/settings.ts` (861), `routes/employees.ts` (826), `routes/master.ts` (769), `routes/dashboard.ts` (713); web `GeofenceManager.tsx` (1041), `Register.tsx` (918), `Shifts.tsx` (914), `Employees.tsx` (860), `api.ts` (739). Physical splits remain open | Engineering              | Phase 3 remainder                             |
| Open-10 | E2E axe a11y + visual snapshots                                                                                                                                                                                                                                                                                                                                                                                                            | Engineering              | Phase 3 remainder                             |
| Open-11 | NOT NULL on all tenant columns — ✅ DONE 2026-09-15: migration 17 (guarded) + schema alignment + fresh-DB ordering repair of the pending chain (12-before-5 P0 fixed); scratch-DB verified deploy+seed                                                                                                                                                                                                                                     | —                        | Closed                                        |
| Open-12 | Secret rotation (Railway Postgres, Namecheap, ASC) and workstation credential cleanup - accepted as tracked owner debt; explicitly NOT a release gate per owner decision 2026-09-15                                                                                                                                                                                                                                                        | Owner                    | Tracked                                       |
