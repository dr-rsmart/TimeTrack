/**
 * Database Health & Migration Verification Script
 * ------------------------------------------------
 * Validates PostgreSQL connection, schema models, partial unique indexes,
 * and tenant integrity.
 *
 * Usage:
 *   node server/db_check.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['error'],
});

async function main() {
  console.log('='.repeat(60));
  console.log('TimeTrack Database Health & Schema Verification');
  console.log('='.repeat(60));

  let passed = true;

  try {
    // 1. Connection check
    console.log('\n[1/5] Testing PostgreSQL connection...');
    const startTime = Date.now();
    const result = await prisma.$queryRaw`SELECT version(), current_database(), current_user`;
    const latency = Date.now() - startTime;
    console.log(`✅ Connected in ${latency}ms`);
    if (Array.isArray(result) && result[0]) {
      console.log(`   Database: ${result[0].current_database}`);
      console.log(`   User:     ${result[0].current_user}`);
      console.log(`   Version:  ${result[0].version?.split(' on ')[0] || result[0].version}`);
    }

    // 2. Model table checks & record counts
    console.log('\n[2/5] Verifying database models & record counts...');
    const checks = [
      { name: 'User', fn: () => prisma.user.count() },
      { name: 'CompanyProfile', fn: () => prisma.companyProfile.count() },
      { name: 'Employee', fn: () => prisma.employee.count() },
      { name: 'Shift', fn: () => prisma.shift.count() },
      { name: 'TimeEntry', fn: () => prisma.timeEntry.count() },
      { name: 'CompanySettings', fn: () => prisma.companySettings.count() },
      { name: 'Geofence', fn: () => prisma.geofence.count() },
      { name: 'LocationPreset', fn: () => prisma.locationPreset.count() },
      { name: 'AuditLog', fn: () => prisma.auditLog.count() },
      { name: 'RetentionPolicy', fn: () => prisma.retentionPolicy.count() },
      { name: 'CronLock', fn: () => prisma.cronLock.count() },
      { name: 'EmploymentHistory', fn: () => prisma.employmentHistory.count() },
    ];

    for (const check of checks) {
      try {
        const count = await check.fn();
        console.log(`   ✓ ${check.name.padEnd(20)} ${count} record(s)`);
      } catch (err) {
        console.error(`   ✗ ${check.name.padEnd(20)} FAILED: ${err.message}`);
        passed = false;
      }
    }

    // 3. Partial Unique Index check (Critical for race condition prevention)
    console.log('\n[3/5] Checking partial unique index: uniq_active_time_entry_employee...');
    const indexResult = await prisma.$queryRaw`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'TimeEntry' AND indexname = 'uniq_active_time_entry_employee';
    `;

    if (Array.isArray(indexResult) && indexResult.length > 0) {
      console.log('✅ Partial unique index exists and is active.');
      console.log(`   Definition: ${indexResult[0].indexdef}`);
    } else {
      console.warn('⚠️  Index "uniq_active_time_entry_employee" not found in pg_indexes. Creating now...');
      try {
        await prisma.$executeRaw`
          CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_time_entry_employee"
          ON "TimeEntry"("employeeEmail")
          WHERE status = 'active';
        `;
        console.log('✅ Successfully created partial unique index.');
      } catch (createErr) {
        console.error('✗ Failed to create partial unique index:', createErr.message);
        passed = false;
      }
    }

    // 4. Multi-Tenant Integrity Check
    console.log('\n[4/5] Checking tenant integrity...');
    const orphanEmployees = await prisma.employee.count({
      where: {
        companyProfileId: { not: null },
        companyProfile: null,
      },
    });
    if (orphanEmployees === 0) {
      console.log('✅ Zero orphan employee records.');
    } else {
      console.warn(`⚠️  Found ${orphanEmployees} orphan employee record(s).`);
    }

    // 5. Active Time Entry Integrity Check
    console.log('\n[5/5] Checking active time entry integrity...');
    const activeEntries = await prisma.timeEntry.findMany({
      where: { status: 'active' },
      select: { employeeEmail: true },
    });
    const emailCounts = {};
    let duplicateActive = 0;
    for (const entry of activeEntries) {
      const email = entry.employeeEmail.toLowerCase();
      emailCounts[email] = (emailCounts[email] || 0) + 1;
      if (emailCounts[email] > 1) duplicateActive++;
    }

    if (duplicateActive === 0) {
      console.log(`✅ Zero duplicate active clock-in sessions (${activeEntries.length} active).`);
    } else {
      console.error(`✗ Found ${duplicateActive} duplicate active clock-in session(s)!`);
      passed = false;
    }

  } catch (err) {
    console.error('\n✗ Database verification failed with fatal error:', err);
    passed = false;
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n' + '='.repeat(60));
  if (passed) {
    console.log('VERDICT: DATABASE IS PRODUCTION READY ✅');
    console.log('='.repeat(60));
    process.exit(0);
  } else {
    console.error('VERDICT: DATABASE CHECKS FAILED ✗');
    console.log('='.repeat(60));
    process.exit(1);
  }
}

main();
