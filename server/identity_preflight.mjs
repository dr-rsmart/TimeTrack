#!/usr/bin/env node
/**
 * Employee identity migration preflight.
 *
 * Read-only. It verifies migration 4, reports unresolved/ambiguous/cross-tenant
 * rows, and supports --strict for CI/deployment gates.
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
  console.log(`Usage: node server/identity_preflight.mjs [options]

Options:
  --json    Emit machine-readable JSON only.
  --strict  Exit 1 when migration 4 is missing or unresolved rows remain.
  --help    Show this help.
`);
}

async function migrationState() {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT "migration_name" AS name, "finished_at" AS "finishedAt"
      FROM "_prisma_migrations"
      WHERE "migration_name" = '4_employee_identity_backfill'
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

async function entitySummary(table) {
  const emailColumn = table === 'TimeEntry' ? 'employeeEmail' : 'employeeEmail';
  const rows = await prisma.$queryRawUnsafe(`
    WITH unresolved AS (
      SELECT
        source."id" AS id,
        source."companyProfileId" AS "companyProfileId",
        LOWER(TRIM(source."${emailColumn}")) AS email
      FROM "${table}" source
      WHERE source."employeeId" IS NULL
        AND source."${emailColumn}" IS NOT NULL
    ), candidate_counts AS (
      SELECT
        u.id,
        u."companyProfileId",
        COUNT(e."id") FILTER (
          WHERE u."companyProfileId" IS NULL OR e."companyProfileId" = u."companyProfileId"
        ) AS valid_candidates,
        COUNT(e."id") AS all_email_matches
      FROM unresolved u
      LEFT JOIN "Employee" e ON LOWER(TRIM(e."email")) = u.email
      GROUP BY u.id, u."companyProfileId"
    )
    SELECT
      COALESCE("companyProfileId", '<null>') AS tenant,
      COUNT(*)::int AS unresolved,
      COUNT(*) FILTER (WHERE valid_candidates = 0 AND all_email_matches = 0)::int AS unmatched,
      COUNT(*) FILTER (WHERE valid_candidates = 0 AND all_email_matches > 0)::int AS cross_tenant,
      COUNT(*) FILTER (WHERE valid_candidates > 1)::int AS ambiguous,
      COUNT(*) FILTER (WHERE valid_candidates = 1)::int AS eligible
    FROM candidate_counts
    GROUP BY "companyProfileId"
    ORDER BY tenant
  `);

  return rows.map((row) => ({
    tenant: row.tenant,
    unresolved: Number(row.unresolved),
    unmatched: Number(row.unmatched),
    crossTenant: Number(row.cross_tenant),
    ambiguous: Number(row.ambiguous),
    eligible: Number(row.eligible),
  }));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }

  try {
    const migration = await migrationState();
    const [timeEntries, shifts] = await Promise.all([
      entitySummary('TimeEntry'),
      entitySummary('Shift'),
    ]);
    const all = [...timeEntries, ...shifts];
    const totals = all.reduce(
      (sum, row) => ({
        unresolved: sum.unresolved + row.unresolved,
        unmatched: sum.unmatched + row.unmatched,
        crossTenant: sum.crossTenant + row.crossTenant,
        ambiguous: sum.ambiguous + row.ambiguous,
        eligible: sum.eligible + row.eligible,
      }),
      { unresolved: 0, unmatched: 0, crossTenant: 0, ambiguous: 0, eligible: 0 },
    );
    const report = {
      migration,
      strict: options.strict,
      readyForNotNull: migration.applied && totals.unresolved === 0,
      totals,
      timeEntries,
      shifts,
    };

    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log('TimeTrack employee identity migration preflight');
      console.log(`Migration 4 applied: ${migration.applied ? 'yes' : 'NO'}`);
      console.table({ ...totals });
      console.log('\nBy tenant/entity:');
      console.table([
        ...timeEntries.map((row) => ({ entity: 'TimeEntry', ...row })),
        ...shifts.map((row) => ({ entity: 'Shift', ...row })),
      ]);
      console.log(`Ready for NOT NULL enforcement: ${report.readyForNotNull ? 'yes' : 'NO'}`);
    }

    const blocked = !migration.applied || totals.unresolved > 0;
    return options.strict && blocked ? 1 : 0;
  } catch (error) {
    if (options.json)
      console.log(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      );
    else console.error('[identity-preflight] failed:', error);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
