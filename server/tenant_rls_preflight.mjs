#!/usr/bin/env node
/**
 * Phase 4 tenant-enforcement preflight.
 *
 * Read-only. Migration 6 creates integrity triggers and dormant RLS policies;
 * this command reports whether the database and runtime bridge are ready for a
 * separate explicit RLS activation command.
 */
import 'dotenv/config';
import { pathToFileURL } from 'url';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });
const POLICY_TABLES = [
  'CompanyProfile', 'User', 'Employee', 'Shift', 'TimeEntry',
  'CompanySettings', 'Geofence', 'EmployeeGeofence', 'LocationPreset',
  'AuditLog', 'EmploymentHistory',
];
const STRICT_NULL_TABLES = [
  'Employee', 'Shift', 'TimeEntry', 'Geofence', 'EmployeeGeofence', 'LocationPreset',
];

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    strict: argv.includes('--strict'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function usage() {
  console.log(`Usage: node server/tenant_rls_preflight.mjs [options]

Options:
  --json    Emit machine-readable JSON only.
  --strict  Exit 1 when migration/policies/triggers/data/bridge are not ready.
  --help    Show this help.
`);
}

async function migrationApplied() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM "_prisma_migrations"
    WHERE "migration_name" = '6_tenant_integrity_and_rls_prepare'
      AND "finished_at" IS NOT NULL
    LIMIT 1
  `);
  return rows.length > 0;
}

async function catalogState() {
  const tableParams = POLICY_TABLES.map((_, index) => `$${index + 1}`).join(', ');
  const [tables, policies, triggers] = await Promise.all([
    prisma.$queryRawUnsafe(`
      SELECT c.relname AS name, c.relrowsecurity AS "rowSecurity", c.relforcerowsecurity AS "forceRowSecurity"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN (${tableParams})
    `, ...POLICY_TABLES),
    prisma.$queryRawUnsafe(`
      SELECT DISTINCT tablename AS name
      FROM pg_policies
      WHERE schemaname = 'public' AND policyname = 'timetrack_tenant_isolation'
        AND tablename IN (${tableParams})
    `, ...POLICY_TABLES),
    prisma.$queryRawUnsafe(`
      SELECT DISTINCT event_object_table AS name
      FROM information_schema.triggers
      WHERE trigger_schema = 'public' AND trigger_name = 'timetrack_tenant_integrity'
    `),
  ]);

  const tableMap = new Map(tables.map((row) => [row.name, {
    rowSecurity: Boolean(row.rowSecurity),
    forceRowSecurity: Boolean(row.forceRowSecurity),
  }]));
  return {
    tables: Object.fromEntries(POLICY_TABLES.map((name) => [name, tableMap.get(name) ?? null])),
    policies: policies.map((row) => row.name),
    integrityTriggers: triggers.map((row) => row.name),
  };
}

async function strictNullTenantRows() {
  const counts = {};
  for (const table of STRICT_NULL_TABLES) {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count FROM "${table}" WHERE "companyProfileId" IS NULL
    `);
    counts[table] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

