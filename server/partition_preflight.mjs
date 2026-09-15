#!/usr/bin/env node
/** Read-only data-volume report before partitioning TimeEntry/AuditLog. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });
try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT relname AS table, n_live_tup::bigint AS estimated_rows,
           pg_size_pretty(pg_total_relation_size(relid)) AS total_size
    FROM pg_stat_user_tables
    WHERE relname IN ('TimeEntry', 'AuditLog')
    ORDER BY relname
  `);
  console.log(JSON.stringify(rows, null, 2));
  console.log(
    '[partition-preflight] Partitioning requires an operator-approved maintenance window and rollback dump.',
  );
} catch (error) {
  console.error(`[partition-preflight] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
