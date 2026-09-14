#!/usr/bin/env node
/**
 * Phase 3 persisted-duration preflight.
 *
 * Read-only. It verifies migration 5 and reports completed TimeEntry rows that
 * still need an exact integer-minute value before the compatibility column can
 * be retired in a later contract phase.
 */
import 'dotenv/config';
import { pathToFileURL } from 'url';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    strict: argv.includes('--strict'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function usage() {
  console.log(`Usage: node server/duration_preflight.mjs [options]

Options:
  --json    Emit machine-readable JSON only.
  --strict  Exit 1 when migration 5 is missing or completed rows need review.
  --help    Show this help.
`);
}

async function migrationState() {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT "migration_name" AS name, "finished_at" AS "finishedAt"
      FROM "_prisma_migrations"
      WHERE "migration_name" = '5_time_entry_integer_minutes'
        AND "finished_at" IS NOT NULL
      LIMIT 1
    `);
    return { applied: rows.length > 0, finishedAt: rows[0]?.finishedAt ?? null };
  } catch (error) {
    return {
      applied: false,
      finishedAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function durationState(schemaReady) {
  if (!schemaReady) {
    return {
      schemaReady: false,
      totalEntries: null,
      completedEntries: null,
      completedWithMinutes: null,
      pendingBackfill: null,
      completedWithoutClockOut: null,
      mismatchedCompatibilityValues: null,
    };
  }

  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS total_entries,
      COUNT(*) FILTER (
        WHERE "status" = 'completed' AND "clockOut" IS NOT NULL
      )::int AS completed_entries,
      COUNT(*) FILTER (
        WHERE "status" = 'completed'
          AND "clockOut" IS NOT NULL
          AND "totalMinutes" IS NOT NULL
      )::int AS completed_with_minutes,
      COUNT(*) FILTER (
        WHERE "status" = 'completed'
          AND "clockOut" IS NOT NULL
          AND "totalMinutes" IS NULL
      )::int AS pending_backfill,
      COUNT(*) FILTER (
        WHERE "status" = 'completed'
          AND "clockOut" IS NULL
      )::int AS completed_without_clock_out,
      COUNT(*) FILTER (
        WHERE "status" = 'completed'
          AND "clockOut" IS NOT NULL
          AND "totalMinutes" IS NOT NULL
          AND "totalHours" IS NOT NULL
          AND "totalMinutes" <> GREATEST(0, ROUND("totalHours" * 60))::int
      )::int AS mismatched_compatibility_values
    FROM "TimeEntry"
  `);

  const row = rows[0] ?? {};
  return {
    schemaReady: true,
    totalEntries: Number(row.total_entries ?? 0),
    completedEntries: Number(row.completed_entries ?? 0),
    completedWithMinutes: Number(row.completed_with_minutes ?? 0),
    pendingBackfill: Number(row.pending_backfill ?? 0),
    completedWithoutClockOut: Number(row.completed_without_clock_out ?? 0),
    mismatchedCompatibilityValues: Number(row.mismatched_compatibility_values ?? 0),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }

  try {
    const migration = await migrationState();
    const durations = await durationState(migration.applied);
    const readyForContract =
      migration.applied &&
      durations.schemaReady &&
      durations.pendingBackfill === 0 &&
      durations.completedWithoutClockOut === 0 &&
      durations.mismatchedCompatibilityValues === 0;
    const report = {
      migration,
      strict: options.strict,
      readyForContract,
      durations,
    };

    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log('TimeTrack persisted duration migration preflight');
      console.log(`Migration 5 applied: ${migration.applied ? 'yes' : 'NO'}`);
      console.table(durations);
      console.log(`Ready for totalHours contract: ${readyForContract ? 'yes' : 'NO'}`);
    }

    const blocked = !readyForContract;
    return options.strict && blocked ? 1 : 0;
  } catch (error) {
    if (options.json) console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    else console.error('[duration-preflight] failed:', error);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}