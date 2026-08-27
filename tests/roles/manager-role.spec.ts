import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:4000';
const PERF_BYPASS = { 'x-perf-bypass': 'tt_perf_bench_2026' };

test.describe.serial('Manager Role (Department / Branch Supervisor) — Process Test Pack', () => {
  let managerToken: string;
  let adminToken: string;
  let inScopeEmployeeId: string;
  let inScopeEmployeeEmail: string;
  let outOfScopeEmployeeId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Manager Login (Thabo Mokoena - Sandton HQ / Operations)
    const mgrRes = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: 'thabo@timetrack.com', password: 'Password123' },
    });
    expect(mgrRes.status()).toBe(200);
    const mgrData = await mgrRes.json();
    expect(mgrData.user.role).toBe('manager');
    managerToken = mgrData.token;

    // 2. Admin Login (to find out-of-scope employee)
    const adminRes = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: 'admin@timetrack.com', password: 'Password123' },
    });
    expect(adminRes.status()).toBe(200);
    const adminData = await adminRes.json();
    adminToken = adminData.token;

    // Find Pieter (direct report to Thabo)
    const pieterRes = await request.get(`${API_BASE}/api/employees?search=pieter@timetrack.com`, {
      headers: { Authorization: `Bearer ${adminToken}`, ...PERF_BYPASS },
    });
    const pieterEmp = (await pieterRes.json()).items[0];
    inScopeEmployeeId = pieterEmp?.id;
    inScopeEmployeeEmail = pieterEmp?.email;

    // Query all as admin to get out-of-scope ID (e.g. Cape Town)
    const allRes = await request.get(`${API_BASE}/api/employees`, {
      headers: { Authorization: `Bearer ${adminToken}`, ...PERF_BYPASS },
    });
    const allEmps = (await allRes.json()).items;
    const outScopeEmp = allEmps.find((e: any) => e.branch === 'Cape Town' && e.role === 'employee');
    outOfScopeEmployeeId = outScopeEmp?.id;
  });

  const authHeader = () => ({
    Authorization: `Bearer ${managerToken}`,
    ...PERF_BYPASS,
  });

  test('Process 1: Scoped Employee Directory & Masked Salary (GET /api/employees, GET /api/employees/:id)', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/employees`, {
      headers: authHeader(),
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);

    if (inScopeEmployeeId) {
      // Direct lookup masks salaryInfo for manager role
      const singleRes = await request.get(`${API_BASE}/api/employees/${inScopeEmployeeId}`, {
        headers: authHeader(),
      });
      expect(singleRes.status()).toBe(200);
      const empData = await singleRes.json();
      expect(empData.salaryInfo).toBeUndefined();
    }
  });

  test('Process 2: RBAC Scope Enforcement — Reject Out-of-Scope Employee Access (GET /api/employees/:id)', async ({ request }) => {
    if (outOfScopeEmployeeId) {
      const res = await request.get(`${API_BASE}/api/employees/${outOfScopeEmployeeId}`, {
        headers: authHeader(),
      });
      expect([403, 404]).toContain(res.status());
    }
  });

  test('Process 3: Assign Shift to In-Scope Team Member (POST /api/shifts)', async ({ request }) => {
    if (!inScopeEmployeeId) return;
    const testDate = '2026-11-28';

    const res = await request.post(`${API_BASE}/api/shifts`, {
      headers: authHeader(),
      data: {
        employeeId: inScopeEmployeeId,
        date: testDate,
        startTime: '08:00',
        endTime: '17:00',
        shiftType: 'full_day',
        location: 'Sandton HQ',
      },
    });
    expect(res.status()).toBe(201);
    const shift = await res.json();
    expect(shift.id).toBeDefined();

    // Cleanup shift
    await request.delete(`${API_BASE}/api/shifts/${shift.id}`, { headers: authHeader() });
  });

  test('Process 4: Reject Shift Assignment to Out-of-Scope Employee (POST /api/shifts)', async ({ request }) => {
    if (outOfScopeEmployeeId) {
      const res = await request.post(`${API_BASE}/api/shifts`, {
        headers: authHeader(),
        data: {
          employeeId: outOfScopeEmployeeId,
          date: '2026-11-29',
          startTime: '08:00',
          endTime: '17:00',
          shiftType: 'full_day',
        },
      });
      expect([403, 404]).toContain(res.status());
    }
  });

  test('Process 5: Time Entry Oversight & Manual Override for Team Member (POST /time-entries/manual)', async ({ request }) => {
    if (!inScopeEmployeeId) return;

    const res = await request.post(`${API_BASE}/api/time-entries/manual`, {
      headers: authHeader(),
      data: {
        employeeId: inScopeEmployeeId,
        date: '2026-11-12',
        clockIn: '08:00',
        clockOut: '16:30',
        breakMinutes: 30,
      },
    });
    expect(res.status()).toBe(201);
    const entry = await res.json();
    expect(entry.isManualOverride).toBe(true);

    // Cleanup
    await request.delete(`${API_BASE}/api/time-entries/${entry.id}`, { headers: authHeader() });
  });

  test('Process 6: Department Performance & Distribution (GET /api/dashboard/department-performance)', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/dashboard/department-performance`, {
      headers: authHeader(),
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.departments)).toBe(true);
  });

  test('Process 7: Compliance & Mandatory IP Redaction on Audit Queries (GET /api/audit)', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/audit?limit=20`, {
      headers: authHeader(),
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);

    // In manager view, IP addresses MUST be redacted (ends with ...)
    for (const item of data.items) {
      if (item.ipAddress) {
        expect(item.ipAddress).toMatch(/\.\.\.$/);
      }
    }
  });

  test('Process 8: Dashboard KPI Drill-Down with RBAC Scope (GET /api/dashboard/attendance-detail)', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/dashboard/attendance-detail`, {
      headers: authHeader(),
    });
    expect(res.status()).toBe(200);
    const data = await res.json();

    // Response shape
    expect(data.summary).toBeDefined();
    expect(typeof data.summary.totalEmployees).toBe('number');
    expect(typeof data.summary.clockedInNow).toBe('number');
    expect(typeof data.summary.presentTodayCount).toBe('number');
    expect(typeof data.summary.attendanceRate).toBe('number');
    expect(Array.isArray(data.employees)).toBe(true);

    // Row count must match the summary aggregate
    expect(data.employees.length).toBe(data.summary.totalEmployees);

    // Per-row contract
    for (const row of data.employees) {
      expect(['clocked_in', 'not_clocked_in']).toContain(row.status);
      expect(typeof row.presentToday).toBe('boolean');
      expect(typeof row.hoursToday).toBe('number');
      expect(row).toHaveProperty('clockIn');
      expect(row).toHaveProperty('clockOut');
    }

    // Scope enforcement: in-scope employee visible, out-of-scope employee hidden
    const emails = data.employees.map((e: any) => e.email);
    if (inScopeEmployeeEmail) {
      expect(emails).toContain(inScopeEmployeeEmail);
    }
    if (outOfScopeEmployeeId) {
      const adminLookup = await request.get(`${API_BASE}/api/employees`, {
        headers: { Authorization: `Bearer ${adminToken}`, ...PERF_BYPASS },
      });
      const allEmps = (await adminLookup.json()).items;
      const outScopeEmp = allEmps.find((e: any) => e.id === outOfScopeEmployeeId);
      if (outScopeEmp) {
        expect(emails).not.toContain(outScopeEmp.email);
      }
    }
  });
});
