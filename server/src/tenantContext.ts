/**
 * Tenant Context (Defense-in-Depth)
 * ---------------------------------
 * Propagates the authenticated request's tenant (companyProfileId) through
 * AsyncLocalStorage so that the Prisma client extension can:
 *
 *   1. AUTO-STAMP `companyProfileId` on creates of tenant-scoped models when
 *      the caller omitted it (prevents orphan rows with NULL tenant).
 *   2. Provide `assertTenantMatch()` — a backstop that verifies a fetched
 *      record belongs to the current tenant, catching any query that forgot
 *      its tenant filter.
 *
 * This is an application-level RLS-equivalent safety net. It does NOT
 * replace explicit `companyProfileId` filters in queries — it catches the
 * ones that get missed.
 *
 * Contexts:
 *   - HTTP requests: set by `tenantContextMiddleware` after requireAuth.
 *   - Master / cross-tenant operations: run with `UNRESTRICTED` so they are
 *     not blocked (master routes, seed, cron, startup sync).
 */

import { AsyncLocalStorage } from 'async_hooks';

/** Sentinel meaning "no tenant restriction" (master, cron, seed). */
export const UNRESTRICTED = Symbol('tenant-unrestricted');

export type TenantContextValue = string | typeof UNRESTRICTED;

interface TenantStore {
  tenantId: TenantContextValue;
}

const storage = new AsyncLocalStorage<TenantStore>();

/** Run a function within a tenant context. */
export function runWithTenant<T>(tenantId: TenantContextValue, fn: () => T): T {
  return storage.run({ tenantId }, fn);
}

/** Get the current tenant id, or undefined if outside a context. */
export function getCurrentTenantId(): TenantContextValue | undefined {
  return storage.getStore()?.tenantId;
}

/** True when the current context is unrestricted (master/cron/seed). */
export function isUnrestricted(): boolean {
  const v = getCurrentTenantId();
  return v === UNRESTRICTED;
}

/**
 * Models that carry a `companyProfileId` tenant key. Only these participate
 * in auto-stamping and tenant verification.
 */
export const TENANT_SCOPED_MODELS = new Set([
  'User',
  'Employee',
  'Shift',
  'TimeEntry',
  'CompanySettings',
  'Geofence',
  'LocationPreset',
  'AuditLog',
]);

/**
 * Verify that a fetched record's tenant matches the current context.
 * Throws if there is a mismatch (cross-tenant leak). No-op when:
 *   - the context is unrestricted (master/cron/seed),
 *   - the record has no companyProfileId field,
 *   - the record's companyProfileId is null (legacy orphan — flagged by
 *     auto-stamp going forward),
 *   - we are outside any tenant context.
 */
export function assertTenantMatch(record: { companyProfileId?: string | null } | null | undefined): void {
  if (!record) return;
  const current = getCurrentTenantId();
  if (current === undefined || current === UNRESTRICTED) return;
  if (!('companyProfileId' in record)) return;
  if (record.companyProfileId == null) return;

  if (record.companyProfileId !== current) {
    // This indicates a query returned data from ANOTHER tenant — a serious
    // isolation bug. Fail loudly rather than leak data.
    throw new Error(
      `[tenant-guard] Cross-tenant access blocked: record belongs to tenant "${record.companyProfileId}" but request context is "${current}".`,
    );
  }
}