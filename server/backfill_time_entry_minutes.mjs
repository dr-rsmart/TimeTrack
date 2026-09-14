#!/usr/bin/env node
/**
 * Controlled Phase 3 TimeEntry duration backfill.
 *
 * Default mode is dry-run. `--apply` is mandatory for writes. Existing
 * totalHours values are preserved and remain the compatibility source when
 * available; timestamp-derived minutes are used only when totalHours is null.
 */
import { pathToFileURL } from 'url';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function usage() {
  console.log(`Usage: node server/backfill_time_entry_minutes.mjs [options]

Options:
  --apply   Apply the guarded backfill. Without this flag, dry-run only.
  --json    Emit machine-readable output.
  --help    Show this help.
`);
}

async function migrationApplied() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM "_prisma_migrations"
    WHERE "migration_name" = '5_time_entry_integer_minutes'
      AND "finished_at" IS NOT NULL
    LIMIT 1
  `);
  return rows.length > 0;
}

async function pendingRows() {
  return prisma.$queryRawUnsafe(`
    SELECT
      "id",
      CASE
        WHEN "totalHours" IS NOT NULL THEN GREATEST(0, ROUND("totalHours" * 60))::int
        ELSE GREATEST(
          0,
          ROUND(
            (EXTRACT(EPOCH FROM ("clockOut" - "clockIn")) / 60)
            - COALESCE("breakMinutes", 0)
          )
        )::int
      END AS "totalMinutes"
    FROM "TimeEntry"
    WHERE "status" = 'completed'
      AND "clockOut" IS NOT NULL
      AND "totalMinutes" IS NULL
  `);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }

  try {
    if (!(await migrationApplied())) {
      throw new Error('Migration 5_time_entry_integer_minutes is not applied.');
    }

    const pending = await pendingRows();
    const report = {
      apply: options.apply,
      dryRun: !options.apply,
      valid: true,
      pending: pending.length,
      sample: pending.slice(0, 20).map((row) => ({
        id: row.id,
        totalMinutes: Number(row.totalMinutes),
      })),
    };

    if (!options.apply) {
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log('Persisted duration backfill dry-run:');
        console.log(`Rows eligible for backfill: ${pending.length}`);
        console.table(report.sample);
      }
      return 0;
    }

    const result = await prisma.$executeRawUnsafe(`
      UPDATE "TimeEntry"
      SET "totalMinutes" = CASE
        WHEN "totalHours" IS NOT NULL THEN GREATEST(0, ROUND("totalHours" * 60))::int
        ELSE GREATEST(
          0,
          ROUND(
            (EXTRACT(EPOCH FROM ("clockOut" - "clockIn")) / 60)
            - COALESCE("breakMinutes", 0)
          )
        )::int
      END
      WHERE "status" = 'completed'
        AND "clockOut" IS NOT NULL
        AND "totalMinutes" IS NULL
    `);

    const applied = { ...report, applied: Number(result) };
    if (options.json) console.log(JSON.stringify(applied, null, 2));
    else console.log(`Applied exact-minute values to ${Number(result)} completed time entries.`);
    return 0;
  } catch (error) {
    if (options.json)
      console.log(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      );
    else console.error('[duration-backfill] failed:', error);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
