# TimeTrack — Architecture Reference (Consolidated)

**Version:** 2.0 · **Effective:** 2026-08-26 (Audit Cycle 15, post-remediation)
**Status:** This document supersedes overlapping claims in the seven legacy audit
reports (see **Supersession Log** at the bottom). When in doubt, the code is
ground truth; this document tells you where to look.

---

## 1. System topology (single replica, current production posture)

```
Browser (React 18 SPA)          Mobile (Expo WebView shell)
        │ REST + SSE (httpOnly cookie, credentials: include)
        ▼
Railway edge (TLS, Force HTTPS, www→apex 301)
        ▼
Express 5 API (single process)
  ├─ requestId → metrics counters → canonical-host/HTTPS guards
  ├─ CORS (explicit origins) · 1MB body cap · security headers
  ├─ Rate limits: /api 500/min, /api/auth 100/15min (Redis sliding window
  │  with in-memory fallback; perf bypass DISABLED in production)
  ├─ Auth: JWT 8h (httpOnly cookie-first) · pwdEpoch revocation ·
  │  fail-closed company-active / employee-status / session-state caches
  ├─ Routes: auth · employees · shifts · time-entries · dashboard ·
  │  reports · settings · audit · master · health · metrics
  ├─ SSE broker: scoped registry · 30s heartbeats · 500-event replay
  │  buffer (Last-Event-ID) · 10 streams/user cap · Redis pub/sub fan-out
  ├─ Cron (60s, DB-leased CronLock): no-show detection (TZ-safe, worked-day
  │  guard) · stale-entry auto-close (16h) · retention (AuditLog exempt)
  └─ Startup: partial-unique-index backstop · O(missing) account sync
        ▼                              ▼
PostgreSQL (Prisma 6, pool 50)   Redis (optional: rate limits · SSE fan-out
  12 models · enum types ·         · invalidation command channel)
  composite indexes · migration
  history 0_init + 1_session_revocation_and_unique_index
```

## 2. Security model (verified 2026-08-26)

| Control | Mechanism | Where |
|---|---|---|
| Secret boot gate | Fail-fast on missing/insecure `JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGIN` (HTTPS-only in prod); perf bypass null in prod | `server/src/config.ts` |
| Session revocation | `User.pwdEpoch` bumped on every password change/reset; JWT claim compared against live value (30s cached, fail-closed); SSE streams closed cluster-wide | `middleware/auth.ts`, `passwords.ts`, `invalidation.ts` |
| Default-password lifecycle | Provisioned/reset accounts get `mustChangePassword`; `/keep-password` rejects default hashes; UI hides the keep option (`usingDefaultPassword`) | `routes/auth.ts`, `ChangePasswordModal.tsx` |
| Tenant isolation | App-level: `tenantWhere()` + `AsyncLocalStorage` context + Prisma auto-stamp + `assertTenantMatch()` backstop; manager scope via `scopeRules.ts` with default-value bridge guard | `tenantContext.ts`, `prisma.ts`, `scopeRules.ts` |
| Suspension/termination | Enforced on every request, fail-closed, invalidated cluster-wide via Redis command channel | `middleware/auth.ts`, `invalidation.ts` |
| Least-privilege master | Impersonation/demo sessions may only call `/master/stop-impersonation` | `masterAuth.ts` |
| Punch integrity | Serializable check-then-insert (self AND bulk paths) + partial unique index (in migration history) + unified conflict mapping (never 500s on races) | `routes/timeEntries.ts`, migration `1_session_revocation_...` |
| Audit | Append-only, before/after diffs, IP redaction for managers, audit-access throttled logging; never purged by retention cron | `audit.ts`, `cron.ts` |
| Transport | HTTPS enforced (edge + app), HSTS, canonical host, open-redirect guard | `index.ts` |

## 3. Multi-instance story (what scales and what needs work)

**Cluster-correct today (with `REDIS_URL` set):**
- Rate limiting (shared sliding window)
- SSE event fan-out (pub/sub) — events reach clients on every replica
- Cache invalidation + stream revocation (invalidation command channel):
  suspension, termination, demotion and password rotation apply everywhere
  within milliseconds, not after TTL expiry

