# Migration 6 — Tenant integrity & RLS preparation

- **Why:** tenant isolation was application-level only; a missed filter in any
  query could leak cross-tenant data.
- **What:**
  - `timetrack_current_tenant()` / `timetrack_legacy_null_access()` helpers.
  - `timetrack_enforce_tenant_integrity()` trigger (active immediately) on
    Employee, Shift, TimeEntry, EmployeeGeofence — rejects cross-tenant
    references whenever both sides have known tenants.
  - RLS policies CREATED but deliberately NOT enabled — activation is gated on
    the application adopting the transaction-local tenant bridge and a clean
    preflight (`RLS_RUNTIME_BRIDGE_READY=true`).
- **Rollback:**
  ```sql
  DROP TRIGGER IF EXISTS "timetrack_tenant_integrity" ON "Employee";
  DROP TRIGGER IF EXISTS "timetrack_tenant_integrity" ON "Shift";
  DROP TRIGGER IF EXISTS "timetrack_tenant_integrity" ON "TimeEntry";
  DROP TRIGGER IF EXISTS "timetrack_tenant_integrity" ON "EmployeeGeofence";
  DROP FUNCTION IF EXISTS "timetrack_enforce_tenant_integrity"();
  DROP FUNCTION IF EXISTS "timetrack_current_tenant"();
  DROP FUNCTION IF EXISTS "timetrack_legacy_null_access"();
  ```
- **Notes:** extended by migration 9 (EmploymentHistory tenant key). Activation
  workflow: `npm run tenant:preflight -- --strict`, then
  `npm run tenant:rls:enable -- --apply --confirm`.
