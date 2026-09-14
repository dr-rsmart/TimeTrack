-- Migration: 4_employee_identity_backfill
-- Employee identity bridge: backfill only unambiguous employeeId values and
-- add indexes for ID-first attendance reads. Legacy email columns remain.

-- Backfill TimeEntry.employeeId only when exactly one employee matches the
-- normalized email within the same tenant (or the legacy row has no tenant).
WITH candidates AS (
  SELECT
    te."id" AS "timeEntryId",
    MIN(e."id") AS "employeeId",
    COUNT(e."id") AS "candidateCount"
  FROM "TimeEntry" te
  JOIN "Employee" e
    ON LOWER(TRIM(e."email")) = LOWER(TRIM(te."employeeEmail"))
   AND (te."companyProfileId" = e."companyProfileId" OR te."companyProfileId" IS NULL)
  WHERE te."employeeId" IS NULL
  GROUP BY te."id"
)
UPDATE "TimeEntry" te
SET "employeeId" = candidates."employeeId"
FROM candidates
WHERE te."id" = candidates."timeEntryId"
  AND candidates."candidateCount" = 1;

-- Backfill Shift.employeeId using the same conservative rule.
WITH candidates AS (
  SELECT
    s."id" AS "shiftId",
    MIN(e."id") AS "employeeId",
    COUNT(e."id") AS "candidateCount"
  FROM "Shift" s
  JOIN "Employee" e
    ON LOWER(TRIM(e."email")) = LOWER(TRIM(s."employeeEmail"))
   AND (s."companyProfileId" = e."companyProfileId" OR s."companyProfileId" IS NULL)
  WHERE s."employeeId" IS NULL
    AND s."employeeEmail" IS NOT NULL
  GROUP BY s."id"
)
UPDATE "Shift" s
SET "employeeId" = candidates."employeeId"
FROM candidates
WHERE s."id" = candidates."shiftId"
  AND candidates."candidateCount" = 1;

CREATE INDEX IF NOT EXISTS "TimeEntry_employeeId_status_date_idx"
  ON "TimeEntry"("employeeId", "status", "date");

CREATE INDEX IF NOT EXISTS "TimeEntry_companyProfileId_employeeId_date_idx"
  ON "TimeEntry"("companyProfileId", "employeeId", "date");

CREATE INDEX IF NOT EXISTS "Shift_companyProfileId_employeeId_date_idx"
  ON "Shift"("companyProfileId", "employeeId", "date");