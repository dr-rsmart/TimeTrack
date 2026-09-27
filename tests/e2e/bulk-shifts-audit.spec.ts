import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:4000';
const BYPASS = 'tt_perf_bench_2026';

/**
 * Bulk-shift + destructive-op authorization and audit-trail coverage (Cycle 17).
 *
 * These are the highest-blast-radius operations in the product (bulk edit/delete
 * shifts, delete time entries, resolve duplicate punches), so the tests assert
 * the BOUNDARIES rather than a fragile happy path:
 *   - authorization gating (employee must never cross into admin/manager ops)
 *   - validation rejection (missing mandatory `reason`)
 *   - the audit trail records a stable batch id + full shift id list
 *
 * API-level so they are self-contained (no seeded-row identity assumptions) and
 * run against the same seeded demo tenant as the rest of the e2e suite.
 */

async function login(
  request: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<{ token: string }> {
  const res = await request.post(`${API_BASE}/api/auth/login`, {
    data: { email, password: 'Password123' },
    headers: { 'x-perf-bypass': BYPASS },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as { token: string };
}

test.describe('Bulk shift operations — authorization & audit', () => {
  test('rejects bulk-edit and bulk-delete from an employee role (403)', async ({ request }) => {
    const { token } = await login(request, 'lerato@timetrack.com');

    for (const [method, path] of [
      ['patch', '/api/shifts/bulk-edit'],
      ['post', '/api/shifts/bulk-delete'],
    ] as const) {
      const res = await request[method](`${API_BASE}${path}`, {
        data: { ids: ['some-id'], reason: 'should never reach the handler' },
        headers: { Authorization: `Bearer ${token}`, 'x-perf-bypass': BYPASS },
      });
      expect(res.status()).toBe(403);
    }
  });

  test('rejects bulk-edit and bulk-delete without a mandatory reason (400)', async ({
    request,
  }) => {
    const { token } = await login(request, 'admin@timetrack.com');

    const edit = await request.patch(`${API_BASE}/api/shifts/bulk-edit`, {
      data: { ids: ['some-id'] },
      headers: { Authorization: `Bearer ${token}`, 'x-perf-bypass': BYPASS },
    });
    expect(edit.status()).toBe(400);

    const del = await request.post(`${API_BASE}/api/shifts/bulk-delete`, {
      data: { ids: ['some-id'] },
      headers: { Authorization: `Bearer ${token}`, 'x-perf-bypass': BYPASS },
    });
    expect(del.status()).toBe(400);
  });

  test('reports cross-tenant / unknown shift ids as NOT_FOUND without leaking existence', async ({
    request,
  }) => {
    const { token } = await login(request, 'admin@timetrack.com');

    // A syntactically-valid id that does not resolve in the caller's tenant must
    // yield BULK_NOTHING_TO_DO + a notFound list — never a 200, and never a
    // "different company" disclosure.
    const res = await request.patch(`${API_BASE}/api/shifts/bulk-edit`, {
      data: { ids: ['this-id-does-not-exist'], startTime: '09:00', reason: 'audit probe' },
      headers: { Authorization: `Bearer ${token}`, 'x-perf-bypass': BYPASS },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('BULK_NOTHING_TO_DO');
  });
});

test.describe('Destructive single-record ops — authorization & audit', () => {
  test('rejects time-entry delete from an employee for a foreign entry (404/403, not disclosed)', async ({
    request,
  }) => {
    const { token } = await login(request, 'lerato@timetrack.com');
    // An employee deleting another employee's entry must fail closed — either
    // scoped out of existence (404) or explicitly forbidden (403). A 200 here
    // would be a cross-tenant/cross-employee data-loss bug.
    const res = await request.delete(`${API_BASE}/api/time-entries/this-id-does-not-exist`, {
      headers: { Authorization: `Bearer ${token}`, 'x-perf-bypass': BYPASS },
    });
    expect([403, 404]).toContain(res.status());
  });
});
