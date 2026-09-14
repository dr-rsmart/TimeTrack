# TimeTrack Controlled Rebuild

## Purpose

This document records the incremental rebuild boundary for
`C:\Users\Ricardo Smart\Desktop\2026 09 06_TimeTrack`.

The stakeholder-facing UI, existing feature set, and automatic clock-in/out
behavior are compatibility requirements. The rebuild therefore uses an
expand-and-contract approach rather than a disruptive rewrite.

## Slice 1 — Attendance reliability foundation

Implemented in this slice:

- Pure attendance domain rules for worked-hour calculation, status values, and
  bounded idempotency keys.
- Durable `Idempotency-Key` support for clock-in and clock-out requests.
- Database-backed unique indexes for both retry-key columns (`3_attendance_idempotency`).
- Tenant filters strengthened on active-session reads and clock-outs.
- Cross-tenant protection added to the clock-in orphan self-healing path.
- Critical attendance audit writes now have a required/observable mode with a
  Prometheus failure counter.
- Regression tests for the new pure domain rules.

Not changed:

- Existing UI layout, styling, routes, or stakeholder workflows.
- Existing geofence thresholds, confirmation behavior, or mobile bridge.
- Existing response payload shapes for ordinary clients.
- Existing employee-email fields; migration to employee IDs remains a later
  expand-and-contract phase.

## Next slices

### Slice 2 — Attendance application use cases

Implemented:

- Extracted clock-in and clock-out orchestration into
  `server/src/application/attendance.ts`.
- Kept Express routes as HTTP adapters for validation, request metadata, status
  codes, and standardized error envelopes.
- Preserved the existing browser and native API paths, response payloads,
  geofence policy, re-clock guard, tenant checks, idempotency behavior, audit
  attempts, and SSE events.
- Removed the duplicate legacy clock-in/out route implementations.

Not extracted yet:

- Manual time-entry creation
- Bulk clock-in/out
- Manual time-entry adjustment/delete
- Cron shift-end/stale-entry transitions

Those operations remain compatible route handlers and are candidates for the
next attendance service extraction after this slice is validated in production-
like integration tests.

### Slice 3 — Complete attendance mutation extraction

Implemented:

- Extracted manual time-entry creation into `createManualTimeEntry`.
- Extracted bulk clock-in and bulk clock-out into application use cases.
- Extracted manual time-entry adjustment and deletion.
- Preserved partial-success bulk results, tenant checks, manager scope checks,
  payroll duration calculations, audit attempts, and SSE events.
- Reduced the route to HTTP validation, request metadata, response mapping, and
  query endpoints; direct attendance mutation persistence no longer lives in
  `routes/timeEntries.ts`.

### Planned slices

### Slice 4 — Shared wire contracts

Implemented:

- Added the dependency-free `@timetrack/contracts` package under
  `contracts/`.
- Centralized role, employee status, shift status/type, attendance status/action,
  and standard API error-code values.
- Centralized shared auth, time-entry, attendance request, bulk response, and
  pagination wire types.
- Preserved compatibility exports through `src/contracts/attendance.ts` and
  `src/services/api.ts`, so existing UI imports continue to work.
- Added contract parity tests covering runtime constants and lifecycle values.

Runtime validation remains in the server Zod schemas for now; the next contract
step can safely derive or colocate those schemas after this type boundary has
been exercised by the full build and test pipeline.

### Planned slices

### Slice 5 — Employee identity bridge

Implemented:

- Added migration `4_employee_identity_backfill`.
- Conservatively backfilled unambiguous `TimeEntry.employeeId` and
  `Shift.employeeId` relationships by normalized email and tenant.
- Added employee-ID/date/status indexes for attendance and shift reads.
- Added `server/src/domain/employeeIdentity.ts` with ID-first filters and
  explicit legacy fallback behavior.
- Updated attendance mutations, payroll reporting, and dashboard aggregation to
  prefer `employeeId` while retaining legacy unlinked rows.
- Added read-only `server/db_identity_check.mjs` for migration verification and
  ambiguous-match reporting.
- Added identity bridge unit tests.

Not changed:

- Legacy `employeeEmail` columns remain for compatibility and audit/display use.
- Tenant foreign keys remain nullable until production backfill coverage is
  measured and reviewed.
- Ambiguous email matches are intentionally not guessed or auto-linked.

### Planned slices

### Slice 6 — Remaining identity migration paths

Implemented:

- Added ID-first geofence employee lookup with email fallback for legacy callers.
- Added optional employee-ID manager-scope checks and updated shift mutation
  access checks to use existing shift employee IDs.
- Updated cron shift-end auto-close and no-show detection to prefer
  `shift.employeeId`, with explicit legacy fallback for unlinked shifts.
- Updated time-entry list/active and shift list reads to use identity filters.
- Extended the identity verification utility to report ambiguous shift matches.
- Preserved legacy email columns, query parameters, and response shapes.

