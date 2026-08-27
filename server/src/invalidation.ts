/**
 * Cluster-Wide Invalidation & Session Revocation Fan-Out
 * -------------------------------------------------------
 * Multi-instance deployments keep per-process caches (company-active,
 * employee-status, live role/pwdEpoch) and per-process SSE registries. When
 * one replica suspends a tenant, terminates an employee, demotes a role or
 * rotates a password, EVERY replica must drop its cached state / close the
 * affected streams — otherwise enforcement lags up to the cache TTL on the
 * other nodes.
 *
 * Mechanism: a dedicated Redis Pub/Sub channel. Each replica subscribes and
 * applies commands locally. Without Redis (single-instance mode) commands are
 * applied locally immediately, so behavior is identical.
 *
 * All command applications are idempotent (cache deletes / stream closes),
 * so local-apply-on-publish + loopback delivery is safe.
 */

import { Redis } from 'ioredis';
import config from './config.js';

const INVALIDATION_CHANNEL = 'timetrack:invalidation';

export type InvalidationCommand =
  | { type: 'invalidate-user'; userId: string }
  | { type: 'invalidate-company'; companyProfileId: string }
  | { type: 'invalidate-employee-status'; email: string; companyProfileId: string | null }
  | { type: 'disconnect-user'; userId: string }
  | { type: 'disconnect-tenant'; companyProfileId: string };

type CommandHandler = (cmd: InvalidationCommand) => void;

const handlers = new Set<CommandHandler>();

let pub: Redis | null = null;
let sub: Redis | null = null;

const redisUrl = config.redisUrl;

if (redisUrl) {
  try {
    const commonOpts = {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      keepAlive: 10_000,
      connectTimeout: 10_000,
      retryStrategy: (times: number) => {
        const delay = Math.min(100 * Math.pow(2, Math.min(times, 5)), 3000);
        return delay + Math.floor(Math.random() * 200);
      },
      reconnectOnError: (err: Error) => {
        if (err.message.includes('READONLY')) return 2 as const;
        return false;
      },
    };

    pub = new Redis(redisUrl, commonOpts);
    sub = new Redis(redisUrl, commonOpts);

    pub.on('error', (err) => {
      console.warn('[invalidation] Pub error (local-only fan-out until reconnect):', err.message);
    });
    sub.on('error', (err) => {
      console.warn('[invalidation] Sub error (local-only fan-out until reconnect):', err.message);
    });
    sub.on('connect', () => {
      sub?.subscribe(INVALIDATION_CHANNEL, (err) => {
        if (err) console.error('[invalidation] Failed to subscribe:', err.message);
      });
    });
    sub.on('message', (channel, message) => {
      if (channel !== INVALIDATION_CHANNEL) return;
      try {
        const cmd = JSON.parse(message) as InvalidationCommand;
        for (const h of handlers) {
          try {
            h(cmd);
          } catch (err) {
            console.error('[invalidation] Handler error:', err);
          }
        }
      } catch (err) {
        console.error('[invalidation] Failed to parse command:', err);
      }
    });

    pub.connect().catch((err) => {
      console.warn('[invalidation] Pub initial connection unavailable (local-only):', err.message);
    });
    sub.connect().catch((err) => {
      console.warn('[invalidation] Sub initial connection unavailable (local-only):', err.message);
    });
  } catch (err: any) {
    console.warn('[invalidation] Setup failed (local-only fan-out):', err?.message);
    pub = null;
    sub = null;
  }
}

/** Register a local applier for invalidation commands (auth caches, SSE). */
export function onInvalidationCommand(handler: CommandHandler): void {
  handlers.add(handler);
}

function applyLocally(cmd: InvalidationCommand): void {
  for (const h of handlers) {
    try {
      h(cmd);
    } catch (err) {
      console.error('[invalidation] Handler error:', err);
    }
  }
}

/**
 * Publish an invalidation command to all replicas.
 * Always applies locally as well (idempotent) so the originating replica is
 * never dependent on the Redis round-trip.
 */
export function publishInvalidation(cmd: InvalidationCommand): void {
  applyLocally(cmd);
  if (pub && (pub.status === 'ready' || pub.status === 'connect')) {
    pub.publish(INVALIDATION_CHANNEL, JSON.stringify(cmd)).catch((err) => {
      console.warn('[invalidation] Redis publish failed (local apply already done):', err.message);
    });
  }
}

// ── Convenience helpers for call sites ──

/** Role/pwdEpoch cache: drop on any role change OR password change/reset. */
export function invalidateUserClusterWide(userId: string): void {
  publishInvalidation({ type: 'invalidate-user', userId });
}

/** Tenant suspension/activation: drop the company-active cache everywhere. */
export function invalidateCompanyClusterWide(companyProfileId: string): void {
  publishInvalidation({ type: 'invalidate-company', companyProfileId });
}

/** Employee status change (terminate/reactivate): drop the status cache. */
export function invalidateEmployeeStatusClusterWide(email: string, companyProfileId: string | null): void {
  publishInvalidation({ type: 'invalidate-employee-status', email, companyProfileId });
}

/** Close a user's SSE streams on every replica (termination, password change). */
export function disconnectUserClusterWide(userId: string): void {
  publishInvalidation({ type: 'disconnect-user', userId });
}

/** Close a tenant's SSE streams on every replica (suspension). */
export function disconnectTenantClusterWide(companyProfileId: string): void {
  publishInvalidation({ type: 'disconnect-tenant', companyProfileId });
}
