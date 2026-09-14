#!/usr/bin/env node
/**
 * Controlled employee identity resolution.
 *
 * Default mode is dry-run. `--apply` is mandatory for writes. Every mapping
 * must explicitly identify the source row, target employee, source/target
 * emails, tenant approval, approver, and reason.
 */
import fs from 'fs/promises';
import { pathToFileURL } from 'url';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { validateResolutionMapping } from './identity_migration_rules.mjs';

const prisma = new PrismaClient({ log: ['error'] });

function args(argv) {
  const get = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    mapping: get('--mapping'),
    apply: argv.includes('--apply'),
    json: argv.includes('--json'),
    actorId: get('--actor-id'),
    actorEmail: get('--actor-email'),
    actorRole: get('--actor-role') || 'migration_operator',
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function usage() {
  console.log(`Usage: node server/resolve_employee_identity.mjs --mapping <file> [options]

Options:
  --mapping <file>  JSON approval mapping file.
  --apply           Apply validated mappings. Without this flag, dry-run only.
  --actor-id <id>   Required with --apply for the audit actor.
  --actor-email <e> Required with --apply for the audit actor.
  --actor-role <r>  Optional audit role (default: migration_operator).
  --json            Emit machine-readable output.
  --help            Show this help.
`);
}

async function readMapping(path) {
  const parsed = JSON.parse(await fs.readFile(path, 'utf8'));
  return {
    timeEntries: Array.isArray(parsed.timeEntries) ? parsed.timeEntries : [],
    shifts: Array.isArray(parsed.shifts) ? parsed.shifts : [],
  };
}

async function migrationApplied() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM "_prisma_migrations"
    WHERE "migration_name" = '4_employee_identity_backfill'
      AND "finished_at" IS NOT NULL
    LIMIT 1
  `);
  return rows.length > 0;
}

async function validateRows(rows, table) {
  const results = [];
  for (const mapping of rows) {
    const source = table === 'TimeEntry'
      ? await prisma.timeEntry.findUnique({ where: { id: mapping.id }, select: { id: true, employeeId: true, employeeEmail: true, companyProfileId: true } })
      : await prisma.shift.findUnique({ where: { id: mapping.id }, select: { id: true, employeeId: true, employeeEmail: true, companyProfileId: true } });
    const target = mapping.employeeId
      ? await prisma.employee.findUnique({ where: { id: mapping.employeeId }, select: { id: true, email: true, companyProfileId: true } })
      : null;
    const validation = source && target
      ? validateResolutionMapping({ source, target, mapping })
      : { valid: false, errors: [!source ? `${table} source row not found` : 'target employee not found'] };
    results.push({ table, id: mapping.id, employeeId: mapping.employeeId, valid: validation.valid, errors: validation.errors });
  }
  return results;
}

function duplicateIds(rows) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) duplicates.add(row.id);
    seen.add(row.id);
  }
  return [...duplicates];
}

export async function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  if (options.help) {
    usage();
    return 0;
  }
  if (!options.mapping) {
    usage();
    return 1;
  }

  try {
    if (!(await migrationApplied())) throw new Error('Migration 4_employee_identity_backfill is not applied.');
    const mapping = await readMapping(options.mapping);
    const duplicateSourceIds = [
      ...duplicateIds(mapping.timeEntries),
      ...duplicateIds(mapping.shifts),
    ];
    if (duplicateSourceIds.length > 0) {
      throw new Error(`Mapping contains duplicate source IDs: ${duplicateSourceIds.join(', ')}`);
    }
    const results = [
      ...(await validateRows(mapping.timeEntries, 'TimeEntry')),
      ...(await validateRows(mapping.shifts, 'Shift')),
    ];
    const invalid = results.filter((row) => !row.valid);
    const report = { apply: options.apply, dryRun: !options.apply, valid: invalid.length === 0, results };

    if (invalid.length > 0 || !options.apply) {
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(options.apply ? 'Identity resolution rejected:' : 'Identity resolution dry-run:');
        console.table(results);
      }
      return invalid.length > 0 ? 1 : 0;
    }

    if (!options.actorId || !options.actorEmail) throw new Error('--actor-id and --actor-email are required with --apply.');

    await prisma.$transaction(async (tx) => {
      for (const row of [...mapping.timeEntries.map((m) => ({ ...m, table: 'TimeEntry' })), ...mapping.shifts.map((m) => ({ ...m, table: 'Shift' }))]) {
        const guarded = row.table === 'TimeEntry'
          ? await tx.timeEntry.updateMany({ where: { id: row.id, employeeId: null }, data: { employeeId: row.employeeId } })
          : await tx.shift.updateMany({ where: { id: row.id, employeeId: null }, data: { employeeId: row.employeeId } });
        if (guarded.count !== 1) {
          throw new Error(`${row.table} ${row.id} changed after preflight or is already resolved.`);
        }
        await tx.auditLog.create({
          data: {
            entity: row.table,
            entityId: row.id,
            action: 'identity_backfill',
            actorId: options.actorId,
            actorEmail: options.actorEmail,
            actorRole: options.actorRole,
            companyProfileId: row.companyProfileId ?? undefined,
            justification: `Approved by ${row.approvedBy}: ${row.reason}`,
            changes: {
              employee_id: { before: null, after: row.employeeId },
              source_email: { before: row.sourceEmail, after: row.targetEmail },
            },
          },
        });
      }
    });

    const applied = { ...report, applied: results.length };
    if (options.json) console.log(JSON.stringify(applied, null, 2));
    else console.log(`Applied ${results.length} approved identity mappings transactionally.`);
    return 0;
  } catch (error) {
    if (options.json) console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    else console.error('[identity-resolve] failed:', error);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}