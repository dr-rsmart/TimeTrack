/**
 * Login-Account Health Diagnostic
 * --------------------------------
 * Finds every Employee that is visible in Workforce but has NO matching login
 * User account (the "I can see them on the system but they can't log in" bug),
 * plus any User/Employee email casing/whitespace drift.
 *
 * Usage:
 *   node server/diag_login_accounts.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

async function main() {
  console.log('='.repeat(60));
  console.log('TimeTrack Login-Account Health Diagnostic');
  console.log('='.repeat(60));

  // 1. Employees with no login account (case/whitespace-insensitive)
  const orphans = await prisma.$queryRawUnsafe(
    `SELECT e.id, e.email, e."firstName", e.surname, e.status, e.branch, e."companyProfileId", e."createdAt"
     FROM "Employee" e
     LEFT JOIN "User" u ON lower(trim(u.email)) = lower(trim(e.email))
     WHERE u.id IS NULL
     ORDER BY e."createdAt" DESC`
  );
  console.log(`\n[1] Employees WITHOUT a login account: ${orphans.length}`);
  for (const o of orphans) {
    console.log(`   - ${o.firstName} ${o.surname} <${o.email}> [${o.status}] branch=${o.branch} tenant=${o.companyProfileId ?? 'NULL'}`);
  }

  // 2. Email drift: stored value differs from lower(trim()) form
  const driftUsers = await prisma.$queryRawUnsafe(
    `SELECT id, email FROM "User" WHERE email != lower(trim(email))`
  );
  const driftEmps = await prisma.$queryRawUnsafe(
    `SELECT id, email FROM "Employee" WHERE email != lower(trim(email))`
  );
  console.log(`\n[2] Users with casing/whitespace drift: ${driftUsers.length}`);
  driftUsers.forEach((u) => console.log(`   - <${u.email}>`));
  console.log(`    Employees with casing/whitespace drift: ${driftEmps.length}`);
  driftEmps.forEach((e) => console.log(`   - <${e.email}>`));

  // 3. Employees whose companyProfileId is NULL but a matching User has one
  const tenantOrphans = await prisma.$queryRawUnsafe(
    `SELECT e.id, e.email, u."companyProfileId" AS userTenant
     FROM "Employee" e
     JOIN "User" u ON lower(trim(u.email)) = lower(trim(e.email))
     WHERE e."companyProfileId" IS NULL AND u."companyProfileId" IS NOT NULL`
  );
  console.log(`\n[3] Employees missing tenant link (User has one): ${tenantOrphans.length}`);
  tenantOrphans.forEach((t) => console.log(`   - <${t.email}> -> tenant ${t.userTenant}`));

  const healthy = orphans.length === 0 && driftUsers.length === 0 && driftEmps.length === 0 && tenantOrphans.length === 0;
  console.log(`\n${healthy ? '✅ All login accounts healthy.' : '⚠️  Issues found — see above. Boot-time auto-heal will repair drift & tenant links on next restart.'}`);
}

main()
  .catch((e) => {
    console.error('DIAG ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

