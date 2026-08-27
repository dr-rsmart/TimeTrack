/**
 * Local production-clone verification
 * -----------------------------------
 * Verifies that the locally restored production snapshot contains the
 * expected TimeTrack tables.
 *
 * SECURITY: credentials are read from environment variables — never commit
 * a connection string (see scripts/sync-prod-to-local.mjs header).
 *
 *   LOCAL_PG_PASSWORD   (required)  local PostgreSQL superuser password
 *   LOCAL_PG_HOST       (optional)  default localhost
 *   LOCAL_PG_PORT       (optional)  default 5433
 *   LOCAL_PG_USER       (optional)  default postgres
 *   LOCAL_VERIFY_DB     (optional)  default timetrack_prod
 *   PSQL_BIN            (optional)  path to psql
 */
import { execSync } from 'child_process';

const pgHost = process.env.LOCAL_PG_HOST || 'localhost';
const pgPort = process.env.LOCAL_PG_PORT || '5433';
const pgUser = process.env.LOCAL_PG_USER || 'postgres';
const pgPassword = process.env.LOCAL_PG_PASSWORD;
const db = process.env.LOCAL_VERIFY_DB || 'timetrack_prod';

if (!pgPassword) {
  console.error('[verify-prod-timetrack] FATAL: LOCAL_PG_PASSWORD is not set. Export it and run again.');
  process.exit(1);
}

const LOCAL_PROD_URL = `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${db}`;
const BIN_DIR = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const PSQL = `"${process.env.PSQL_BIN || `${BIN_DIR}\\psql.exe`}"`;

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

console.log('=== Local timetrack_prod Database Verification ===\n');

for (const table of tables) {
  try {
    const count = execSync(`${PSQL} "${LOCAL_PROD_URL}" -t -c "SELECT COUNT(*) FROM \\"${table}\\""`, { encoding: 'utf-8' }).trim();
    console.log(`- ${table.padEnd(20)} : ${count} records`);
  } catch (err) {
    console.log(`- ${table.padEnd(20)} : ERROR (${err.message.split('\n')[0]})`);
  }
}

try {
  const users = execSync(`${PSQL} "${LOCAL_PROD_URL}" -t -c "SELECT email, role, \\"fullName\\" FROM \\"User\\""`, { encoding: 'utf-8' });
  console.log('\nUsers found in timetrack_prod:\n' + users.trim());
} catch (e) {}

try {
  const companies = execSync(`${PSQL} "${LOCAL_PROD_URL}" -t -c "SELECT id, name FROM \\"CompanyProfile\\""`, { encoding: 'utf-8' });
  console.log('\nCompanies found in timetrack_prod:\n' + companies.trim());
} catch (e) {}
