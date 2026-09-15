#!/usr/bin/env node
/**
 * Runtime database role setup (Phase 4, RLS enforcement).
 *
 * RLS cannot constrain a SUPERUSER connection — PostgreSQL superusers bypass
 * row security. The application must therefore connect as a dedicated
 * non-superuser, non-BYPASSRLS role; this script creates and provisions it.
 *
 *   node setup_runtime_role.mjs --json                 # dry run
 *   node setup_runtime_role.mjs --apply --json         # create + grant
 *   APP_DB_PASSWORD=... node setup_runtime_role.mjs --apply --json
 *
 * Without APP_DB_PASSWORD a strong random password is generated and printed
 * exactly once — store it in the secret manager and set the application's
 * DATABASE_URL to: postgresql://timetrack_app:<password>@host:port/<db>
 */

import { pathToFileURL } from 'url';
import { randomBytes } from 'crypto';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

const ROLE_NAME = process.env.APP_DB_ROLE || 'timetrack_app';
const TABLES = [
  'CompanyProfile',
  'User',
  'Employee',
  'Shift',
  'TimeEntry',
  'CompanySettings',
  'Geofence',
  'EmployeeGeofence',
  'LocationPreset',
  'AuditLog',
  'EmploymentHistory',
  'RetentionPolicy',
  'CronLock',
  'AuditLogArchive',
  '_prisma_migrations',
];

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    json: argv.includes('--json'),
  };
}

function generatePassword() {
  return randomBytes(24).toString('base64url');
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const password = process.env.APP_DB_PASSWORD || generatePassword();

  const db = new URL(process.env.DATABASE_URL || '').pathname.replace(/^\//, '');
  const statements = [
    `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlQuote(ROLE_NAME)}) THEN
        CREATE ROLE ${ROLE_NAME} LOGIN PASSWORD ${sqlQuote(password)}
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      ELSE
        ALTER ROLE ${ROLE_NAME} PASSWORD ${sqlQuote(password)};
      END IF;
    END
    $$;`,
    `GRANT CONNECT ON DATABASE "${db}" TO ${ROLE_NAME};`,
    `GRANT USAGE ON SCHEMA public TO ${ROLE_NAME};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE_NAME};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE_NAME};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${process.env.PGUSER || 'postgres'} IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE_NAME};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${process.env.PGUSER || 'postgres'} IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE_NAME};`,
  ];

  const result = {
    role: ROLE_NAME,
    database: db,
    statements: statements.length,
    password: options.apply ? undefined : '<hidden — rerun with --apply to install>',
    apply: options.apply,
  };

  if (!options.apply) {
    if (options.json) console.log(JSON.stringify({ ...result, dryRun: true }, null, 2));
    else {
      console.log(`[setup-runtime-role] Dry run. Would execute ${statements.length} statements.`);
      console.log(`[setup-runtime-role] Role: ${ROLE_NAME} on database "${db}".`);
    }
    return 0;
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const sql of statements) {
        await tx.$executeRawUnsafe(sql);
      }
    });
    if (options.json) console.log(JSON.stringify({ ...result, installed: true }, null, 2));
    else console.log(`[setup-runtime-role] Role ${ROLE_NAME} provisioned.`);
    return 0;
  } catch (error) {
    if (options.json)
      console.log(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      );
    else console.error('[setup-runtime-role] failed:', error);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
