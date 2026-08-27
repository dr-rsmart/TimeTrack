#!/usr/bin/env node
/**
 * Production snapshot → local restore
 * ------------------------------------
 * SECURITY: All database credentials are read from environment variables at
 * runtime. Connection strings must NEVER be committed to this repo
 * (a committed production DSN is a total-database-compromise secret — see
 * docs/DATA_CHANGES.md entry 2026-08-27 and the Audit Cycle 16 report).
 *
 * Required environment variables (export them in your shell or an UNTRACKED
 * `.env.local` that you source/deploy yourself):
 *
 *   PROD_SNAPSHOT_URL   postgresql://... production connection string
 *                       (use a read-only/replica user whenever possible;
 *                        your platform — e.g. Railway — exposes this in its
 *                        service settings, never in this file)
 *   LOCAL_PG_PASSWORD   local PostgreSQL superuser password
 *
 * Optional overrides (with safe local-dev defaults):
 *
 *   LOCAL_PG_HOST       default: localhost
 *   LOCAL_PG_PORT       default: 5433
 *   LOCAL_PG_USER       default: postgres
 *   LOCAL_RESTORE_DB    default: timetrack_prod
 *   PSQL_BIN / PG_DUMP_BIN  paths to psql/pg_dump (Windows default installed)
 */
import { execSync } from 'child_process';

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`[sync-prod-to-local] FATAL: environment variable "${name}" is not set.`);
    console.error('Set it in your shell (or an untracked .env.local) and run again. Never commit credentials.');
    process.exit(1);
  }
  return v.trim();
}

const PROD_URL = requireEnv('PROD_SNAPSHOT_URL');

const pgHost = process.env.LOCAL_PG_HOST || 'localhost';
const pgPort = process.env.LOCAL_PG_PORT || '5433';
const pgUser = process.env.LOCAL_PG_USER || 'postgres';
const pgPassword = requireEnv('LOCAL_PG_PASSWORD');
const restoreDb = process.env.LOCAL_RESTORE_DB || 'timetrack_prod';

const localUrl = (db) => `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${db}`;
const LOCAL_POSTGRES_ADMIN = localUrl('postgres');
const LOCAL_PROD_URL = localUrl(restoreDb);

// Resolve the PostgreSQL CLI binaries — honour explicit overrides, otherwise
// fall back to the standard Windows install location used on developer machines.
const BIN_DIR = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const PSQL = `"${process.env.PSQL_BIN || `${BIN_DIR}\\psql.exe`}"`;
const PG_DUMP = `"${process.env.PG_DUMP_BIN || `${BIN_DIR}\\pg_dump.exe`}"`;

console.log('1. Checking / Creating database timetrack_prod...');
try {
  const checkOut = execSync(`${PSQL} "${LOCAL_POSTGRES_ADMIN}" -t -c "SELECT 1 FROM pg_database WHERE datname='timetrack_prod'"`, { encoding: 'utf-8' });
  if (checkOut.trim() !== '1') {
    execSync(`${PSQL} "${LOCAL_POSTGRES_ADMIN}" -c "CREATE DATABASE timetrack_prod"`, { stdio: 'inherit' });
    console.log('Created database timetrack_prod.');
  } else {
    console.log('Database timetrack_prod exists.');
  }
} catch (err) {
  console.error('Error creating database:', err.message);
  process.exit(1);
}

console.log('2. Dumping schema and data from Railway production...');
const dumpFile = 'prod_dump.sql';
try {
  execSync(`${PG_DUMP} --no-owner --no-privileges --clean --if-exists --dbname="${PROD_URL}" -f "${dumpFile}"`, { stdio: 'inherit' });
  console.log('Dump completed successfully into', dumpFile);
} catch (err) {
  console.error('Error dumping database:', err.message);
  process.exit(1);
}

console.log('3. Terminating active connections to timetrack_prod...');
try {
  execSync(`${PSQL} "${LOCAL_POSTGRES_ADMIN}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'timetrack_prod' AND pid <> pg_backend_pid();"`, { stdio: 'inherit' });
} catch (e) {
  console.warn('Warning terminating connections:', e.message);
}

console.log('4. Restoring into local timetrack_prod database...');
try {
  execSync(`${PSQL} "${LOCAL_PROD_URL}" -f "${dumpFile}"`, { stdio: 'inherit' });
  console.log('Restore completed successfully.');
} catch (err) {
  console.error('Error restoring database:', err.message);
  process.exit(1);
} finally {
  try {
    execSync(`del ${dumpFile}`, { stdio: 'ignore' });
  } catch (_) {}
}

console.log('5. Verifying tables in timetrack_prod...');
try {
  const tables = execSync(`${PSQL} "${LOCAL_PROD_URL}" -t -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"`, { encoding: 'utf-8' });
  console.log('Tables present:\n' + tables.trim());
} catch (err) {
  console.error('Error verifying tables:', err.message);
}
