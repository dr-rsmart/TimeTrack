# TimeTrack API Changelog

All notable contract changes to the API are documented here. The
machine-readable contract lives at `GET /api/docs` (OpenAPI 3.1,
generated from the same Zod schemas used for runtime validation) and is
committed at `server/docs/openapi.json`.

Versions follow the `/api/v1` contract surface. The legacy `/api`
surface remains available and backward-compatible.

## v1.4.0 - 2026-09-16 (attendance cost, alerts, reminders, export formats)

### Added

- GET /reports/attendance-cost?from&to[&branch&department&employeeEmail] —
  Cost of Late Coming: per-employee late-in / early-out minutes vs the
  scheduled shift (business-timezone aware, midnight-crossing shifts
  supported, leave/half-day shifts excluded), converted to hours lost and
  Rand lost via `Employee.hourlyRate`. Response: `{ from, to, currency:
"ZAR", rows[], totals }` with per-day detail on each row.
- GET /reports/attendance-alerts?days=7[&grace=5] — in-app Notification
  Centre feed for admin/manager/master: late clock-ins, early clock-outs,
  no-shows and absences over the trailing window, newest-first, capped at 200. Employees get 403.
- `Employee.hourlyRate` (Decimal(10,2), nullable; migration 19) — accepted by
  POST /employees and PUT /employees/:id (`hourlyRate: number | null`), and
  returned on payroll report rows. Excluded from the bulk-import schema
  (manage-once-imported, like salaryInfo).
- Cron `shift-reminders` job — Expo push ~5 minutes before the beginning and
  the ending of every scheduled working shift; employees with no shift that
  day fall back to their company's `defaultWorkingStartTime` /
  `defaultWorkingEndTime` / `defaultWorkingDays` (normal business hours).

### Changed

- GET /reports/payroll rows now include `hourlyRate` (null when unset) so the
  payroll report can price overtime/lateness without a second call.
- Web payroll summary CSV export is now format-pluggable
  (`src/utils/payrollExportFormats.ts`): "TimeTrack Standard" (unchanged
  column set) and "Generic Payroll (Normal / OT / PH)" ship today; customer
  payroll-system formats register declaratively via `defineColumnFormat`.

## v1.3.1 - 2026-09-16 (native session-lifecycle hotfix)

### Changed

- POST /api/auth/native-token and POST /api/auth/native-token/refresh now sign
  PERSISTENT access tokens (no `exp` claim), matching the httpOnly web cookie
  lifetime policy; the response `expiresIn` field is now `null` (previously
  `900`). Revocation is unchanged: pwdEpoch bumps (password change/reset,
  logout), tenant suspension, termination and live role checks are enforced
  against bearer tokens on every request.
- The 15-minute access-token lifetime introduced in v1.3.0 is REMOVED: the
  server prefers Bearer over the cookie, so the short-lived bearer overrode
  the permanent cookie session and forced mobile users to re-authenticate
  every 15 minutes / on every app resume.
- The rotating 30-day refresh token is still issued and rotated on use (kept
  for shell cold-start restore); consumed or expired rows older than 24h are
  pruned daily by the cron runner (`native-refresh-token-prune`).
- The strict auth rate limiter (100/15min, IP-keyed) now applies only to the
  credential endpoints (/auth/login, /auth/forgot-password,
  /auth/native-token/refresh). The rest of the /auth subtree uses the general
  API limiter, so login abuse from a shared work-site NAT can no longer lock
  the whole site out of session traffic.
- The 401 SESSION_REVOKED error message no longer asserts a password change
  as the only cause (a logout/rotation on another device produces the same
  revocation).

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
