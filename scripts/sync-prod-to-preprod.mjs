/**
 * Restore local production-clone into the pre-production database
 * ---------------------------------------------------------------
 * Dumps `timetrack_prod` (local clone) and restores it into
 * `timetrack_pre-prod` on the same local PostgreSQL instance.
 *
 * SECURITY: credentials are read from environment variables — never commit
 * a connection string (see scripts/sync-prod-to-local.mjs header).
 *
 *   LOCAL_PG_PASSWORD   (required)  local PostgreSQL superuser password
 *   LOCAL_PG_HOST       (optional)  default localhost
 *   LOCAL_PG_PORT       (optional)  default 5433
 *   LOCAL_PG_USER       (optional)  default postgres
 *   LOCAL_PROD_DB       (optional)  default timetrack_prod
 *   LOCAL_PREPROD_DB    (optional)  default timetrack_pre-prod
 *   PSQL_BIN / PG_DUMP_BIN (optional) CLI paths
 */
import { execSync } from 'child_process';

const pgHost = process.env.LOCAL_PG_HOST || 'localhost';
const pgPort = process.env.LOCAL_PG_PORT || '5433';
const pgUser = process.env.LOCAL_PG_USER || 'postgres';
const pgPassword = process.env.LOCAL_PG_PASSWORD;

if (!pgPassword) {
  console.error('[sync-prod-to-preprod] FATAL: LOCAL_PG_PASSWORD is not set. Export it and run again.');
  process.exit(1);
}

const localUrl = (db) => `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${db}`;

const BIN_DIR = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const PSQL = `"${process.env.PSQL_BIN || `${BIN_DIR}\\psql.exe`}"`;
const PG_DUMP = `"${process.env.PG_DUMP_BIN || `${BIN_DIR}\\pg_dump.exe`}"`;
const ADMIN_URL = `"${localUrl('postgres')}"`;
const PROD_URL = `"${localUrl(process.env.LOCAL_PROD_DB || 'timetrack_prod')}"`;
const PREPROD_URL = `"${localUrl(process.env.LOCAL_PREPROD_DB || 'timetrack_pre-prod')}"`;

console.log('1. Terminating active connections to timetrack_pre-prod...');
try {
  execSync(`${PSQL} ${ADMIN_URL} -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'timetrack_pre-prod' AND pid <> pg_backend_pid();"`, { stdio: 'inherit' });
} catch (e) {
  console.warn('Warning terminating connections:', e.message);
}

console.log('2. Dumping schema and data from timetrack_prod...');
const dumpFile = 'prod_clone.sql';
try {
  execSync(`${PG_DUMP} --no-owner --no-privileges --clean --if-exists --dbname=${PROD_URL} -f "${dumpFile}"`, { stdio: 'inherit' });
  console.log('Dump from timetrack_prod succeeded.');
} catch (e) {
  console.error('Error dumping timetrack_prod:', e.message);
  process.exit(1);
}

console.log('3. Restoring into timetrack_pre-prod...');
try {
  execSync(`${PSQL} ${PREPROD_URL} -f "${dumpFile}"`, { stdio: 'inherit' });
  console.log('Restore into timetrack_pre-prod completed successfully.');
} catch (e) {
  console.error('Error restoring into timetrack_pre-prod:', e.message);
  process.exit(1);
} finally {
  try {
    execSync(`del ${dumpFile}`, { stdio: 'ignore' });
  } catch (_) {}
}

console.log('\n4. Verifying record counts between timetrack_prod and timetrack_pre-prod:');
const tables = [
  'User',
  'CompanyProfile',
  'Employee',
  'Shift',
  'TimeEntry',
  'Geofence',
  'CompanySettings',
  'AuditLog',
  'EmploymentHistory',
  'LocationPreset',
  'RetentionPolicy'
];

console.log('Table'.padEnd(20) + ' | ' + 'timetrack_prod'.padEnd(15) + ' | ' + 'timetrack_pre-prod'.padEnd(20) + ' | Status');
console.log('-'.repeat(65));

for (const t of tables) {
  try {
    const prodCount = execSync(`${PSQL} ${PROD_URL} -t -c "SELECT count(*) FROM \\"${t}\\";"`, { encoding: 'utf-8' }).trim();
    const preprodCount = execSync(`${PSQL} ${PREPROD_URL} -t -c "SELECT count(*) FROM \\"${t}\\";"`, { encoding: 'utf-8' }).trim();
    const match = prodCount === preprodCount ? '✅ MATCH' : '❌ MISMATCH';
    console.log(`${t.padEnd(20)} | ${prodCount.padEnd(15)} | ${preprodCount.padEnd(20)} | ${match}`);
  } catch (e) {
    console.log(`${t.padEnd(20)} | ERROR: ${e.message.split('\n')[0]}`);
  }
}
