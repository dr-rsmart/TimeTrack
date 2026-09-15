-- Company-level working hours for employees without an assigned geofence.
ALTER TABLE "CompanySettings"
  ADD COLUMN "defaultWorkingStartTime" TEXT NOT NULL DEFAULT '08:00',
  ADD COLUMN "defaultWorkingEndTime" TEXT NOT NULL DEFAULT '17:00',
  ADD COLUMN "defaultWorkingDays" TEXT[] NOT NULL DEFAULT ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];