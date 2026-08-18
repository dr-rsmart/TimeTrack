import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:4000';
const PERF_BYPASS = { 'x-perf-bypass': 'tt_perf_bench_2026' };

test.describe.serial('Master Role (Platform Operator) — Process Test Pack', () => {
  let masterToken: string;
  let createdCompanyId: string;
  let testOperatorId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Authentication with rate limit bypass
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: {
        email: 'master@smartpatel.co.za',
        password: 'Password123',
      },
    });
    expect(loginRes.status()).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.user.role).toBe('master');
    masterToken = loginData.token;
  });

  const authHeader = () => ({
    Authorization: `Bearer ${masterToken}`,
    ...PERF_BYPASS,
  });

  test('Process 1: View Platform Statistics (GET /api/master/stats)', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/master/stats`, {
      headers: authHeader(),
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.totalCompanies).toBeGreaterThanOrEqual(1);
    expect(data.totalUsers).toBeGreaterThanOrEqual(1);
    expect(data.totalEmployees).toBeGreaterThanOrEqual(1);
    expect(typeof data.totalHoursToday).toBe('number');
  });

  test('Process 2: List All Tenant Companies (GET /api/master/companies)', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/master/companies`, {
      headers: authHeader(),
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    expect(data.items[0]).toHaveProperty('name');
    expect(data.items[0]).toHaveProperty('isActive');
  });

  test('Process 3: Onboard New Tenant Company (POST /api/master/companies)', async ({ request }) => {
    const rand = Math.floor(Math.random() * 10000);
    const res = await request.post(`${API_BASE}/api/master/companies`, {
      headers: authHeader(),
      data: {
        name: `Test Enterprise ${rand}`,
        phone: '+27 11 000 9999',
        address: '100 Innovation Blvd, Sandton',
        billingTier: 'enterprise',
        adminEmail: `tenantadmin_${rand}@enterprise.co.za`,
        adminFirstName: 'Test',
        adminSurname: 'Admin',
      },
    });
    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.companyId).toBeDefined();
    expect(data.temporaryPassword).toBe('Password123');
    createdCompanyId = data.companyId;
  });

  test('Process 4: Edit Tenant Company Profile (PUT /api/master/companies/:id)', async ({ request }) => {
    expect(createdCompanyId).toBeDefined();
    const res = await request.put(`${API_BASE}/api/master/companies/${createdCompanyId}`, {
      headers: authHeader(),
      data: {
        name: `Updated Test Enterprise`,
        phone: '+27 11 000 8888',
        address: '200 Upgraded Road, Sandton',
        billingTier: 'premium',
        adminEmail: 'updated_admin@enterprise.co.za',
        adminFirstName: 'Updated',
        adminSurname: 'Admin',
      },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.company.name).toBe('Updated Test Enterprise');
  });

  test('Process 5: Suspend and Reactivate Tenant (POST /api/master/companies/:id/toggle)', async ({ request }) => {
    expect(createdCompanyId).toBeDefined();
    // Suspend
    const suspendRes = await request.post(`${API_BASE}/api/master/companies/${createdCompanyId}/toggle`, {
      headers: authHeader(),
    });
    expect(suspendRes.status()).toBe(200);
    const suspendData = await suspendRes.json();
    expect(suspendData.isActive).toBe(false);

    // Reactivate
    const activateRes = await request.post(`${API_BASE}/api/master/companies/${createdCompanyId}/toggle`, {
      headers: authHeader(),
    });
    expect(activateRes.status()).toBe(200);
    const activateData = await activateRes.json();
    expect(activateData.isActive).toBe(true);
  });

  test('Process 6: Manage Platform Master Accounts (POST/GET /api/master/operators)', async ({ request }) => {
    const rand = Math.floor(Math.random() * 10000);
    const createRes = await request.post(`${API_BASE}/api/master/operators`, {
      headers: authHeader(),
      data: {
        email: `operator_${rand}@smartpatel.co.za`,
        fullName: `Operator Master ${rand}`,
      },
    });
    expect(createRes.status()).toBe(201);
    const createData = await createRes.json();
    expect(createData.success).toBe(true);
    testOperatorId = createData.operator.id;

    // List operators
    const listRes = await request.get(`${API_BASE}/api/master/operators`, {
      headers: authHeader(),
    });
    expect(listRes.status()).toBe(200);
    const listData = await listRes.json();
    expect(listData.items.some((o: any) => o.id === testOperatorId)).toBe(true);

    // Reset operator password
    const resetRes = await request.post(`${API_BASE}/api/master/operators/${testOperatorId}/reset-password`, {
      headers: authHeader(),
    });
    expect(resetRes.status()).toBe(200);
    const resetData = await resetRes.json();
    expect(resetData.temporaryPassword).toBe('Password123');
  });

  test('Process 7: Demo Login Simulation (POST /api/master/demo-login)', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/master/demo-login`, {
      headers: authHeader(),
      data: { email: 'thabo@timetrack.com' },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
  });

  test('Process 8: Tenant Impersonation & Exit (POST /api/master/impersonate, stop-impersonation)', async ({ request }) => {
    // Impersonate
    const impRes = await request.post(`${API_BASE}/api/master/impersonate/${createdCompanyId}`, {
      headers: authHeader(),
    });
    expect(impRes.status()).toBe(200);
    const impData = await impRes.json();
    expect(impData.success).toBe(true);

    // Stop Impersonation
    const stopRes = await request.post(`${API_BASE}/api/master/stop-impersonation`, {
      headers: {
        Authorization: `Bearer ${impData.token}`,
        ...PERF_BYPASS,
      },
    });
    expect(stopRes.status()).toBe(200);
    const stopData = await stopRes.json();
    expect(stopData.success).toBe(true);
  });

  test('Process 9: Manage System-Wide Holidays (POST/DELETE /api/settings/holidays scope=system)', async ({ request }) => {
    const testHolidayDate = '2026-12-31';
    // Add system holiday
    const addRes = await request.post(`${API_BASE}/api/settings/holidays`, {
      headers: authHeader(),
      data: {
        date: testHolidayDate,
        scope: 'system',
      },
    });
    expect([201, 409]).toContain(addRes.status());

    // List holidays
    const listRes = await request.get(`${API_BASE}/api/settings/holidays`, {
      headers: authHeader(),
    });
    expect(listRes.status()).toBe(200);
    const listData = await listRes.json();
    expect(listData.systemHolidays).toContain(testHolidayDate);

    // Delete system holiday
    const delRes = await request.delete(`${API_BASE}/api/settings/holidays/${testHolidayDate}?scope=system`, {
      headers: authHeader(),
    });
    expect(delRes.status()).toBe(200);
  });

  test('Process 10: View Global Unfiltered Audit Trail (GET /api/audit)', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/audit?limit=25`, {
      headers: authHeader(),
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.total).toBeGreaterThanOrEqual(1);
    // Master sees real IP address (unredacted)
    if (data.items.length > 0 && data.items[0].ipAddress) {
      expect(data.items[0].ipAddress).not.toBe('REDACTED');
    }
  });

  test.afterAll(async ({ request }) => {
    // Cleanup onboarded test company
    if (createdCompanyId) {
      await request.delete(`${API_BASE}/api/master/companies/${createdCompanyId}`, {
        headers: authHeader(),
      });
    }
  });
});
