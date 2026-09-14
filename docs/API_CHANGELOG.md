# TimeTrack API Changelog

All notable contract changes to the API are documented here. The
machine-readable contract lives at `GET /api/docs` (OpenAPI 3.1,
generated from the same Zod schemas used for runtime validation) and is
committed at `server/docs/openapi.json`.

Versions follow the `/api/v1` contract surface. The legacy `/api`
surface remains available and backward-compatible.

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
