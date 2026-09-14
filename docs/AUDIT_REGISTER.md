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

## Open findings (tracked)

| ID      | Finding                                                               | Owner                    | Target             |
| ------- | --------------------------------------------------------------------- | ------------------------ | ------------------ |
| Open-01 | Rotate leaked Railway Postgres password + history rewrite             | Owner (runbook step 1–2) | Phase 1 completion |
| Open-02 | Move Namecheap/iOS/ASC secrets to a secret manager                    | Owner (runbook step 3)   | Phase 1 completion |
| Open-03 | Enable RLS (bridge adoption + NOT NULL + `tenant:rls:enable --apply`) | Engineering + DB owner   | Phase 4            |
| Open-04 | SSE replay buffer per-process → Redis Streams                         | Engineering              | Phase 4            |
| Open-05 | Short-lived access tokens + refresh rotation                          | Engineering              | Phase 4            |
| Open-06 | Real CSP beyond `upgrade-insecure-requests`                           | Engineering              | Phase 4            |
| Open-07 | 16 moderate advisories in Expo/mobile build chain                     | Engineering              | Expo SDK upgrade   |
| Open-08 | Geofence/auto-clock triplication → shared core                        | Engineering              | Phase 3 remainder  |
| Open-09 | Oversized modules (>700 LOC) split                                    | Engineering              | Phase 3 remainder  |
| Open-10 | E2E axe a11y + visual snapshots                                       | Engineering              | Phase 3 remainder  |
