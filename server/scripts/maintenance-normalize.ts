/**
 * Maintenance: email normalization & tenant auto-heal
 * ---------------------------------------------------
 * Previously these UPDATE statements ran as boot-time side effects on every
 * server start (server/src/index.ts). Phase 2 (2026-09-14) moved them into
 * this explicit, dry-run-first maintenance command so that booting the server
 * never mutates data.
 *
 * Usage (from server/):
 *   npx tsx scripts/maintenance-normalize.ts            # dry run (report only)
 *   npx tsx scripts/maintenance-normalize.ts --apply    # execute
 *   npx tsx scripts/maintenance-normalize.ts --json     # machine-readable dry run
 */

import prisma from '../src/prisma.js';
import { runUnrestricted } from '../src/tenantDatabase.js';

const apply = process.argv.includes('--apply');
const json = process.argv.includes('--json');

function log(msg: string): void {
  if (!json) console.log(`[maintenance:normalize] ${msg}`);
}

async function countEmployeesWithDrift(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM "Employee"
    WHERE "email" IS NOT NULL AND "email" != LOWER(TRIM("email"))
  `;
  return Number(rows[0]?.count ?? 0);
}

async function countUsersWithDrift(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM "User"
    WHERE "email" IS NOT NULL AND "email" != LOWER(TRIM("email"))
  `;
  return Number(rows[0]?.count ?? 0);
}

async function countEmployeesMissingTenant(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM "Employee" e
    WHERE e."companyProfileId" IS NULL
      AND EXISTS (
        SELECT 1 FROM "User" u
        WHERE LOWER(TRIM(u."email")) = LOWER(TRIM(e."email"))
          AND u."companyProfileId" IS NOT NULL
      )
  `;
  return Number(rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  const employeeEmailDrift = await countEmployeesWithDrift();
  const userEmailDrift = await countUsersWithDrift();
  const employeeMissingTenant = await countEmployeesMissingTenant();

  if (json) {
    console.log(
      JSON.stringify({ employeeEmailDrift, userEmailDrift, employeeMissingTenant, apply }),
    );
    return;
  }

  log(
    `Dry run — employee email drift: ${employeeEmailDrift}, user email drift: ${userEmailDrift}, employees missing tenant: ${employeeMissingTenant}`,
  );

  if (!apply) {
    log('No changes made. Re-run with --apply to execute the normalization updates.');
    return;
  }

  if (employeeEmailDrift > 0) {
    await prisma.$executeRawUnsafe(`
      UPDATE "Employee" SET "email" = LOWER(TRIM("email"))
      WHERE "email" IS NOT NULL AND "email" != LOWER(TRIM("email"));
    `);
    log(`Normalized ${employeeEmailDrift} employee email(s).`);
  }
  if (userEmailDrift > 0) {
    await prisma.$executeRawUnsafe(`
      UPDATE "User" SET "email" = LOWER(TRIM("email"))
      WHERE "email" IS NOT NULL AND "email" != LOWER(TRIM("email"));
    `);
    log(`Normalized ${userEmailDrift} user email(s).`);
  }
  if (employeeMissingTenant > 0) {
    await prisma.$executeRawUnsafe(`
      UPDATE "Employee" e
      SET "companyProfileId" = u."companyProfileId"
      FROM "User" u
      WHERE LOWER(TRIM(e."email")) = LOWER(TRIM(u."email"))
        AND e."companyProfileId" IS NULL
        AND u."companyProfileId" IS NOT NULL;
    `);
    log(`Auto-healed tenant for ${employeeMissingTenant} employee(s).`);
  }
  log('Normalization complete.');
}

runUnrestricted(() => main())
  .catch((err) => {
    console.error('[maintenance:normalize] FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
