import { execSync } from 'child_process';

const PROD_URL = "postgresql://postgres:xfQZELnpkbAXaKchuYIlqtgCZEwCjzxF@altaria.proxy.rlwy.net:54199/railway";
const LOCAL_POSTGRES_ADMIN = "postgresql://postgres:RicJer24@127.0.0.1:5432/postgres";
const LOCAL_PROD_URL = "postgresql://postgres:RicJer24@127.0.0.1:5432/timetrack_prod";

const PSQL = `"C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"`;
const PG_DUMP = `"C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe"`;

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

console.log('3. Restoring into local timetrack_prod database...');
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

console.log('4. Verifying tables in timetrack_prod...');
try {
  const tables = execSync(`${PSQL} "${LOCAL_PROD_URL}" -t -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"`, { encoding: 'utf-8' });
  console.log('Tables present:\n' + tables.trim());
} catch (err) {
  console.error('Error verifying tables:', err.message);
}
