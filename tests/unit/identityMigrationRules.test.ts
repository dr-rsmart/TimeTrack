import { describe, expect, it } from 'vitest';
import {
  classifyIdentityCandidates,
  normalizeIdentityEmail,
  validateResolutionMapping,
} from '../../server/identity_migration_rules.mjs';

describe('controlled identity migration rules', () => {
  it('normalizes approval emails', () => {
    expect(normalizeIdentityEmail(' Person@Example.COM ')).toBe('person@example.com');
    expect(normalizeIdentityEmail(null)).toBe('');
  });

  it('classifies only one same-tenant candidate as eligible', () => {
    expect(
      classifyIdentityCandidates({
        sourceTenantId: 'tenant-a',
        candidates: [{ id: 'emp-1', companyProfileId: 'tenant-a' }],
        allEmailMatches: [{ id: 'emp-1' }],
      }),
    ).toBe('eligible');
    expect(
      classifyIdentityCandidates({
        sourceTenantId: 'tenant-a',
        candidates: [
          { id: 'emp-1', companyProfileId: 'tenant-a' },
          { id: 'emp-2', companyProfileId: 'tenant-a' },
        ],
        allEmailMatches: [],
      }),
    ).toBe('ambiguous');
    expect(
      classifyIdentityCandidates({
        sourceTenantId: 'tenant-a',
        candidates: [],
        allEmailMatches: [{ id: 'emp-b', companyProfileId: 'tenant-b' }],
      }),
    ).toBe('cross_tenant');
  });

  it('rejects mappings that cross tenants or target a resolved source row', () => {
    const base = {
      source: {
        id: 'entry-1',
        employeeId: null,
        employeeEmail: 'old@example.com',
        companyProfileId: 'tenant-a',
      },
      target: { id: 'emp-1', email: 'new@example.com', companyProfileId: 'tenant-b' },
      mapping: {
        id: 'entry-1',
        employeeId: 'emp-1',
        sourceEmail: 'old@example.com',
        targetEmail: 'new@example.com',
        approvedBy: 'owner@example.com',
        reason: 'Confirmed by the tenant data owner.',
      },
    };
    expect(validateResolutionMapping(base).valid).toBe(false);

    expect(
      validateResolutionMapping({
        ...base,
        target: { ...base.target, companyProfileId: 'tenant-a' },
        source: { ...base.source, employeeId: 'already-linked' },
      }).errors,
    ).toContain('source row already has employeeId');
  });

  it('accepts a complete same-tenant approved mapping', () => {
    expect(
      validateResolutionMapping({
        source: {
          id: 'entry-1',
          employeeId: null,
          employeeEmail: 'old@example.com',
          companyProfileId: 'tenant-a',
        },
        target: { id: 'emp-1', email: 'new@example.com', companyProfileId: 'tenant-a' },
        mapping: {
          id: 'entry-1',
          employeeId: 'emp-1',
          sourceEmail: 'old@example.com',
          targetEmail: 'new@example.com',
          approvedBy: 'owner@example.com',
          reason: 'Confirmed by signed employment records.',
        },
      }).valid,
    ).toBe(true);
  });
});
