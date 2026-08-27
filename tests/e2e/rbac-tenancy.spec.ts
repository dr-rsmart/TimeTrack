/**
 * RBAC & Multi-Tenancy Scope Rules — REAL MODULE VERIFICATION
 * ============================================================
 * Rewritten (Audit Cycle 15, B8 remediation): this suite previously asserted
 * a local re-implementation of scope logic and verified nothing about the
 * shipped middleware. It now exercises the production pure-logic modules:
 *  - server/src/scopeRules.ts   (manager visibility rules)
 *  - server/src/masterAuth.ts   (master route authorization)
 *  - server/src/passwords.ts    (default-password & session-epoch rules)
 */
import { test, expect } from '@playwright/test';
import {
  DEFAULT_BRANCH,
  DEFAULT_DEPARTMENT,
  hasExplicitAssignment,
  isTargetInManagerScope,
  buildManagerScopeClauses,
} from '../../server/src/scopeRules';
import { isMasterAuthorized, IMPERSONATION_EXIT_PATH } from '../../server/src/masterAuth';
import { isTokenEpochStale, isDefaultPasswordHash, DEFAULT_PASSWORD } from '../../server/src/passwords';
import bcrypt from 'bcryptjs';

test.describe('Role-Based Access Control (RBAC) & Multi-Tenancy', () => {
  test('manager sees direct reports regardless of branch/department (real rules)', () => {
    const manager = { id: 'mgr-1', branch: 'Main', department: 'Engineering' };
    const directReport = { managerId: 'mgr-1', branch: 'Remote', department: 'Sales' };
    expect(isTargetInManagerScope(manager, directReport)).toBe(true);
  });

  test('manager with explicit branch+dept sees same branch+dept employees (real rules)', () => {
    const manager = { id: 'mgr-1', branch: 'Main', department: 'Engineering' };
    expect(isTargetInManagerScope(manager, { managerId: null, branch: 'Main', department: 'Engineering' })).toBe(true);
    expect(isTargetInManagerScope(manager, { managerId: null, branch: 'North', department: 'Logistics' })).toBe(false);
    expect(isTargetInManagerScope(manager, { managerId: null, branch: 'Main', department: 'Logistics' })).toBe(false);
  });

  test('SECURITY: default-valued manager never gets a visibility bridge (real rules)', () => {
    // A manager left on Unassigned/General must NOT see other default-valued
    // employees — only direct reports.
    const defaultManager = { id: 'mgr-2', branch: DEFAULT_BRANCH, department: DEFAULT_DEPARTMENT };
    expect(hasExplicitAssignment(defaultManager.branch, defaultManager.department)).toBe(false);
    expect(
      isTargetInManagerScope(defaultManager, {
        managerId: null,
        branch: DEFAULT_BRANCH,
        department: DEFAULT_DEPARTMENT,
      }),
    ).toBe(false);
    // Partial assignment is still not explicit (branch set, dept default).
    expect(hasExplicitAssignment('Main', DEFAULT_DEPARTMENT)).toBe(false);
    expect(hasExplicitAssignment(DEFAULT_BRANCH, 'Engineering')).toBe(false);
    // Direct reports remain visible even for default-valued managers.
    expect(isTargetInManagerScope(defaultManager, { managerId: 'mgr-2', branch: DEFAULT_BRANCH, department: DEFAULT_DEPARTMENT })).toBe(true);
  });

  test('scope query clauses mirror the decision rule (real builder)', () => {
    const explicit = buildManagerScopeClauses({ id: 'm1', branch: 'Main', department: 'Eng' });
    expect(explicit).toHaveLength(2); // direct reports OR branch+dept
    expect(explicit[0]).toEqual({ managerId: 'm1' });

    const defaulted = buildManagerScopeClauses({ id: 'm2', branch: DEFAULT_BRANCH, department: DEFAULT_DEPARTMENT });
    expect(defaulted).toHaveLength(1); // direct reports ONLY — no bridge
    expect(defaulted[0]).toEqual({ managerId: 'm2' });
  });

  test('SECURITY: impersonation sessions may only exit impersonation (real rules)', () => {
    const impersonating = { role: 'admin', originalRole: 'master' };
    expect(isMasterAuthorized(impersonating, IMPERSONATION_EXIT_PATH)).toBe(true);
    expect(isMasterAuthorized(impersonating, '/companies')).toBe(false);
    expect(isMasterAuthorized(impersonating, '/stats')).toBe(false);
    expect(isMasterAuthorized(impersonating, '/operators')).toBe(false);
    expect(isMasterAuthorized(impersonating, '/impersonate/some-id')).toBe(false);

    // True masters keep the full surface.
    const master = { role: 'master', originalRole: null };
    expect(isMasterAuthorized(master, '/companies')).toBe(true);
    expect(isMasterAuthorized(master, '/stats')).toBe(true);

    // Nobody else gets in.
    expect(isMasterAuthorized({ role: 'admin', originalRole: null }, '/stats')).toBe(false);
    expect(isMasterAuthorized({ role: 'employee', originalRole: null }, IMPERSONATION_EXIT_PATH)).toBe(false);
    expect(isMasterAuthorized(null, '/stats')).toBe(false);
    expect(isMasterAuthorized(undefined, IMPERSONATION_EXIT_PATH)).toBe(false);
  });

  test('SECURITY: session epoch revocation rule (real rules)', () => {
    // Same epoch → valid. Pre-rollout tokens (no claim) match epoch 0.
    expect(isTokenEpochStale(1, 1)).toBe(false);
    expect(isTokenEpochStale(0, 0)).toBe(false);
    expect(isTokenEpochStale(undefined, 0)).toBe(false);
    expect(isTokenEpochStale(null, 0)).toBe(false);
    // Password rotated → old epoch tokens are stale.
    expect(isTokenEpochStale(0, 1)).toBe(true);
    expect(isTokenEpochStale(undefined, 2)).toBe(true);
    expect(isTokenEpochStale(1, 2)).toBe(true);
  });

  test('SECURITY: default password detection drives keep-password rejection (real rules)', async () => {
    const defaultHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
    const customHash = bcrypt.hashSync('Str0ngPass!2026', 10);

    expect(await isDefaultPasswordHash(defaultHash)).toBe(true);
    expect(await isDefaultPasswordHash(customHash)).toBe(false);
    expect(await isDefaultPasswordHash(null)).toBe(false);
    expect(await isDefaultPasswordHash(undefined)).toBe(false);
    expect(await isDefaultPasswordHash('not-a-bcrypt-hash')).toBe(false);
  });
});

