/**
 * Transaction bridge for PostgreSQL tenant policies (Phase 4 adoption).
 *
 * RLS settings are transaction-local. HTTP requests are wrapped in an
 * interactive transaction by `tenantBridgeMiddleware` (unrestricted by
 * default for the pre-auth phase); after authentication, `requireAuth`
 * switches the transaction to the caller's tenant via
 * `setRequestTenantContext`. The `prisma` proxy (see prisma.ts) delegates
 * every query inside a request to that transaction, so DB-level tenant
 * enforcement applies without per-handler rewrites.
 *
 * Background work (cron, seed, maintenance scripts) runs inside
 * `runUnrestricted`, which applies the '*' (master/system) context.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { databaseTenantValue, type TenantAccessContext } from './tenantPolicy.js';
import { basePrisma, getAmbientTransaction, withAmbientTransaction } from './prisma.js';

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
  return client.$transaction(
    async (tx) => {
      await setTenantDatabaseContext(tx, context);
      // Publish the transaction client in the AsyncLocalStorage so the
      // `prisma` proxy delegates every query inside `work` to it — this is
      // what makes DB-level tenant enforcement apply to existing handlers.
      return withAmbientTransaction(tx, () => work(tx));
    },
    // Generous bounds: handlers may perform external HTTP calls (geocoding)
    // while holding the transaction; the default 5s interactive timeout
    // would abort legitimate long requests.
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/**
 * Run work in an unrestricted ('*') transaction — the master/system context
 * used by cron jobs, seeding, maintenance scripts and the pre-auth phase of
 * every HTTP request.
 */
export function runUnrestricted<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withTenantDatabaseContext(basePrisma, { kind: 'unrestricted' }, work);
}

/**
 * Switch the ambient transaction to the given tenant context. Called by
 * requireAuth after a user has been authenticated. No-op outside a bridged
 * request (e.g. unit tests).
 */
export async function setRequestTenantContext(context: TenantAccessContext): Promise<void> {
  const tx = getAmbientTransaction();
  if (!tx) return;
  await setTenantDatabaseContext(tx, context);
}

/**
 * Express middleware wrapping the remainder of the request chain in an
 * unrestricted tenant transaction.
 *
 * Completion detection: Express 5's `next()` returns only the IMMEDIATE next
 * middleware's return value (rate-limiters and similar middlewares call
 * `next()` without returning the downstream promise), so the chain is
 * considered complete when the response is finished (or the connection
 * closes). The transaction commits at that point — after the handler has
 * fully written the response.
 *
 * The SSE endpoint is exempt: it self-bridges around the handshake (see the
 * /api/events route) so the long-lived stream never holds a transaction.
 */
export function tenantBridgeMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/events') {
    next();
    return;
  }

  // Re-entrancy guard: the bridge is mounted on both `/api` and `/api/v1`,
  // and Express prefix-matching means a `/api/v1/*` request matches BOTH
  // mounts. If an ambient transaction is already active this is the inner
  // (nested) invocation — pass through instead of opening a second
  // transaction that would hold an extra pooled connection for the whole
  // request (OPERATIONS §8.2 pool budget: one transaction per request).
  if (getAmbientTransaction()) {
    next();
    return;
  }

  const runChain = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => () => {
        if (settled) return;
        settled = true;
        fn();
      };
      res.once('finish', settle(resolve));
      res.once('close', settle(resolve));
      try {
        next();
      } catch (err) {
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    });

  runUnrestricted(() => runChain()).catch((err) => {
    next(err as Error);
  });
}
