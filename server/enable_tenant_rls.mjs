#!/usr/bin/env node
/**
 * Guarded Phase 4 RLS activation.
 *
 * Dry-run by default. This command refuses to enable FORCE ROW LEVEL SECURITY
 * until migration 6, policy/integrity checks, strict tenant coverage, and the
 * runtime transaction bridge gate all pass.
 */
import { pathToFileURL } from 'url';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });
const TABLES = [
  'CompanyProfile', 'User', 'Employee', 'Shift', 'TimeEntry',
  'CompanySettings', 'Geofence', 'EmployeeGeofence', 'LocationPreset',
  'AuditLog', 'EmploymentHistory',
];

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    confirm: argv.includes('--confirm'),
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function usage() {
  console.log(`Usage: node server/enable_tenant_rls.mjs [options]

Options:
  --apply     Enable and force RLS after all gates pass.
  --confirm   Required with --apply; confirms the database-owner review.
  --json      Emit machine-readable output.
  --help      Show this help.
`);
}

async function preflight() {
  const migration = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM "_prisma_migrations"
    WHERE "migration_name" = '6_tenant_integrity_and_rls_prepare'
      AND "finished_at" IS NOT NULL LIMIT 1
  `);
  if (migration.length === 0) return { ready: false, reason: 'Migration 6_tenant_integrity_and_rls_prepare is not applied.' };

  const policies = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT tablename)::int AS count FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'timetrack_tenant_isolation'
  `);
  const triggers = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT event_object_table)::int AS count
    FROM information_schema.triggers
    WHERE trigger_schema = 'public' AND trigger_name = 'timetrack_tenant_integrity'
  `);
  const tables = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) FILTER (WHERE relrowsecurity OR relforcerowsecurity)::int AS enabled
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
  `, TABLES);
  const nullRows = await prisma.$queryRawUnsafe(`
    SELECT SUM(count)::int AS count FROM (
      SELECT COUNT(*)::int AS count FROM "Employee" WHERE "companyProfileId" IS NULL
      UNION ALL SELECT COUNT(*)::int FROM "Shift" WHERE "companyProfileId" IS NULL
      UNION ALL SELECT COUNT(*)::int FROM "TimeEntry" WHERE "companyProfileId" IS NULL
      UNION ALL SELECT COUNT(*)::int FROM "Geofence" WHERE "companyProfileId" IS NULL
      UNION ALL SELECT COUNT(*)::int FROM "EmployeeGeofence" WHERE "companyProfileId" IS NULL
      UNION ALL SELECT COUNT(*)::int FROM "LocationPreset" WHERE "companyProfileId" IS NULL
    ) counts
  `);
  const inconsistent = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count FROM (
      SELECT te."id" FROM "TimeEntry" te JOIN "Employee" e ON e."id" = te."employeeId"
        WHERE te."companyProfileId" IS NOT NULL AND e."companyProfileId" IS NOT NULL AND te."companyProfileId" <> e."companyProfileId"
      UNION ALL SELECT s."id" FROM "Shift" s JOIN "Employee" e ON e."id" = s."employeeId"
        WHERE s."companyProfileId" IS NOT NULL AND e."companyProfileId" IS NOT NULL AND s."companyProfileId" <> e."companyProfileId"
      UNION ALL SELECT e."id" FROM "Employee" e JOIN "Employee" m ON m."id" = e."managerId"
        WHERE e."companyProfileId" IS NOT NULL AND m."companyProfileId" IS NOT NULL AND e."companyProfileId" <> m."companyProfileId"
      UNION ALL SELECT e."id" FROM "Employee" e JOIN "Geofence" g ON g."id" = e."geofenceId"
        WHERE e."companyProfileId" IS NOT NULL AND g."companyProfileId" IS NOT NULL AND e."companyProfileId" <> g."companyProfileId"
      UNION ALL SELECT eg."id" FROM "EmployeeGeofence" eg JOIN "Employee" e ON e."id" = eg."employeeId" JOIN "Geofence" g ON g."id" = eg."geofenceId"
        WHERE eg."companyProfileId" IS NOT NULL AND ((e."companyProfileId" IS NOT NULL AND eg."companyProfileId" <> e."companyProfileId") OR (g."companyProfileId" IS NOT NULL AND eg."companyProfileId" <> g."companyProfileId"))
    ) inconsistent
  `);
  const values = {
    policies: Number(policies[0]?.count ?? 0),
    triggers: Number(triggers[0]?.count ?? 0),
    enabled: Number(tables[0]?.enabled ?? 0),
    strictNullTenantRows: Number(nullRows[0]?.count ?? 0),
    inconsistentReferences: Number(inconsistent[0]?.count ?? 0),
    runtimeBridgeReady: process.env.RLS_RUNTIME_BRIDGE_READY === 'true',
  };
  return {
    ready: values.policies >= TABLES.length && values.triggers >= 4 && values.enabled === 0
      && values.strictNullTenantRows === 0 && values.inconsistentReferences === 0 && values.runtimeBridgeReady,
    ...values,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }
  try {
    const report = await preflight();
    if (!report.ready) {
      const output = { ...report, apply: options.apply, activated: false };
      if (options.json) console.log(JSON.stringify(output, null, 2));
      else console.log('Tenant RLS activation blocked:', report.reason ?? 'preflight gates are not satisfied.');
      return 1;
    }
    if (!options.apply || !options.confirm) {
      const output = { ...report, apply: options.apply, confirmed: options.confirm, activated: false, dryRun: true };
      if (options.json) console.log(JSON.stringify(output, null, 2));
      else console.log('Tenant RLS activation dry-run passed. Use --apply --confirm only after database-owner review.');
      return 0;
    }

    await prisma.$transaction(async (tx) => {
      for (const table of TABLES) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
        await tx.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      }
    });
    const output = { ...report, apply: true, confirmed: true, activated: true };
    if (options.json) console.log(JSON.stringify(output, null, 2));
    else console.log('Tenant RLS enabled and forced on all prepared tables.');
    return 0;
  } catch (error) {
    if (options.json) console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    else console.error('[enable-tenant-rls] failed:', error);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}