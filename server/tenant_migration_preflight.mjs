#!/usr/bin/env node
/** Read-only readiness report for tenant NOT NULL and identity migrations. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });
const strict = process.argv.includes('--strict');

async function query(sql) {
  return prisma.$queryRawUnsafe(sql);
}

try {
  const tables = ['Employee', 'Shift', 'TimeEntry', 'AuditLog', 'EmploymentHistory'];
  const tenantNulls = {};
  for (const table of tables) {
    const rows = await query(
      `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "companyProfileId" IS NULL`,
    );
    tenantNulls[table] = Number(rows[0]?.count ?? 0);
  }

  const unresolved = {};
  for (const table of ['Shift', 'TimeEntry']) {
    const rows = await query(
      `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "employeeId" IS NULL AND "employeeEmail" IS NOT NULL`,
    );
    unresolved[table] = Number(rows[0]?.count ?? 0);
  }

  const report = {
    strict,
    tenantNulls,
    unresolved,
    readyForTenantNotNull: Object.values(tenantNulls).every((value) => value === 0),
    readyForIdentityNotNull: Object.values(unresolved).every((value) => value === 0),
  };
  console.log(JSON.stringify(report, null, 2));
  if (strict && (!report.readyForTenantNotNull || !report.readyForIdentityNotNull))
    process.exitCode = 1;
} catch (error) {
  console.error(`[tenant-preflight] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