**Requires sticky sessions (documented constraint):**
- SSE replay buffer (500 events / 5 min) is per-process. Reconnecting to a
  *different* replica can replay nothing. Sticky sessions (cookie/IP hash)
  make replay coherent. Moving replay to Redis Streams is the P3 path.

## 4. Timezone convention

- DATE columns (`Shift.date`, `TimeEntry.date`) are stored at **UTC noon**
  (`parseDate`) — never construct them with local midnight.
- All wall-clock comparisons (cron no-show, "today" stats) run in the
  **business timezone**: `CRON_TIMEZONE` (IANA), defaulting to process TZ.
  See `server/src/timezone.ts` (unit-tested).

## 5. Observability

- `GET /health` deep probe (DB latency, Redis state, SSE clients, memory)
- `GET /ping` · `/live` · `/ready` probes (root + `/api` aliases)
- `GET /metrics` Prometheus text format (`server/src/metrics.ts`); alert
  rules live in `tests/perf/observability/prometheus-alerts.yml`
- Request correlation IDs (`X-Request-Id`) + structured logs

## 6. Delivery pipeline

- **CI gate** (`.github/workflows/ci.yml`): gitleaks → typecheck → vitest →
  production build → Playwright E2E against a real Postgres 16 service with
  schema push + seed. A red pipeline blocks the release.
- **Deploy:** Railway Nixpacks → `scripts/production-start.mjs`:
  best-effort backup → schema sync (`migrate deploy` when history is
  recognized, else safe `db push`; destructive drift = hard failure, never
  `--accept-data-loss`) → boot.
- **Rollback/DR:** `docs/OPERATIONS.md` runbooks; `server/backup_db.mjs`
  snapshots (`BACKUP_DIR`, `RETENTION_DAYS`).

## 7. Module map (where logic lives)

| Concern | Module |
|---|---|
| Payroll/overtime rules (Decimal) | `server/src/payroll.ts` |
| Shift overlap rules | `server/src/overlap.ts` |
| Geofence math | `server/src/geofence.ts` |
| Geofence enforcement policy | `server/src/geoValidationService.ts` |
| Manager scope decision (pure) | `server/src/scopeRules.ts` |
| Master route authorization (pure) | `server/src/masterAuth.ts` |
| Password/epoch rules (pure) | `server/src/passwords.ts` |
| Business-timezone rules (pure) | `server/src/timezone.ts` |
| Cluster invalidation fan-out | `server/src/invalidation.ts` |
| Prometheus counters | `server/src/metrics.ts` |
| Circuit breaker (integration-ready) | `server/src/circuitBreaker.ts` |

Pure modules carry no config/prisma imports so they are unit-testable in
isolation — keep them that way.

## 8. Supersession log (legacy audit docs)

| Doc | Superseded claims |
|---|---|
| `AUDIT_REPORT.md` (08-18) | "in-memory state incompatible with horizontal scaling" — invalidation + fan-out now Redis-published (single-instance constraint limited to SSE replay) |
| `E2E_AUDIT_REPORT.md` | Test counts cited as full verification — see B8 remediation; specs now test shipped modules |
| `SYNC_AUDIT_REPORT.md` | "Residual: in-memory replay buffer requires Redis-backed replay" — still true; sticky-session workaround documented above |
| `QA_AUDIT_REPORT.md` | Endpoint inventory still accurate; keep-password/rotation claims superseded by cycle-15 fixes |
| `TRANSFORMATION_AUDIT_REPORT.md` | Business-rule table still accurate; cron no-show now TZ-safe with worked-day guard |
| `PERFORMANCE_AUDIT_REPORT.md` | k6 protocol still valid; `/metrics` now available for live scraping |
| `OPERATIONS.md` | "Run `db:migrate:deploy`" — now automated by production-start.mjs detection logic |
| `AUDIT_CYCLE15_REPORT.md` | The authoritative issue register (B1–B17) and remediation log |

---
*When you change architecture, update this file in the same PR.*
