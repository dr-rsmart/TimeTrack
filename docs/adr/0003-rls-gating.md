# ADR 0003 — Database RLS gated behind a runtime bridge

- **Status:** Accepted
- **Date:** 2026-09-14

## Context

PostgreSQL Row-Level Security is the strongest tenant-isolation backstop,
but enabling it while (a) legacy rows have NULL tenant keys and (b) the
application does not set `app.current_tenant` on every connection would
either hide or corrupt data.

## Decision

- Migration 6 installs integrity triggers (active) and RLS policies
  (dormant) only.
- Activation requires ALL of: zero legacy-null rows in strict tables,
  zero cross-tenant reference violations, the runtime transaction bridge
  adopted on every HTTP Prisma path, and explicit
  `RLS_RUNTIME_BRIDGE_READY=true` before `tenant:rls:enable --apply`.

## Consequences

- Positive: no data-integrity cliff; application-level tenancy remains
  the primary control until the DB backstop is safely armed.
- Negative: the strongest guarantee is still pending — tracked as an
  explicit Phase 4 deliverable with preflight gates.
