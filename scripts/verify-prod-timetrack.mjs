import { execSync } from 'child_process';

const LOCAL_PROD_URL = "postgresql://postgres:RicJer24@127.0.0.1:5433/timetrack_prod";
const PSQL = `"C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"`;

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
