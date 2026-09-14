import { describe, expect, it } from 'vitest';
import {
  DATABASE_UNRESTRICTED_TENANT,
  RLS_POLICY_TABLES,
  canAccessTenantRow,
  canReadCompanySettings,
  canWriteTenantRow,
  canWriteCompanySettings,
  databaseTenantValue,
  readyForRlsActivation,
  tenantContextFor,
  validateTenantReference,
} from '../../server/src/tenantPolicy.js';

describe('database tenant enforcement policy', () => {
  it('normalizes tenant and unrestricted contexts without allowing empty tenants', () => {
    expect(tenantContextFor(' tenant-a ')).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
    expect(tenantContextFor('')).toEqual({ kind: 'unrestricted' });
    expect(databaseTenantValue({ kind: 'unrestricted' })).toBe(DATABASE_UNRESTRICTED_TENANT);
  });

  it('blocks cross-tenant reads and writes while allowing explicit legacy-read fallback', () => {
    const tenant = tenantContextFor('tenant-a');
    expect(canAccessTenantRow(tenant, 'tenant-b', { allowLegacyNull: true })).toBe(false);
    expect(canAccessTenantRow(tenant, null, { allowLegacyNull: true })).toBe(true);
    expect(canAccessTenantRow(tenant, null, { allowLegacyNull: false })).toBe(false);
    expect(canWriteTenantRow(tenant, 'tenant-b')).toBe(false);
    expect(canWriteTenantRow(tenant, 'tenant-a')).toBe(true);
    expect(canWriteTenantRow(tenant, null)).toBe(false);
  });

  it('allows unrestricted master/system operations', () => {
    const unrestricted = tenantContextFor(null);
    expect(canAccessTenantRow(unrestricted, 'tenant-b', { allowLegacyNull: false })).toBe(true);
    expect(canWriteTenantRow(unrestricted, 'tenant-b')).toBe(true);
  });

  it('allows tenants to read global settings without allowing global writes', () => {
    const tenant = tenantContextFor('tenant-a');
    expect(canReadCompanySettings(tenant, null)).toBe(true);
    expect(canReadCompanySettings(tenant, 'tenant-b')).toBe(false);
    expect(canWriteCompanySettings(tenant, null)).toBe(false);
    expect(canWriteCompanySettings(tenant, 'tenant-a')).toBe(true);
  });

  it('rejects known cross-tenant references but tolerates legacy unknown references', () => {
    expect(validateTenantReference({
      relation: 'TimeEntry.employee',
      rowTenantId: 'tenant-a',
      referencedTenantId: 'tenant-b',
    }).valid).toBe(false);
    expect(validateTenantReference({
      relation: 'TimeEntry.employee',
      rowTenantId: 'tenant-a',
      referencedTenantId: null,
    }).valid).toBe(true);
  });

  it('requires every activation gate before FORCE RLS can be enabled', () => {
    const base = {
      migrationApplied: true,
      policiesInstalled: true,
      integrityTriggersInstalled: true,
      rlsAlreadyEnabled: false,
      inconsistentReferences: 0,
      strictNullTenantRows: 0,
      runtimeBridgeReady: true,
    };
    expect(readyForRlsActivation(base)).toBe(true);
    expect(readyForRlsActivation({ ...base, runtimeBridgeReady: false })).toBe(false);
    expect(readyForRlsActivation({ ...base, strictNullTenantRows: 1 })).toBe(false);
    expect(readyForRlsActivation({ ...base, rlsAlreadyEnabled: true })).toBe(false);
  });

  it('keeps the policy table inventory explicit for adversarial review', () => {
    expect(RLS_POLICY_TABLES).toContain('Employee');
    expect(RLS_POLICY_TABLES).toContain('TimeEntry');
    expect(RLS_POLICY_TABLES).toContain('EmploymentHistory');
  });
});