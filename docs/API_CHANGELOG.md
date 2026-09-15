# TimeTrack API Changelog

All notable contract changes to the API are documented here. The
machine-readable contract lives at `GET /api/docs` (OpenAPI 3.1,
generated from the same Zod schemas used for runtime validation) and is
committed at `server/docs/openapi.json`.

Versions follow the `/api/v1` contract surface. The legacy `/api`
surface remains available and backward-compatible.

## v1.3.0 - 2026-09-15 (QA remediation release)

### Added

- POST /api/auth/push-token - registers a device push token (Expo) for the
  authenticated user; tokens whose delivery fails with DeviceNotRegistered are
  deactivated automatically.
- POST /api/auth/native-token now returns { token, refreshToken, expiresIn }:
  a 15-minute access token plus a one-time rotating 30-day refresh token
  (SHA-256 hashed at rest, revoked on use).
- POST /api/auth/native-token/refresh - rotates the refresh token and issues a
  new access token.
- GET /api/auth/me now includes businessTimezone.
- GET /api/reports/payroll accepts employeeEmail and employeeId filters.
- GET /api/time-entries accepts branch and department filters.
- POST /api/reports/payroll/snapshot and GET /api/reports/payroll/snapshots -
  immutable per-period payroll results for reproducible history.

### Changed

- Multi-day shift creation defaults to a Monday-Friday weekly template when the
  client omits weeklySchedule, so weekends are no longer implicitly scheduled.
- Company settings accept defaultWorkingStartTime, defaultWorkingEndTime and
  defaultWorkingDays; the cron auto clock-out uses them for employees with
  neither a shift nor an assigned location (gated by COMPANY_DEFAULT_HOURS_CLOSE).
- SSE replay uses a Redis stream with a globally monotonic sequence when
  REDIS_URL is configured; the local ring buffer remains the no-Redis fallback.
- Static assets are served immutable with a one-year max-age in production;
  index.html stays no-cache.

### Database

- Migrations 13-16, all additive: company default working hours;
  DevicePushToken + PayrollPeriodSnapshot; NativeRefreshToken; hot-path indexes
  on TimeEntry and AuditLog. No drops, no rewrites, no backfills.

## v1.2.0 — 2026-09-14 (Phase 4 — RLS armed)

### Security

- **PostgreSQL RLS is now enforced.** The application runs as a dedicated
  least-privilege role (`timetrack_app`); every `/api` request executes in
  a tenant transaction bridge (`app.current_tenant`), so DB-level row
  security applies to all traffic. Unbridged sessions observe zero rows.
- Native shell bearer tokens now carry a rolling 7-day TTL.
- Production responses carry a full Content-Security-Policy.
- Runtime dependency audit: 0 vulnerabilities (server).

### Database

- Migrations 11–12: `AuditLogArchive` table + `TimeEntry.totalMinutes`
  NOT NULL (self-backfilling).
- `npm run db:runtime-role` provisions the runtime role;
  `tenant:rls:enable --apply --confirm` arms RLS; both idempotent.

## v1.1.0 — 2026-09-14 (Phase 2 remediation)

### Added

- `/api/v1` versioned mount of the full route surface (legacy `/api`
  aliases retained; `GET /api/v1/docs` serves the OpenAPI document).
- Pagination envelope on collection endpoints (`employees`, `shifts`,
  `time-entries`, `audit`): responses now include `limit` and `offset`
  alongside the existing `items`/`total`, plus `X-Total-Count`,
  `X-Limit` and `X-Offset` headers. Query `limit`/`offset` are clamped
  (1–500 limit, offset ≥ 0); invalid values fall back to defaults.
- CSRF origin validation on state-changing requests: cross-origin
  requests with a disallowed `Origin` are rejected with HTTP 403 and
  code `CSRF_REJECTED` (Origin-less, non-browser clients are unaffected).

### Security

- Server runtime dependencies: 0 known vulnerabilities.
- Database migrations 8–10: partial unique index recorded, tenant key
  added to `EmploymentHistory`, missing `TimeEntry` adjustment columns
  added to migration history (fresh-database deploys now match code).

## v1.0.0 — historical baseline

The pre-contract surface: 78 endpoints, standardized `{ error, code,
details, suggestions }` error envelope, cookie-first auth, SSE realtime.
Inventory preserved in `docs/QA_AUDIT_REPORT.md` (historical) and now in
the OpenAPI document.
