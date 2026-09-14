#!/usr/bin/env node
/**
 * Reports employee identity migration state without changing data.
 * Run after migration 4 to identify rows that still require manual review.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

try {
  const result = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*) FROM "TimeEntry" WHERE "employeeId" IS NULL) AS "timeEntriesMissingEmployeeId",
      (SELECT COUNT(*) FROM "Shift" WHERE "employeeId" IS NULL AND "employeeEmail" IS NOT NULL) AS "shiftsMissingEmployeeId",
      (SELECT COUNT(*) FROM (
         SELECT te."id"
         FROM "TimeEntry" te
         JOIN "Employee" e
           ON LOWER(TRIM(e."email")) = LOWER(TRIM(te."employeeEmail"))
          AND (te."companyProfileId" = e."companyProfileId" OR te."companyProfileId" IS NULL)
         WHERE te."employeeId" IS NULL
         GROUP BY te."id"
         HAVING COUNT(e."id") > 1
       ) ambiguous) AS "ambiguousTimeEntryMatches"
      ,(SELECT COUNT(*) FROM (
         SELECT s."id"
         FROM "Shift" s
         JOIN "Employee" e
           ON LOWER(TRIM(e."email")) = LOWER(TRIM(s."employeeEmail"))
          AND (s."companyProfileId" = e."companyProfileId" OR s."companyProfileId" IS NULL)
         WHERE s."employeeId" IS NULL
           AND s."employeeEmail" IS NOT NULL
         GROUP BY s."id"
         HAVING COUNT(e."id") > 1
       ) ambiguous_shifts) AS "ambiguousShiftMatches"
  `);

  console.log(JSON.stringify(result[0], null, 2));
} finally {
  await prisma.$disconnect();
}
