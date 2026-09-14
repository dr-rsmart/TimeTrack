-- Migration: 7_location_working_hours_and_entry_geofence
--
-- Adds configurable working hours to each work location and records the exact
-- geofence used when a time entry was clocked in. Assigned shifts remain the
-- first auto-clock-out boundary; location hours are the fallback for employees
-- without a shift.

ALTER TABLE "Geofence"
  ADD COLUMN IF NOT EXISTS "workingStartTime" TEXT NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS "workingEndTime" TEXT NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS "workingDays" TEXT[] NOT NULL DEFAULT ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

ALTER TABLE "TimeEntry"
  ADD COLUMN IF NOT EXISTS "geofenceId" TEXT;

CREATE INDEX IF NOT EXISTS "TimeEntry_geofenceId_idx"
  ON "TimeEntry"("geofenceId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TimeEntry_geofenceId_fkey'
  ) THEN
    ALTER TABLE "TimeEntry"
      ADD CONSTRAINT "TimeEntry_geofenceId_fkey"
      FOREIGN KEY ("geofenceId") REFERENCES "Geofence"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
