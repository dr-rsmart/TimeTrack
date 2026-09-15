#!/usr/bin/env node
/** Read-only migration gate. Uses MIGRATE_DATABASE_URL when supplied. */
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const strict = process.argv.includes('--strict');
const env = { ...process.env };
if (env.MIGRATE_DATABASE_URL) env.DATABASE_URL = env.MIGRATE_DATABASE_URL;

if (strict && !env.MIGRATE_DATABASE_URL) {
  console.error('[migration-preflight] MIGRATE_DATABASE_URL is required in strict mode.');
  process.exit(2);
}

try {
  const output = execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['prisma', 'migrate', 'status', '--schema=prisma/schema.prisma'],
    { cwd: path.dirname(fileURLToPath(import.meta.url)), env, encoding: 'utf8' },
  );
  process.stdout.write(output);
  console.log('[migration-preflight] Migration history is readable.');
} catch (error) {
  const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
  console.error(output.trim());
  console.error('[migration-preflight] Migration status could not be verified.');
  console.error('[migration-preflight] Use an elevated MIGRATE_DATABASE_URL, never db push.');
  process.exit(1);
}
