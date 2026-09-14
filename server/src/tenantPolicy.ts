/**
 * Database tenant-enforcement policy rules.
 *
 * These rules are deliberately pure so adversarial cases can be tested without
 * a live database. PostgreSQL migration 6 mirrors the same boundaries for
 * integrity triggers and the prepared RLS policies.
 */

export const DATABASE_UNRESTRICTED_TENANT = '*';

export const RLS_POLICY_TABLES = [
  'CompanyProfile',
  'User',
  'Employee',
  'Shift',
  'TimeEntry',
  'CompanySettings',
  'Geofence',
  'EmployeeGeofence',
  'LocationPreset',
  'AuditLog',
  'EmploymentHistory',
] as const;

/** Existing records may be null until their controlled tenant backfill is done. */
export const LEGACY_NULL_TENANT_TABLES = new Set([
  'User',
  'Employee',
  'Shift',
  'TimeEntry',
  'CompanySettings',
  'Geofence',
  'EmployeeGeofence',
  'AuditLog',
  'EmploymentHistory',
]);

/** Tables whose null tenant rows must be cleared before strict RLS activation. */
export const STRICT_TENANT_TABLES = [
  'Employee',
  'Shift',
  'TimeEntry',
  'Geofence',
  'EmployeeGeofence',
  'LocationPreset',
] as const;

export type TenantAccessContext = { kind: 'tenant'; tenantId: string } | { kind: 'unrestricted' };

export function tenantContextFor(tenantId: string | null | undefined): TenantAccessContext {
  return tenantId && tenantId.trim().length > 0
    ? { kind: 'tenant', tenantId: tenantId.trim() }
    : { kind: 'unrestricted' };
}

export function databaseTenantValue(context: TenantAccessContext): string {
  return context.kind === 'unrestricted' ? DATABASE_UNRESTRICTED_TENANT : context.tenantId;
}

/** Read/write policy decision for a row with a nullable legacy tenant key. */
export function canAccessTenantRow(
  context: TenantAccessContext,
  rowTenantId: string | null | undefined,
  options: { allowLegacyNull: boolean },
): boolean {
  if (context.kind === 'unrestricted') return true;
  if (rowTenantId == null) return options.allowLegacyNull;
  return rowTenantId === context.tenantId;
}

/** New writes must not silently create a row for another tenant. */
export function canWriteTenantRow(
  context: TenantAccessContext,
  rowTenantId: string | null | undefined,
): boolean {
  if (context.kind === 'unrestricted') return true;
  return rowTenantId === context.tenantId;
}

/** System-wide company settings are readable by every tenant, but writable only
 * by unrestricted master/system operations or the owning tenant. */
export function canReadCompanySettings(
  context: TenantAccessContext,
  rowTenantId: string | null | undefined,
): boolean {
  return context.kind === 'unrestricted' || rowTenantId == null || rowTenantId === context.tenantId;
}

/**
 * Prisma where-clause scoping a query to the acting user's tenant.
 *
 * Single shared implementation (Phase 2 consolidation — previously duplicated
 * in routes/employees.ts, routes/shifts.ts, routes/timeEntries.ts and
 * application/attendance.ts):
 *   - master/system actors are unrestricted (empty clause);
 *   - everyone else is pinned to their own tenant, with a `__none__` sentinel
 *     that matches nothing when the tenant key is unexpectedly missing
 *     (fail-safe against cross-tenant leakage).
 */
export function tenantWhere(actor: {
  role: string;
  companyProfileId: string | null;
}): Record<string, string> {
  return actor.role === 'master' ? {} : { companyProfileId: actor.companyProfileId ?? '__none__' };
}

export function canWriteCompanySettings(
  context: TenantAccessContext,
  rowTenantId: string | null | undefined,
): boolean {
  return context.kind === 'unrestricted' || rowTenantId === context.tenantId;
}

export interface TenantReference {
  relation: string;
  rowTenantId: string | null | undefined;
  referencedTenantId: string | null | undefined;
}

/**
 * Null references are allowed for legacy rows, but two known tenant IDs must
 * always agree. This is the behavior enforced by migration 6 triggers.
 */
export function validateTenantReference(reference: TenantReference): {
  valid: boolean;
  reason?: string;
} {
  if (reference.rowTenantId == null || reference.referencedTenantId == null) {
    return { valid: true };
  }
  if (reference.rowTenantId === reference.referencedTenantId) return { valid: true };
  return {
    valid: false,
    reason: `${reference.relation} crosses tenant boundary: row=${reference.rowTenantId}, reference=${reference.referencedTenantId}`,
  };
}

export function readyForRlsActivation(input: {
  migrationApplied: boolean;
  policiesInstalled: boolean;
  integrityTriggersInstalled: boolean;
  rlsAlreadyEnabled: boolean;
  inconsistentReferences: number;
  strictNullTenantRows: number;
  runtimeBridgeReady: boolean;
}): boolean {
  return (
    input.migrationApplied &&
    input.policiesInstalled &&
    input.integrityTriggersInstalled &&
    !input.rlsAlreadyEnabled &&
    input.inconsistentReferences === 0 &&
    input.strictNullTenantRows === 0 &&
    input.runtimeBridgeReady
  );
}
