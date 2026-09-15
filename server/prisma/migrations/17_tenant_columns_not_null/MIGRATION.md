# Migration 17 — tenant columns NOT NULL (Open-11)

Sets `companyProfileId` NOT NULL on `Employee`, `Shift`, `TimeEntry`,
`Geofence`, and `EmployeeGeofence`. Guarded: the migration **fails before any
DDL** if any NULL-tenant row exists in those tables.

## Pre-deploy verification

```bash
npm run tenant:preflight -- --strict   # strictNullTenantRows must all be 0
```

## Rollback

```sql
ALTER TABLE "Employee"         ALTER COLUMN "companyProfileId" DROP NOT NULL;
ALTER TABLE "Shift"            ALTER COLUMN "companyProfileId" DROP NOT NULL;
ALTER TABLE "TimeEntry"        ALTER COLUMN "companyProfileId" DROP NOT NULL;
ALTER TABLE "Geofence"         ALTER COLUMN "companyProfileId" DROP NOT NULL;
ALTER TABLE "EmployeeGeofence" ALTER COLUMN "companyProfileId" DROP NOT NULL;
```

Nullable-by-design tenant columns (NOT touched): `User` (master accounts are
tenant-less), `AuditLog` (platform-level events), `EmploymentHistory`,
`DevicePushToken`, `CompanySettings` (provisioned per tenant but retained
nullable pending a dedicated preflight).

## Order-independence note

Prisma applies migrations in lexicographic directory order, so on a fresh
database this file runs BEFORE `2_employee_geofence_multi_location` creates
`EmployeeGeofence`. The `EmployeeGeofence` constraint is therefore enforced
in two guarded places: here (when the table already exists — upgraded
databases) and at the end of `9_employment_history_tenant_key` (sorts last —
fresh databases). Verified end-to-end on a scratch database (full 18-migration
chain + seed, 2026-09-15; see `docs/DATA_CHANGES.md` entry 010).
