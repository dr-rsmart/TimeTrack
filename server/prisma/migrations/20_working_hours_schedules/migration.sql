-- Migration 20: per-day working-hours schedules (multiple time slots).
--
-- Adds a JSONB schedule list to Geofence ("global working hours" per location)
-- and CompanySettings (company default hours). Each element is
--   { "days": ["Monday", ...], "startTime": "HH:mm", "endTime": "HH:mm" }
-- so admins can express e.g. Mon-Thu 08:00-17:00, Fri 08:00-15:00,
-- Sat 08:00-14:00 as separate slots. An EMPTY array means "not explicitly
-- configured" and disables the cron working-end auto clock-out for that
-- geofence/company — this deliberately stops the erroneous 17:00 closes
-- caused by the implicit schema defaults (stakeholder report 2026-09).
--
-- Backfill copies each legacy single hours block into one schedule ONLY when
-- it differs from the untouched schema defaults (08:00-17:00, Mon-Fri).
-- Locations/companies that were genuinely customised keep their auto
-- clock-out; never-configured rows require the admin to save hours in the
-- new UI before automatic closes resume.
--
-- Metadata-only ADD COLUMN (JSONB with constant default) — no table rewrite.
-- IF NOT EXISTS: replay-safe on databases provisioned by db-push.

ALTER TABLE "Geofence"
  ADD COLUMN IF NOT EXISTS "workingHoursSchedules" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "CompanySettings"
  ADD COLUMN IF NOT EXISTS "defaultWorkingHoursSchedules" JSONB NOT NULL DEFAULT '[]';

UPDATE "Geofence"
SET "workingHoursSchedules" = jsonb_build_array(
      jsonb_build_object(
        'days', to_jsonb("workingDays"),
        'startTime', to_jsonb("workingStartTime"),
        'endTime', to_jsonb("workingEndTime")
      )
    )
WHERE cardinality("workingDays") > 0
  AND NOT (
    "workingStartTime" = '08:00'
    AND "workingEndTime" = '17:00'
    AND "workingDays" = ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']::text[]
  );

UPDATE "CompanySettings"
SET "defaultWorkingHoursSchedules" = jsonb_build_array(
      jsonb_build_object(
        'days', to_jsonb("defaultWorkingDays"),
        'startTime', to_jsonb("defaultWorkingStartTime"),
        'endTime', to_jsonb("defaultWorkingEndTime")
      )
    )
WHERE cardinality("defaultWorkingDays") > 0
  AND NOT (
    "defaultWorkingStartTime" = '08:00'
    AND "defaultWorkingEndTime" = '17:00'
    AND "defaultWorkingDays" = ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']::text[]
  );

-- Rollback:
--   ALTER TABLE "Geofence" DROP COLUMN "workingHoursSchedules";
--   ALTER TABLE "CompanySettings" DROP COLUMN "defaultWorkingHoursSchedules";