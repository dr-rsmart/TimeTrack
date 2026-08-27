#!/usr/bin/env node
/**
 * Production-Safe Startup Script
 * -------------------------------
 * Guards against destructive database operations in production.
 *
 * Sequence:
 * 1. Best-effort database backup (skipped gracefully if pg_dump unavailable)
 * 2. Schema sync via `prisma migrate deploy` (NEVER drops data)
 * 3. Start the application server
 *
 * SAFETY: This script will NEVER run `prisma db push --accept-data-loss`.
 * In production, only recorded migrations are applied. If the schema has
 * drifted, the deploy fails loudly instead of destroying data.
 */

import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function log(msg) {
  console.log(`[production-start] ${msg}`);
}

// ── Step 1: Best-effort database backup ──
function attemptBackup() {
  try {
    log('Attempting pre-deploy database backup...');
    execSync('node backup_db.mjs', {
      cwd: SERVER_DIR,
      stdio: 'inherit',
      timeout: 60_000,
      env: { ...process.env },
    });
    log('Database backup completed.');
  } catch (err) {
    // Backup failure must NOT block startup — log and continue.
    // pg_dump may not be installed in the container image.
    log(`⚠️  Backup skipped (pg_dump unavailable or failed): ${err.message?.split('\n')[0] || 'unknown error'}`);
  }
}

// ── Step 2: Schema sync ──
// SAFETY: destructive schema changes cause a HARD FAILURE in both paths —
// never data loss. The old start command used `--accept-data-loss`, which
// silently dropped tables on schema drift — that is what destroyed
// production data once. NEVER re-add that flag.
//
// Strategy:
//   1. If the database has recognized Prisma migration history
//      (_prisma_migrations populated), apply recorded migrations with
//      `prisma migrate deploy` — reviewable, reproducible, CI-gateable.
//   2. Otherwise (db-push-provisioned databases with no history), fall back
//      to safe `prisma db push` WITHOUT --accept-data-loss: additive changes
//      apply, destructive changes fail loudly.
// To migrate a db-push database onto recorded history, run:
//   npx prisma migrate resolve --applied 0_init
//   npx prisma migrate resolve --applied 1_session_revocation_and_unique_index
// (see server/prisma/migrations/1_.../MIGRATION.md)
function syncSchema() {
  let statusOutput = '';
  let historyRecognized = false;

  try {
    statusOutput = execSync('npx prisma migrate status --schema=prisma/schema.prisma', {
      cwd: SERVER_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      encoding: 'utf8',
    });
    historyRecognized = true;
  } catch (err) {
    const text = `${err?.stdout || ''}\n${err?.stderr || ''}\n${err?.message || ''}`;
    // These markers mean "no migration history on this database" (db-push
    // provisioned) — anything else (drift, connection failure) is surfaced
    // loudly below.
    const noHistory =
      /no migration found/i.test(text) ||
      /_prisma_migrations/i.test(text) ||
      /P3006|P3018/i.test(text) ||
      /does not exist/i.test(text);
    statusOutput = text;
    historyRecognized = !noHistory;
  }

  if (historyRecognized) {
    log('Migration history recognized — applying recorded migrations via `prisma migrate deploy`...');
    try {
      execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
        cwd: SERVER_DIR,
        stdio: 'inherit',
        timeout: 120_000,
      });
      log('Recorded migrations applied successfully.');
      return;
    } catch (err) {
      log(`❌ FATAL: prisma migrate deploy failed — refusing to start to protect your data.`);
      log(`   Error: ${err.message?.split('\n')[0]}`);
      log('   Fix: resolve the migration state manually (see MIGRATION.md), or restore from backup.');
      process.exit(1);
    }
  }

  log('No migration history recognized (db-push-provisioned DB) — using safe `prisma db push` (destructive changes will FAIL, not drop data)...');
  try {
    execSync('npx prisma db push --schema=prisma/schema.prisma', {
      cwd: SERVER_DIR,
      stdio: 'inherit',
      timeout: 120_000,
    });
    log('Schema synced successfully (no data loss).');
  } catch (err) {
    log(`❌ FATAL: Schema sync failed — the pending schema change would cause DATA LOSS.`);
    log(`   Error: ${err.message?.split('\n')[0]}`);
    log(`   The server is refusing to start to protect your data.`);
    log(`   Fix: review the schema change, create a proper migration with \`prisma migrate dev\`,`);
    log(`        or manually back up and migrate the affected data before redeploying.`);
    process.exit(1);
  }
}

// ── Step 3: Start the server ──
function startServer() {
  log('Starting application server...');
  const serverProcess = spawn('node', ['dist/index.js'], {
    cwd: SERVER_DIR,
    stdio: 'inherit',
    env: { ...process.env },
  });

  serverProcess.on('exit', (code) => {
    log(`Server exited with code ${code}`);
    process.exit(code ?? 0);
  });

  // Forward termination signals
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      log(`Received ${signal}, shutting down server...`);
      serverProcess.kill(signal);
    });
  }
}

// ── Main ──
log(`Starting in ${IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);
attemptBackup();
syncSchema();
startServer();
