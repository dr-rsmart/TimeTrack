-- Migration: 2_employee_geofence_multi_location
-- Created: 2026-08-30
--
-- Adds the EmployeeGeofence join table so an employee can be assigned to
-- MULTIPLE work locations (e.g. Head Office AND Branch). The legacy
-- Employee.geofenceId column is KEPT (dual-write) for backward compatibility
-- with existing clients and as the "primary" location mirror.
--
-- Additive, zero-downtime change: new table + indexes + FKs only. No data
-- backfill required — clock validation unions legacy geofenceId with
-- EmployeeGeofence rows, so existing single-location assignments keep working.

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmployeeGeofence" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "geofenceId" TEXT NOT NULL,
    "companyProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeGeofence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeGeofence_employeeId_geofenceId_key"
ON "EmployeeGeofence"("employeeId", "geofenceId");

CREATE INDEX IF NOT EXISTS "EmployeeGeofence_employeeId_idx"
ON "EmployeeGeofence"("employeeId");

CREATE INDEX IF NOT EXISTS "EmployeeGeofence_geofenceId_idx"
ON "EmployeeGeofence"("geofenceId");

CREATE INDEX IF NOT EXISTS "EmployeeGeofence_companyProfileId_idx"
ON "EmployeeGeofence"("companyProfileId");

-- AddForeignKey (ON DELETE CASCADE: removing an employee or geofence cleans
-- up the assignment rows automatically)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeGeofence_employeeId_fkey'
  ) THEN
    ALTER TABLE "EmployeeGeofence"
      ADD CONSTRAINT "EmployeeGeofence_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeGeofence_geofenceId_fkey'
  ) THEN
    ALTER TABLE "EmployeeGeofence"
      ADD CONSTRAINT "EmployeeGeofence_geofenceId_fkey"
      FOREIGN KEY ("geofenceId") REFERENCES "Geofence"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
