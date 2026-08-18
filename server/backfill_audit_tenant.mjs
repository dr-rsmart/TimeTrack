/**
 * One-off backfill: assign companyProfileId to existing AuditLog rows.
 *
 * Resolution order per row:
 *  1. The actor's company (tenant users).
 *  2. The affected entity's company (platform-master actions on tenant data).
 *  3. Otherwise the row stays NULL (platform-level event, master-only visibility).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resolveFromEntity(row) {
  switch (row.entity) {
    case 'CompanyProfile':
      return row.entityId;
    case 'Employee': {
      const e = await prisma.employee.findUnique({ where: { id: row.entityId }, select: { companyProfileId: true } });
      return e?.companyProfileId ?? null;
    }
    case 'TimeEntry': {
      const t = await prisma.timeEntry.findUnique({ where: { id: row.entityId }, select: { companyProfileId: true } });
      return t?.companyProfileId ?? null;
    }
    case 'Shift': {
      const s = await prisma.shift.findUnique({ where: { id: row.entityId }, select: { companyProfileId: true } });
      return s?.companyProfileId ?? null;
    }
    case 'Geofence': {
      const g = await prisma.geofence.findUnique({ where: { id: row.entityId }, select: { companyProfileId: true } });
      return g?.companyProfileId ?? null;
    }
    case 'CompanySettings': {
      const c = await prisma.companySettings.findUnique({ where: { id: row.entityId }, select: { companyProfileId: true } });
      return c?.companyProfileId ?? null;
    }
    case 'Impersonation': {
      // impersonate_start stores the company id; impersonation_stop stores a user id.
      const c = await prisma.companyProfile.findUnique({ where: { id: row.entityId }, select: { id: true } });
      return c?.id ?? null;
    }
    default:
      return null;
  }
}

async function main() {
  const rows = await prisma.auditLog.findMany({ where: { companyProfileId: null } });
  console.log(`[backfill] Found ${rows.length} unscoped audit rows`);

  let updated = 0;
  for (const row of rows) {
    let companyId = null;

    // 1. Actor's company
    const actor = await prisma.user.findUnique({
      where: { id: row.actorId },
      select: { companyProfileId: true },
    });
    if (actor?.companyProfileId) companyId = actor.companyProfileId;

    // 2. Entity-based resolution (platform-master actions on tenant data)
    if (!companyId) {
      try {
        companyId = await resolveFromEntity(row);
      } catch {
        companyId = null; // entity record deleted — leave unscoped
      }
    }

    if (companyId) {
      await prisma.auditLog.update({ where: { id: row.id }, data: { companyProfileId: companyId } });
      updated++;
    }
  }

  console.log(`[backfill] Scoped ${updated} of ${rows.length} rows; remaining platform-level rows: ${rows.length - updated}`);
}

main()
  .catch((err) => {
    console.error('[backfill] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());