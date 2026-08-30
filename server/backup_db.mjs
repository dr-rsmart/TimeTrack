#!/usr/bin/env node
/**
 * Automated PostgreSQL Database Backup Script
 * --------------------------------------------
 * Creates timestamped pg_dump snapshots for disaster recovery.
 *
 * Usage:
 *   node server/backup_db.mjs
 *   BACKUP_DIR=/var/backups/timetrack RETENTION_DAYS=14 node server/backup_db.mjs
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const execAsync = promisify(exec);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[backup] ERROR: DATABASE_URL environment variable is not defined.');
  process.exit(1);
}

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '14', 10);

/**
 * Redact credentials from connection strings before logging. exec() error
 * messages echo the failed command — which used to leak the production DSN
 * (including the password) into Railway deploy logs.
 */
function redact(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]+(@)/gi, '$1***$2');
}

async function runBackup() {
  const startTime = Date.now();
  console.log('[backup] Starting PostgreSQL database backup...');

  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log(`[backup] Created backup directory: ${BACKUP_DIR}`);
  }

  // Format timestamp YYYY-MM-DD_HHmmss
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFileName = `timetrack_backup_${dateStr}.dump`;
  const backupFilePath = path.join(BACKUP_DIR, backupFileName);

  // Execute pg_dump
  const command = `pg_dump --format=c --no-owner --no-privileges --dbname="${DATABASE_URL}" -f "${backupFilePath}"`;

  try {
    await execAsync(command);

    const stats = fs.statSync(backupFilePath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[backup] Backup completed successfully!`);
    console.log(`[backup] File: ${backupFilePath}`);
    console.log(`[backup] Size: ${sizeMb} MB | Duration: ${durationSec}s`);

    // Retention cleanup: purge backups older than RETENTION_DAYS
    cleanupOldBackups();
  } catch (err) {
    console.error('[backup] Backup failed:', redact(err.message) || err);
    process.exit(1);
  }
}

function cleanupOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR);
    const cutoffTime = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let purgedCount = 0;

    for (const file of files) {
      if (file.startsWith('timetrack_backup_') && file.endsWith('.dump')) {
        const filePath = path.join(BACKUP_DIR, file);
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs < cutoffTime) {
          fs.unlinkSync(filePath);
          purgedCount++;
          console.log(`[backup] Pruned old backup: ${file}`);
        }
      }
    }

    if (purgedCount > 0) {
      console.log(`[backup] Cleaned up ${purgedCount} snapshot(s) older than ${RETENTION_DAYS} days.`);
    }
  } catch (err) {
    console.warn('[backup] Warning during retention cleanup:', err.message);
  }
}

runBackup();