Important limitation:

- Email remains an accepted compatibility identifier for legacy clients and
  unresolved rows. No ambiguous record is automatically assigned.

### Planned slices

1. Run migration 4 and review `db_identity_check.mjs` output per tenant.
2. Resolve approved ambiguous/unresolved identity records through a controlled
   data-maintenance workflow.
3. Add database-level tenant enforcement and adversarial integration tests.

### Slice 7 — Controlled identity resolution workflow

Implemented:

- Added `server/identity_preflight.mjs` for read-only migration readiness checks.
- Added strict preflight mode (`--strict`) for deployment/data-gate automation.
- Added JSON output mode (`--json`) for CI and operational dashboards.
- Added `server/resolve_employee_identity.mjs` for explicit approved mappings.
- Resolution is dry-run by default; writes require `--apply` plus explicit audit
  actor identity.
- Resolution validates source unresolved state, source/target emails, target
  employee existence, tenant alignment, approver, and reason.
- Applied mappings run transactionally and create `AuditLog` records.
- Added pure migration-rule tests and an approval mapping example at
  `docs/identity-resolution.example.json`.
- Added npm commands:
  - `npm run identity:preflight`
  - `npm run identity:resolve`

Operational workflow:

```text
npm run identity:preflight -- --json
npm run identity:preflight -- --strict
npm run identity:resolve -- --mapping docs/identity-resolution.example.json
npm run identity:resolve -- --mapping <approved-file> --apply --actor-id <id> --actor-email <email>
```

No live identity mappings were applied by this rebuild session. The database
owner must review preflight output and provide approved mappings before using
`--apply`.
### Slice 8 — Exact persisted attendance duration

Implemented:

- Added nullable `TimeEntry.totalMinutes` as the exact persisted payable
  duration, using whole minutes rather than PostgreSQL floating-point hours.
- Kept `TimeEntry.totalHours` and the existing API response shape for backward
  compatibility; new writes dual-write both representations.
- Added `server/src/domain/duration.ts` with shared minute/hour conversion,
  calculation, and legacy fallback rules.
- Updated self-service, proxy, manual, bulk, cron, seed, payroll, dashboard,
  and master-stat paths to write or read `totalMinutes` first while retaining
  the legacy `totalHours` fallback.
- Added migration `5_time_entry_integer_minutes`, which only adds the nullable
  column. It does not backfill or remove the legacy column automatically.
- Added read-only `server/duration_preflight.mjs` and controlled
  `server/backfill_time_entry_minutes.mjs` tooling.
- Backfill is dry-run by default and requires explicit `--apply`; it preserves
  existing `totalHours` values and is safe to rerun because it only fills null
  `totalMinutes` values.
- Added exact-duration unit coverage and exposed optional `totalMinutes` in the
  shared wire contract.

Operational workflow:

```text
npm run duration:preflight -- --json
npm run duration:preflight -- --strict
npm run duration:backfill -- --json
npm run duration:backfill -- --apply --json
npm run duration:preflight -- --strict
```

The migration and backfill were not applied by this rebuild session. Migration
5 must be deployed by the database owner, then the preflight reviewed before
the explicit backfill command is considered. `totalHours` removal or
non-null enforcement remains a separate future contract phase.

### Slice 9 — Database tenant enforcement preparation

Implemented:

- Added pure tenant policy rules in `server/src/tenantPolicy.ts` for tenant,
  unrestricted master/system, legacy-null, write, and cross-tenant-reference
  decisions.
- Added `server/src/tenantDatabase.ts`, a transaction-local bridge that sets
  `app.current_tenant` and disables legacy-null access by default.
- Added migration `6_tenant_integrity_and_rls_prepare`.
- The migration installs cross-tenant integrity triggers for employee, shift,
  time-entry, and employee-geofence references.
- The migration prepares PostgreSQL RLS policies for tenant-bearing tables but
  does not enable or force RLS automatically.
- Legacy-null rows are not visible to normal tenant RLS contexts; an explicit
  maintenance transaction setting is required to inspect them.
- Added read-only `server/tenant_rls_preflight.mjs` and guarded
  `server/enable_tenant_rls.mjs` tooling.
- Added adversarial unit tests covering cross-tenant reads/writes, unrestricted
  master/system access, legacy-null handling, reference mismatches, and strict
  activation gates.
- Added npm commands:
  - `npm run tenant:preflight`
  - `npm run tenant:rls:enable`

Operational workflow:

```text
npm run tenant:preflight -- --json
npm run tenant:preflight -- --strict
npm run tenant:rls:enable -- --json
npm run tenant:rls:enable -- --apply --confirm --json
```

RLS activation is intentionally blocked until `RLS_RUNTIME_BRIDGE_READY=true`
is set by the database/application owner after all HTTP Prisma operations use
the transaction bridge. Migration 6 and RLS activation were not applied during
this rebuild session. Existing application-level tenant filters remain active.