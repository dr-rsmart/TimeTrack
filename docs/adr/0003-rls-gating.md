# ADR 0003 — Database RLS gated behind a runtime bridge

- **Status:** Accepted — **ARMED 2026-09-14** (Phase 4 completion)
- **Date:** 2026-09-14

## Context

PostgreSQL Row-Level Security is the strongest tenant-isolation backstop,
but enabling it while (a) legacy rows have NULL tenant keys and (b) the
application does not set `app.current_tenant` on every connection would
either hide or corrupt data. Superuser connections bypass RLS entirely, so
the application also had to stop connecting as a superuser.

## Decision

- Migration 6 installs integrity triggers (active) and RLS policies
  (dormant) only.
- Activation requires ALL of: zero legacy-null rows in strict tables,
  zero cross-tenant reference violations, the runtime transaction bridge
  adopted on every HTTP Prisma path, and explicit
  `RLS_RUNTIME_BRIDGE_READY=true` before `tenant:rls:enable --apply`.
- The application connects as a dedicated least-privilege role
  (`timetrack_app`, NOSUPERUSER NOBYPASSRLS — `setup_runtime_role.mjs`);
  schema changes use `MIGRATE_DATABASE_URL` with an elevated role.
- The runtime bridge (`tenantDatabase.ts`) wraps every /api request in an
  interactive transaction: unrestricted ('*') for the pre-auth phase,
  switched to the caller's tenant by requireAuth; an AsyncLocalStorage
  proxy (`prisma.ts`) delegates all queries to that transaction.
  Fire-and-forget audit writes self-bridge when outside a request.

## Consequences

- Positive: enforced 2026-09-14 — unbridged app-role sessions see 0 rows;
  tenant sessions see only their tenant; the full 78-test E2E suite passes
  with RLS active. Verified three-way isolation at the database level.
- Negative: one transaction per request (pool budget documented in
  OPERATIONS.md §8.2); maintenance tooling must remember the elevated
  role for DDL and role provisioning.
