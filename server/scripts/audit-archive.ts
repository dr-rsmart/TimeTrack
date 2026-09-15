/**
 * AuditLog archival tool — moves long-lived compliance rows into
 * AuditLogArchive (migration 11). Dry-run by default; explicit and
 * recorded in docs/DATA_CHANGES.md before use.
 *
 * Usage (from server/):
 *   npm run audit:archive -- --older-than 365 --dry-run
 *   npm run audit:archive -- --older-than 365 --apply
 */

import prisma from '../src/prisma.js';
import { runUnrestricted } from '../src/tenantDatabase.js';

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const olderThanDays = Number.parseInt(argValue('older-than') ?? '365', 10);
  const apply = process.argv.includes('--apply');
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM "AuditLog" WHERE "createdAt" < ${cutoff}
  `;
  const count = Number(rows[0]?.count ?? 0);

  console.log(`[audit:archive] ${count} AuditLog row(s) older than ${olderThanDays} day(s).`);
  if (!apply || count === 0) {
    console.log('[audit:archive] Dry run — no changes made. Re-run with --apply to archive.');
    return;
  }

  await prisma.$executeRaw`
    INSERT INTO "AuditLogArchive"
      ("id", "entity", "entityId", "action", "actorId", "actorEmail", "actorRole",
       "changes", "justification", "ipAddress", "branch", "department",
       "companyProfileId", "createdAt")
    SELECT "id", "entity", "entityId", "action", "actorId", "actorEmail", "actorRole",
           "changes"::jsonb, "justification", "ipAddress", "branch", "department",
           "companyProfileId", "createdAt"
    FROM "AuditLog" WHERE "createdAt" < ${cutoff}
    ON CONFLICT ("id") DO NOTHING;
  `;
  await prisma.$executeRaw`DELETE FROM "AuditLog" WHERE "createdAt" < ${cutoff};`;
  console.log(`[audit:archive] Archived ${count} row(s). Record this run in docs/DATA_CHANGES.md.`);
}

runUnrestricted(() => main())
  .catch((err) => {
    console.error('[audit:archive] FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
