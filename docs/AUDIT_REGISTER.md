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

## Open findings (tracked)

| ID      | Finding                                                                                                                                                                                                    | Owner                    | Target                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------- |
| Open-01 | Rotate leaked Railway Postgres password + history rewrite                                                                                                                                                  | Owner (runbook step 1–2) | Phase 1 completion                            |
| Open-02 | Move Namecheap/iOS/ASC secrets to a secret manager                                                                                                                                                         | Owner (runbook step 3)   | Phase 1 completion                            |
| Open-03 | Enable RLS — ✅ DONE 2026-09-14: runtime bridge adopted (transaction-per-request + ALS proxy), least-privilege `timetrack_app` role, RLS ENABLED+FORCED, three-way isolation verified, 78/78 E2E under RLS | —                        | Closed                                        |
| Open-04 | SSE replay buffer per-process -> Redis Streams - DONE 2026-09-15 when REDIS_URL is configured (Redis stream + global INCR sequence); local ring buffer remains the no-Redis fallback                       | Engineering              | Closed (with fallback)                        |
| Open-05 | Full refresh-token rotation - DONE 2026-09-15: 15-minute native access tokens plus one-time rotating 30-day refresh tokens, SHA-256 hashed at rest and revoked on use                                      | Engineering              | Closed                                        |
| Open-06 | Real CSP beyond `upgrade-insecure-requests` — DONE 2026-09-14 (full CSP shipped)                                                                                                                           | —                        | Closed                                        |
| Open-07 | 14 moderate advisories in Expo/mobile build chain (react-router pair cleared via v7.18.4 upgrade 2026-09-15)                                                                                               | Engineering              | Expo SDK upgrade — `EXPO_SDK_UPGRADE_PLAN.md` |
| Open-08 | Geofence/auto-clock triplication → shared core                                                                                                                                                             | Engineering              | Phase 3 remainder                             |
| Open-09 | Oversized modules (>700 LOC) split                                                                                                                                                                         | Engineering              | Phase 3 remainder                             |
| Open-10 | E2E axe a11y + visual snapshots                                                                                                                                                                            | Engineering              | Phase 3 remainder                             |
| Open-11 | NOT NULL on all tenant columns — ✅ DONE 2026-09-15: migration 17 (guarded) + schema alignment + fresh-DB ordering repair of the pending chain (12-before-5 P0 fixed); scratch-DB verified deploy+seed     | —                        | Closed                                        |
| Open-12 | Secret rotation (Railway Postgres, Namecheap, ASC) and workstation credential cleanup - accepted as tracked owner debt; explicitly NOT a release gate per owner decision 2026-09-15                        | Owner                    | Tracked                                       |
