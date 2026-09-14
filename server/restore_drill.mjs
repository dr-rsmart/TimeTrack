#!/usr/bin/env node
/**
 * Restore Drill — verifies backups actually restore.
 * -------------------------------------------------
 * Creates a scratch database, restores the latest pg_dump snapshot into it,
 * verifies row counts against the source database, then drops the scratch
 * database. Records measured RTO (restore time) so the DR runbook in
 * docs/OPERATIONS.md can cite real numbers instead of aspirations.
 *
 * Prerequisites:
 *   - pg_dump / pg_restore / psql / dropdb on PATH (e.g. PostgreSQL bin dir)
 *   - DATABASE_URL set (the SOURCE database)
 *   - a snapshot in server/backups (run `npm run db:backup` first)
 *
 * Usage:
 *   node restore_drill.mjs
 *   RESTORE_DRY_RUN=1 node restore_drill.mjs   # validate tooling only
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function redact(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]+(@)/gi, '$1***$2');
}

function sanitizeDbUrl(raw) {
  try {
    const url = new URL(raw);
    url.searchParams.delete('schema');
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * libpq connection env for pg_* tools. Using env vars (PGHOST/PGPORT/...)
 * instead of URI arguments avoids Windows libpq URI-parsing quirks where
 * `dropdb`/`pg_restore` can misparse a conninfo URI and fall back to the
 * default port. Env vars are deterministic and never echo credentials.
 */
function libpqEnv(rawUrl) {
  const url = new URL(sanitizeDbUrl(rawUrl));
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
}

const DRY_RUN = process.env.RESTORE_DRY_RUN === '1';
const DRILL_DB = 'timetrack_restore_drill';
const TABLES_TO_VERIFY = [
  '"User"',
  '"Employee"',
  '"CompanyProfile"',
  '"Shift"',
  '"TimeEntry"',
  '"AuditLog"',
];

function latestBackup(backupDir) {
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('timetrack_backup_') && f.endsWith('.dump'))
    .sort();
  return files.length ? path.join(backupDir, files[files.length - 1]) : null;
}

async function countRows(pgEnv, dbName, table) {
  const { stdout } = await execFileAsync(
    'psql',
    ['-d', dbName, '-Atc', `SELECT count(*) FROM ${table};`],
    { env: pgEnv },
  );
  return parseInt(stdout.trim(), 10);
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('[restore-drill] ERROR: DATABASE_URL is not defined.');
    process.exit(1);
  }

  const backupDir = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
  const snapshot = latestBackup(backupDir);
  if (!snapshot) {
    console.error('[restore-drill] ERROR: no timetrack_backup_*.dump found in', backupDir);
    console.error('[restore-drill] Run `npm run db:backup` first.');
    process.exit(1);
  }
  console.log(`[restore-drill] Snapshot: ${snapshot}`);

  const sourceDb = new URL(sanitizeDbUrl(DATABASE_URL)).pathname.replace(/^\//, '') || 'postgres';
  const pgEnv = libpqEnv(DATABASE_URL);

  const startedAt = Date.now();
  try {
    console.log(`[restore-drill] Dropping any previous drill DB (if present)...`);
    await execFileAsync('dropdb', ['--if-exists', '--force', DRILL_DB], { env: pgEnv });

    console.log(`[restore-drill] Creating scratch database ${DRILL_DB}...`);
    await execFileAsync('psql', ['-d', 'postgres', '-Atc', `CREATE DATABASE ${DRILL_DB};`], {
      env: pgEnv,
    });

    console.log(`[restore-drill] Restoring snapshot into ${DRILL_DB}...`);
    if (DRY_RUN) {
      console.log(`[restore-drill] DRY RUN — would restore "${snapshot}" into ${DRILL_DB}.`);
      return;
    }
    await execFileAsync(
      'pg_restore',
      ['--clean', '--if-exists', '--no-owner', '-d', DRILL_DB, snapshot],
      { env: pgEnv, timeout: 600_000 },
    );

    const restoreSec = ((Date.now() - startedAt) / 1000).toFixed(2);

    console.log(`[restore-drill] Verifying row counts (source vs restored)...`);
    let verified = 0;
    for (const table of TABLES_TO_VERIFY) {
      const src = await countRows(pgEnv, sourceDb, table);
      const drill = await countRows(pgEnv, DRILL_DB, table);
      const ok = src === drill ? 'OK' : 'MISMATCH';
      if (src === drill) verified++;
      console.log(`[restore-drill]   ${table}: source=${src} restored=${drill} ${ok}`);
    }

    console.log(`[restore-drill] Dropping scratch DB ${DRILL_DB}...`);
    await execFileAsync('dropdb', ['--if-exists', '--force', DRILL_DB], { env: pgEnv });

    console.log(
      `[restore-drill] DRILL PASSED — restored ${verified}/${TABLES_TO_VERIFY.length} tables verified.`,
    );
    console.log(`[restore-drill] Measured RTO (restore wall-clock): ${restoreSec}s`);
    process.exit(0);
  } catch (err) {
    console.error('[restore-drill] DRILL FAILED:', redact(err.message) || err);
    // Best-effort cleanup so the scratch DB does not linger.
    try {
      await execFileAsync('dropdb', ['--if-exists', '--force', DRILL_DB], { env: pgEnv });
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
}

main();
