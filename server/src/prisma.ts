import { AsyncLocalStorage } from 'async_hooks';
import { PrismaClient, type Prisma } from '@prisma/client';
import { getCurrentTenantId, UNRESTRICTED, TENANT_SCOPED_MODELS } from './tenantContext.js';

/**
 * Connection pool sizing for stress-test readiness.
 * Prisma reads pool parameters from the DATABASE_URL query string.
 * We append them here if absent so the pool is explicitly sized
 * regardless of the .env value (default Prisma pool is too small
 * for 1,000+ concurrent VUs).
 *
 *   connection_limit=50  — supports ~500 concurrent queries with 10ms avg
 *   pool_timeout=30      — wait up to 30s for a connection before erroring
 *   connection_timeout=10 — TCP connect timeout
 */
function withPoolConfig(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', process.env.DB_POOL_SIZE || '50');
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '30');
    }
    if (!parsed.searchParams.has('connection_timeout')) {
      parsed.searchParams.set('connection_timeout', '10');
    }
    return parsed.toString();
  } catch {
    return url; // non-URL datasource (sqlite file, etc.)
  }
}

const databaseUrl = withPoolConfig(process.env.DATABASE_URL || '');

export const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  datasources: {
    db: { url: databaseUrl },
  },
});

/**
 * Tenant defense-in-depth extension.
 *
 * On `create` / `createMany` of tenant-scoped models, if the caller omitted
 * `companyProfileId` and a tenant context is active, stamp it automatically.
 * This prevents orphan rows (NULL tenant) caused by a forgotten field. It
 * never overrides an explicitly provided companyProfileId.
 *
 * Cross-tenant READ protection is provided by `assertTenantMatch` (called at
 * by-ID fetch sites) rather than a blanket query rewrite, which keeps the
 * behavior explicit and avoids surprising legitimate cross-tenant queries
 * (master console, cron, seed).
 */
const extendedPrisma = basePrisma.$extends({
  name: 'tenantAutoStamp',
  query: {
    $allModels: {
      async create({ model, args, query }) {
        maybeStamp(model, args.data as Record<string, unknown> | undefined, (d) => {
          args.data = d as never;
        });
        return query(args);
      },
      async createMany({ model, args, query }) {
        const data = args.data;
        if (Array.isArray(data)) {
          args.data = data.map((row) => stampRow(model, row as Record<string, unknown>)) as never;
        } else if (data) {
          args.data = stampRow(model, data as Record<string, unknown>) as never;
        }
        return query(args);
      },
    },
  },
});

// ── Ambient transaction bridge (Phase 4, RLS adoption) ──
// PostgreSQL RLS policies read the transaction-local `app.current_tenant`
// setting (see migration 6 + tenantDatabase.ts). HTTP requests are wrapped
// in an interactive transaction whose ambient client is stored in this
// AsyncLocalStorage; the exported `prisma` proxy below then transparently
// delegates every model call to that transaction, so existing handlers get
// DB-level tenant enforcement without per-handler rewrites.
const txStorage = new AsyncLocalStorage<Prisma.TransactionClient>();

export function withAmbientTransaction<T>(tx: Prisma.TransactionClient, fn: () => T): T {
  return txStorage.run(tx, fn);
}

export function getAmbientTransaction(): Prisma.TransactionClient | undefined {
  return txStorage.getStore();
}

/**
 * Re-routes `prisma.$transaction` inside a bridged request to the ambient
 * transaction:
 *  - callback form runs the callback with the ambient client (the same
 *    connection + tenant settings);
 *  - array form's promises were created on the ambient client already, so
 *    they just need awaiting.
 */
function bridgeTransaction(tx: Prisma.TransactionClient, fallback: typeof extendedPrisma) {
  return (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (t: Prisma.TransactionClient) => unknown)(tx);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg as Promise<unknown>[]);
    }
    return fallback.$transaction(arg as never);
  };
}

const prismaProxy = new Proxy(extendedPrisma, {
  get(target, prop, receiver) {
    if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
    const tx = txStorage.getStore();
    if (prop === '$transaction' && tx) {
      return bridgeTransaction(tx, target);
    }
    // Client-level methods ($disconnect, $transaction, ...) are bound to the
    // real client — the proxy must never become the `this`/receiver, because
    // Prisma's non-configurable data properties (`_extensions`, ...) would
    // then trip the proxy invariant.
    if (prop.startsWith('$')) {
      const fn = Reflect.get(target, prop, target);
      return typeof fn === 'function' ? fn.bind(target) : fn;
    }
    if (tx) {
      const txMember = (tx as unknown as Record<string, unknown>)[prop];
      if (txMember !== undefined) return txMember;
    }
    return Reflect.get(target, prop, target);
  },
});

export const prisma = prismaProxy as unknown as typeof extendedPrisma;

function currentTenantString(): string | null {
  const t = getCurrentTenantId();
  return typeof t === 'string' && t.length > 0 ? t : null;
}

function stampRow(
  model: string,
  row: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!row) return row;
  if (!TENANT_SCOPED_MODELS.has(model)) return row;
  const tenant = currentTenantString();
  if (!tenant) return row;
  if (row.companyProfileId !== undefined) return row; // never override explicit
  return { ...row, companyProfileId: tenant };
}

function maybeStamp(
  model: string,
  data: Record<string, unknown> | undefined,
  assign: (d: Record<string, unknown>) => void,
): void {
  const stamped = stampRow(model, data);
  if (stamped && stamped !== data) assign(stamped);
}

export default prisma;
