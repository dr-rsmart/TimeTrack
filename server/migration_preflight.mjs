#!/usr/bin/env node
/** Read-only migration gate. Uses MIGRATE_DATABASE_URL when supplied. */
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

const strict = process.argv.includes('--strict');

// Match env_check.mjs convention: load server/.env (resolved relative to this
// script, so it works from any cwd) before reading MIGRATE_DATABASE_URL.
// dotenv never overwrites variables already present in process.env, so real
// environment values (e.g. Railway) always win over the file.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverEnvPath = path.join(scriptDir, '.env');
if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else {
  dotenv.config();
}

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
    {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      env,
      encoding: 'utf8',
      // Node >= 18.20 refuses to spawn .cmd shims without a shell (EINVAL).
      shell: process.platform === 'win32',
    },
  );
  process.stdout.write(output);
  console.log('[migration-preflight] Migration history is readable.');
} catch (error) {
  const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`.trim();
  if (output) console.error(output);
  console.error(
    `[migration-preflight] Migration status could not be verified: ${error?.message?.split('\n')[0] ?? 'unknown error'}`,
  );
  console.error('[migration-preflight] Use an elevated MIGRATE_DATABASE_URL, never db push.');
  process.exit(1);
}
