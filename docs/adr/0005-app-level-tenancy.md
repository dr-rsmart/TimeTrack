# ADR 0005 — Application-level tenancy with DB enforcement in depth

- **Status:** Accepted
- **Date:** 2026-09-14

## Context

Multi-tenant isolation cannot rely on query discipline alone; a single
missed `companyProfileId` filter leaks a tenant's data.

## Decision

Defense-in-depth, in order of strength:

1. Explicit `tenantWhere()` filters on every tenant-scoped query
   (single shared implementation, `tenantPolicy.ts`).
2. Prisma extension auto-stamps `companyProfileId` on creates and
   `assertTenantMatch()` fails loudly on cross-tenant reads.
3. PostgreSQL integrity triggers reject cross-tenant references.
4. RLS (when armed per ADR 0003) as the final DB-level backstop.

## Consequences

- Positive: every layer catches what the layers above missed; failures
  are loud (throw/RAISE), never silent filtering.
- Negative: more moving parts to test — mitigated by adversarial unit
  tests (`tenantPolicy.test.ts`) and preflight tooling.