async function inconsistentReferences() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count FROM (
      SELECT te."id" FROM "TimeEntry" te JOIN "Employee" e ON e."id" = te."employeeId"
        WHERE te."employeeId" IS NOT NULL AND te."companyProfileId" IS NOT NULL
          AND e."companyProfileId" IS NOT NULL AND te."companyProfileId" <> e."companyProfileId"
      UNION ALL
      SELECT s."id" FROM "Shift" s JOIN "Employee" e ON e."id" = s."employeeId"
        WHERE s."employeeId" IS NOT NULL AND s."companyProfileId" IS NOT NULL
          AND e."companyProfileId" IS NOT NULL AND s."companyProfileId" <> e."companyProfileId"
      UNION ALL
      SELECT e."id" FROM "Employee" e JOIN "Employee" m ON m."id" = e."managerId"
        WHERE e."managerId" IS NOT NULL AND e."companyProfileId" IS NOT NULL
          AND m."companyProfileId" IS NOT NULL AND e."companyProfileId" <> m."companyProfileId"
      UNION ALL
      SELECT e."id" FROM "Employee" e JOIN "Geofence" g ON g."id" = e."geofenceId"
        WHERE e."geofenceId" IS NOT NULL AND e."companyProfileId" IS NOT NULL
          AND g."companyProfileId" IS NOT NULL AND e."companyProfileId" <> g."companyProfileId"
      UNION ALL
      SELECT eg."id" FROM "EmployeeGeofence" eg
        JOIN "Employee" e ON e."id" = eg."employeeId"
        JOIN "Geofence" g ON g."id" = eg."geofenceId"
        WHERE eg."companyProfileId" IS NOT NULL
          AND ((e."companyProfileId" IS NOT NULL AND eg."companyProfileId" <> e."companyProfileId")
            OR (g."companyProfileId" IS NOT NULL AND eg."companyProfileId" <> g."companyProfileId"))
    ) inconsistent
  `);
  return Number(rows[0]?.count ?? 0);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }

  try {
    const migration = await migrationApplied();
    if (!migration) {
      const report = {
        migrationApplied: false,
        policiesInstalled: false,
        integrityTriggersInstalled: false,
        rlsAlreadyEnabled: false,
        strictNullTenantRows: null,
        inconsistentReferences: null,
        runtimeBridgeReady: process.env.RLS_RUNTIME_BRIDGE_READY === 'true',
        readyForActivation: false,
      };
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log('TimeTrack tenant enforcement preflight');
        console.log('Migration 6 applied: NO');
        console.log('Ready for RLS activation: NO');
      }
      return options.strict ? 1 : 0;
    }

    const [catalog, nullRows, inconsistent] = await Promise.all([
      catalogState(),
      strictNullTenantRows(),
      inconsistentReferences(),
    ]);
    const policiesInstalled = POLICY_TABLES.every((table) => catalog.policies.includes(table));
    const integrityTriggersInstalled = ['Employee', 'Shift', 'TimeEntry', 'EmployeeGeofence']
      .every((table) => catalog.integrityTriggers.includes(table));
    const rlsAlreadyEnabled = Object.values(catalog.tables).some((table) => table?.rowSecurity || table?.forceRowSecurity);
    const nullTotal = Object.values(nullRows).reduce((sum, count) => sum + count, 0);
    const runtimeBridgeReady = process.env.RLS_RUNTIME_BRIDGE_READY === 'true';
    const readyForActivation = policiesInstalled && integrityTriggersInstalled && !rlsAlreadyEnabled
      && nullTotal === 0 && inconsistent === 0 && runtimeBridgeReady;
    const report = {
      migrationApplied: true,
      policiesInstalled,
      integrityTriggersInstalled,
      rlsAlreadyEnabled,
      strictNullTenantRows: nullRows,
      inconsistentReferences: inconsistent,
      runtimeBridgeReady,
      readyForActivation,
      catalog,
    };
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log('TimeTrack tenant enforcement preflight');
      console.log(`Migration 6 applied: yes`);
      console.log(`Policies installed: ${policiesInstalled ? 'yes' : 'NO'}`);
      console.log(`Integrity triggers installed: ${integrityTriggersInstalled ? 'yes' : 'NO'}`);
      console.log(`Inconsistent references: ${inconsistent}`);
      console.log(`Strict null-tenant rows: ${nullTotal}`);
      console.log(`Runtime bridge ready: ${runtimeBridgeReady ? 'yes' : 'NO'}`);
      console.log(`Ready for RLS activation: ${readyForActivation ? 'yes' : 'NO'}`);
    }
    return options.strict && !readyForActivation ? 1 : 0;
  } catch (error) {
    if (options.json) console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    else console.error('[tenant-rls-preflight] failed:', error);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}