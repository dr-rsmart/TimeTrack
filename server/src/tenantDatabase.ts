/**
 * Transaction bridge for prepared PostgreSQL tenant policies.
 *
 * RLS settings are transaction-local. Callers must run all work that should be
 * protected inside the transaction returned by `withTenantDatabaseContext`.
 * The existing HTTP routes are not switched to this mode automatically yet;
 * migration 6 therefore prepares, but does not enable, RLS.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { databaseTenantValue, type TenantAccessContext } from './tenantPolicy.js';

type TenantTransaction = Pick<Prisma.TransactionClient, '$executeRaw'>;

export async function setTenantDatabaseContext(
  tx: TenantTransaction,
  context: TenantAccessContext,
): Promise<void> {
  const tenant = databaseTenantValue(context);
  await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenant}, true)`;
  // Legacy-null rows are never exposed to ordinary tenant contexts. A future
  // approved maintenance workflow may opt into them in its own transaction.
  await tx.$executeRaw`SELECT set_config('app.allow_legacy_null', 'off', true)`;
}

export async function withTenantDatabaseContext<T>(
  client: Pick<PrismaClient, '$transaction'>,
  context: TenantAccessContext,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await setTenantDatabaseContext(tx, context);
    return work(tx);
  });
}