-- Company-level working hours for employees without an assigned geofence.
-- IF NOT EXISTS: replay-safe on databases provisioned by the historical
-- db-push workflow.
ALTER TABLE "CompanySettings"
  ADD COLUMN IF NOT EXISTS "defaultWorkingStartTime" TEXT NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS "defaultWorkingEndTime" TEXT NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS "defaultWorkingDays" TEXT[] NOT NULL DEFAULT ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];