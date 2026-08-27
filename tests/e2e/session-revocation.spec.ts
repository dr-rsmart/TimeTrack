/**
 * Session Revocation on Password Rotation (pwdEpoch)
 * --------------------------------------------------
 * Regression suite for Audit Cycle 16 findings NB2/B2:
 *
 *   • Every password change/reset bumps User.pwdEpoch.
 *   • JWTs carry the epoch at sign time; requireAuth rejects tokens with a
 *     stale epoch (401 SESSION_REVOKED) and closes SSE streams.
 *   • LOGIN must stamp the CURRENT epoch (the deployed Cycle-15 commit forgot
 *     this, locking every rotated user out of their next login — NB2).
 *
 * The flow is fully self-contained: it onboards a throwaway tenant via the
 * master API, exercises the rotation lifecycle on that tenant's admin, and
 * deletes the tenant again in afterAll — no seeded fixtures are mutated.
 */
import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:4000';

// Rate-limit bypass for test runs (disabled entirely on NODE_ENV=production).
const PERF_BYPASS = { 'x-perf-bypass': 'tt_perf_bench_2026' };

const runSuffix = `${Date.now()}`;
const TENANT_NAME = `Revocation E2E Tenant ${runSuffix}`;
const ADMIN_EMAIL = `revoc-admin-${runSuffix}@e2e.local`;
const TEMP_PASSWORD = 'Password123'; // seeded default by /master/onboard
const NEW_PASSWORD = 'Rotated-Pass9!'; // meets changePasswordSchema complexity

let masterToken = '';
let companyId = '';

test.describe.serial('Session revocation on password rotation (pwdEpoch)', () => {
  test.beforeAll(async ({ request }) => {
    // Master login — the platform operator who onboards tenants.
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: 'master@smartpatel.co.za', password: TEMP_PASSWORD },
    });
    expect(loginRes.status()).toBe(200);
    masterToken = (await loginRes.json()).token;

    // Onboard a throwaway company; the response includes the default
    // temporary password and the mustChangePassword flag state.
    const onboardRes = await request.post(`${API_BASE}/api/master/companies`, {
      headers: { ...PERF_BYPASS, Authorization: `Bearer ${masterToken}` },
      data: {
        name: TENANT_NAME,
        adminEmail: ADMIN_EMAIL,
        adminFirstName: 'Revocation',
        adminSurname: 'Test',
      },
    });
    expect(onboardRes.status()).toBe(201);
    const body = await onboardRes.json();
    expect(body.companyId).toBeTruthy();
    expect(body.temporaryPassword).toBe(TEMP_PASSWORD);
    companyId = body.companyId;
  });

  test.afterAll(async ({ request }) => {
    if (!companyId) return;
    // Tenant deletion cascades employees/users/settings — leaves no residue.
    const delRes = await request.delete(`${API_BASE}/api/master/companies/${companyId}`, {
      headers: { ...PERF_BYPASS, Authorization: `Bearer ${masterToken}` },
    });
    expect(delRes.status()).toBe(200);
  });

  test('step 1: fresh login on the default password issues a usable session', async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: ADMIN_EMAIL, password: TEMP_PASSWORD },
    });
    expect(loginRes.status()).toBe(200);
    const body = await loginRes.json();
    expect(body.user.mustChangePassword).toBe(true);

    const meRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { ...PERF_BYPASS, Authorization: `Bearer ${body.token}` },
    });
    expect(meRes.status()).toBe(200);
    expect((await meRes.json()).email).toBe(ADMIN_EMAIL);
  });

  test('step 2: token signed BEFORE rotation is revoked after the password change', async ({ request }) => {
    // Token A: signed at the pre-rotation epoch.
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: ADMIN_EMAIL, password: TEMP_PASSWORD },
    });
    expect(loginRes.status()).toBe(200);
    const tokenA = (await loginRes.json()).token;

    // Rotate the password → bumps pwdEpoch + cluster-wide invalidation.
    const changeRes = await request.post(`${API_BASE}/api/auth/change-password`, {
      headers: { ...PERF_BYPASS, Authorization: `Bearer ${tokenA}` },
      data: { currentPassword: TEMP_PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(changeRes.status()).toBe(200);

    // Token A now carries a stale epoch → must be rejected on next use.
    const meRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { ...PERF_BYPASS, Authorization: `Bearer ${tokenA}` },
    });
    expect(meRes.status()).toBe(401);
    const meBody = await meRes.json();
    expect(meBody.code).toBe('SESSION_REVOKED');

    // The old password must no longer authenticate either.
    const staleLogin = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: ADMIN_EMAIL, password: 'Wrong-OldPass1' },
    });
    expect(staleLogin.status()).toBe(401);
  });

  test('step 3: LOGIN AFTER rotation stamps the current epoch (NB2 regression)', async ({ request }) => {
    // Under the NB2 bug, /login signed tokens with epoch 0 regardless of the
    // stored pwdEpoch, so a just-rotated user was immediately locked out of
    // their next login. This test fails if that regression ever ships again.
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: ADMIN_EMAIL, password: NEW_PASSWORD },
    });
    expect(loginRes.status()).toBe(200);
    const body = await loginRes.json();
    expect(body.user.mustChangePassword).toBe(false);

    const meRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { ...PERF_BYPASS, Authorization: `Bearer ${body.token}` },
    });
    expect(meRes.status()).toBe(200);
    expect((await meRes.json()).email).toBe(ADMIN_EMAIL);

    // And an authenticated request straight after the fresh login still works
    // (the epoch in the token matches the live DB epoch — no revocation loop).
    const meAgain = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { ...PERF_BYPASS, Authorization: `Bearer ${body.token}` },
    });
    expect(meAgain.status()).toBe(200);
  });
});
