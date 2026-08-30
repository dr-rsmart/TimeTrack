# Migration 2: Employee Multi-Location Geofence Assignments

## Details
- **Created**: 2026-08-30
- **Database**: PostgreSQL 15+
- **Applied By**: `npx prisma migrate deploy`

## Changes
1. New table `EmployeeGeofence` (join table: Employee ↔ Geofence, many-to-many)
   - `id` (cuid PK), `employeeId`, `geofenceId`, `companyProfileId` (nullable,
     tenant mirror), `createdAt`.
   - Unique `(employeeId, geofenceId)` — an assignment is idempotent.
   - Indexes on `employeeId`, `geofenceId`, `companyProfileId`.
   - FKs to `Employee(id)` and `Geofence(id)` with `ON DELETE CASCADE`.

## Why
Bug reports #2/#3/#6: administrators need to assign one employee to MULTIPLE
work locations (e.g. Head Office and Branch). The legacy single
`Employee.geofenceId` column cannot express that. Clock-in/out validation
(`geoValidationService.ts`) now unions both sources:
- Assigned employees: validated against ALL their active assigned geofences.
- Unassigned employees ("No Geo Location Assigned"): NO location restriction.

## Zero-downtime notes
- Purely additive (new table/indexes/FKs) — no data migration or backfill.
- The legacy `Employee.geofenceId` column is kept and continues to be written
  (dual-write: the Workforce UI mirrors the first selected location into it),
  so rolling back the application code leaves the old single-location
  behaviour fully functional.
- All statements are idempotent (`IF NOT EXISTS`) so re-running against a
  database that already has the table (e.g. created via `prisma db push` in a
  dev environment) is a no-op.

## Operator note — db-push-provisioned databases
If a database was schema-synced with `prisma db push` (dev environments), the
table already exists and `migrate deploy` will record this migration without
changing anything. To baseline manually instead:

```bash
npx prisma migrate resolve --applied 2_employee_geofence_multi_location --schema=prisma/schema.prisma
```
