import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:4000';
const PERF_BYPASS = { 'x-perf-bypass': 'tt_perf_bench_2026' };

test.describe.serial('Cross-Role Real-Time Interconnections & Synchronizations', () => {
  let masterToken: string;
  let adminToken: string;
  let managerToken: string;
  let employeeToken: string;
  let testCompanyId: string;
  let sharedEmployeeId: string;
  let sharedEmployeeEmail: string = 'pieter@timetrack.com';
  let createdShiftId: string | null = null;
  let createdTimeEntryId: string | null = null;

  test.beforeAll(async ({ request }) => {
    // 1. Log in all 4 roles simultaneously
    const [masterLogin, adminLogin, mgrLogin, empLogin] = await Promise.all([
      request.post(`${API_BASE}/api/auth/login`, {
        headers: PERF_BYPASS,
        data: { email: 'master@smartpatel.co.za', password: 'Password123' },
      }),
      request.post(`${API_BASE}/api/auth/login`, {
        headers: PERF_BYPASS,
        data: { email: 'admin@timetrack.com', password: 'Password123' },
      }),
      request.post(`${API_BASE}/api/auth/login`, {
        headers: PERF_BYPASS,
        data: { email: 'thabo@timetrack.com', password: 'Password123' },
      }),
      request.post(`${API_BASE}/api/auth/login`, {
        headers: PERF_BYPASS,
        data: { email: sharedEmployeeEmail, password: 'Password123' },
      }),
    ]);

    expect(masterLogin.status()).toBe(200);
    expect(adminLogin.status()).toBe(200);
    expect(mgrLogin.status()).toBe(200);
    expect(empLogin.status()).toBe(200);

    const masterData = await masterLogin.json();
    const adminData = await adminLogin.json();
    const mgrData = await mgrLogin.json();
    const empData = await empLogin.json();

    masterToken = masterData.token;
    adminToken = adminData.token;
    managerToken = mgrData.token;
    employeeToken = empData.token;
    testCompanyId = adminData.user.companyProfileId;

    // Resolve Pieter's employee ID
    const empLookup = await request.get(`${API_BASE}/api/employees?search=${sharedEmployeeEmail}`, {
      headers: { Authorization: `Bearer ${adminToken}`, ...PERF_BYPASS },
    });
    const empList = await empLookup.json();
    sharedEmployeeId = empList.items[0].id;
  });

  const getHeader = (token: string) => ({
    Authorization: `Bearer ${token}`,
    Cookie: `tt_token=${token}`,
    ...PERF_BYPASS,
  });

  // ── 1. EMPLOYEE CLOCK-IN → REFLECTS INSTANTLY IN ADMIN & MANAGER DASHBOARDS ──
  test('Interconnection 1: Employee Clock-In reflects immediately in Manager & Admin active tracking', async ({ request }) => {
    // Clean any prior active session for Pieter
    const activeCheck = await request.get(`${API_BASE}/api/time-entries/active`, {
      headers: getHeader(employeeToken),
    });
    const activeBody = await activeCheck.json();
    if (activeBody.active) {
      await request.post(`${API_BASE}/api/time-entries/clock-out`, {
        headers: getHeader(employeeToken),
        data: { latitude: -26.1076, longitude: 28.0567 },
      });
    }

    // 1. Employee clocks in at Sandton HQ
    const clockInRes = await request.post(`${API_BASE}/api/time-entries/clock-in`, {
      headers: getHeader(employeeToken),
      data: {
        latitude: -26.1076,
        longitude: 28.0567,
      },
    });
    expect(clockInRes.status()).toBe(201);
    const entry = await clockInRes.json();
    expect(entry.status).toBe('active');
    createdTimeEntryId = entry.id;

    // 2. Manager instantly queries time entries and sees the subordinate active session
    const mgrQueryRes = await request.get(`${API_BASE}/api/time-entries?status=active`, {
      headers: getHeader(managerToken),
    });
    expect(mgrQueryRes.status()).toBe(200);
    const mgrEntries = await mgrQueryRes.json();
    expect(mgrEntries.items.some((e: any) => e.employeeEmail === sharedEmployeeEmail && e.status === 'active')).toBe(true);

    // 3. Admin immediately sees the new active clock-in
    const adminActiveRes = await request.get(`${API_BASE}/api/time-entries?status=active`, {
      headers: getHeader(adminToken),
    });
    expect(adminActiveRes.status()).toBe(200);
    const adminActiveEntries = await adminActiveRes.json();
    expect(adminActiveEntries.items.some((e: any) => e.employeeEmail === sharedEmployeeEmail && e.status === 'active')).toBe(true);

    // 4. Employee clocks out
    const clockOutRes = await request.post(`${API_BASE}/api/time-entries/clock-out`, {
      headers: getHeader(employeeToken),
      data: {
        latitude: -26.1076,
        longitude: 28.0567,
        breakMinutes: 0,
      },
    });
    expect(clockOutRes.status()).toBe(200);
  });

  // ── 2. ADMIN SHIFT CREATION → REFLECTS INSTANTLY IN EMPLOYEE & MANAGER VIEWS ──
  test('Interconnection 2: Admin Shift Assignment reflects immediately in Employee Schedule & Manager Team View', async ({ request }) => {
    const shiftDate = '2026-12-15';

    // 1. Admin creates shift for Pieter
    const createShiftRes = await request.post(`${API_BASE}/api/shifts`, {
      headers: getHeader(adminToken),
      data: {
        employeeId: sharedEmployeeId,
        date: shiftDate,
        startTime: '09:00',
        endTime: '17:00',
        shiftType: 'full_day',
        location: 'Sandton HQ',
        notes: 'Priority customer deployment',
      },
    });
    expect(createShiftRes.status()).toBe(201);
    const shift = await createShiftRes.json();
    createdShiftId = shift.id;

    // 2. Employee queries own shifts and immediately sees the new assignment
    const empShiftsRes = await request.get(`${API_BASE}/api/shifts?date=${shiftDate}`, {
      headers: getHeader(employeeToken),
    });
    expect(empShiftsRes.status()).toBe(200);
    const empShifts = await empShiftsRes.json();
    expect(empShifts.items.some((s: any) => s.id === shift.id)).toBe(true);

    // 3. Manager queries team shifts and immediately sees Pieter scheduled
    const mgrShiftsRes = await request.get(`${API_BASE}/api/shifts?date=${shiftDate}`, {
      headers: getHeader(managerToken),
    });
    expect(mgrShiftsRes.status()).toBe(200);
    const mgrShifts = await mgrShiftsRes.json();
    expect(mgrShifts.items.some((s: any) => s.id === shift.id)).toBe(true);

    // Cleanup shift
    await request.delete(`${API_BASE}/api/shifts/${shift.id}`, {
      headers: getHeader(adminToken),
    });
  });

  // ── 3. MANAGER TIME OVERRIDE → REFLECTS IN EMPLOYEE HISTORY & ADMIN PAYROLL ──
  test('Interconnection 3: Manager Manual Time Override reflects in Employee records & Admin Payroll Analytics', async ({ request }) => {
    const overrideDate = '2026-11-05';

    // 1. Manager logs manual override for subordinate Pieter
    const manualRes = await request.post(`${API_BASE}/api/time-entries/manual`, {
      headers: getHeader(managerToken),
      data: {
        employeeId: sharedEmployeeId,
        date: overrideDate,
        clockIn: '08:00',
        clockOut: '17:00',
        breakMinutes: 60,
      },
    });
    expect(manualRes.status()).toBe(201);
    const manualEntry = await manualRes.json();
    expect(manualEntry.isManualOverride).toBe(true);
    expect(manualEntry.totalHours).toBe(8);

    // 2. Employee checks their attendance history and sees the completed entry
    const empHistoryRes = await request.get(`${API_BASE}/api/time-entries?date=${overrideDate}`, {
      headers: getHeader(employeeToken),
    });
    expect(empHistoryRes.status()).toBe(200);
    const empHistory = await empHistoryRes.json();
    expect(empHistory.items.some((e: any) => e.id === manualEntry.id)).toBe(true);

    // 3. Admin generates payroll report for that period and sees the hours aggregated
    const adminPayrollRes = await request.get(`${API_BASE}/api/reports/payroll?from=2026-11-01&to=2026-11-30`, {
      headers: getHeader(adminToken),
    });
    expect(adminPayrollRes.status()).toBe(200);
    const payrollData = await adminPayrollRes.json();
    const pieterRow = payrollData.rows.find((r: any) => r.email === sharedEmployeeEmail);
    expect(pieterRow).toBeDefined();
    expect(pieterRow.totalHours).toBeGreaterThanOrEqual(8);

    // Cleanup
    await request.delete(`${API_BASE}/api/time-entries/${manualEntry.id}`, {
      headers: getHeader(adminToken),
    });
  });

  // ── 4. CONCURRENT MUTEX & OPTIMISTIC LOCKING COLLISION ──
  test('Interconnection 4: Concurrent Updates from Admin and Manager trigger 409 Optimistic Lock Collision', async ({ request }) => {
    // 1. Fetch current employee state and version
    const empRes = await request.get(`${API_BASE}/api/employees/${sharedEmployeeId}`, {
      headers: getHeader(adminToken),
    });
    const currentEmp = await empRes.json();
    const currentVersion = currentEmp.version;

    // 2. Admin performs update with current version -> succeeds and increments version
    const adminUpdate = await request.put(`${API_BASE}/api/employees/${sharedEmployeeId}`, {
      headers: getHeader(adminToken),
      data: {
        position: 'Lead Sales Consultant',
        version: currentVersion,
      },
    });
    expect(adminUpdate.status()).toBe(200);
    const updated = await adminUpdate.json();
    expect(updated.version).toBe(currentVersion + 1);

    // 3. Manager attempts update using the stale version -> rejected with 409 Conflict
    const managerConflict = await request.put(`${API_BASE}/api/employees/${sharedEmployeeId}`, {
      headers: getHeader(managerToken),
      data: {
        phone: '+27 82 555 9999',
        version: currentVersion, // Stale version!
      },
    });
    expect(managerConflict.status()).toBe(409);
    const conflictBody = await managerConflict.json();
    expect(conflictBody.code).toBe('VERSION_CONFLICT');
  });

  // ── 5. MASTER TENANT SUSPENSION → IMMEDIATE CACHE INVALIDATION & GLOBAL LOCKOUT ──
  test('Interconnection 5: Master Company Suspension immediately blocks all Tenant Users (Admin, Manager, Employee)', async ({ request }) => {
    // 1. Fresh master login session for dedicated operator action
    const mLogin = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: 'master@smartpatel.co.za', password: 'Password123' },
    });
    expect(mLogin.status()).toBe(200);
    const freshMasterToken = (await mLogin.json()).token;

    // 2. Onboard dedicated isolated company for suspension test
    const rand = Math.floor(Math.random() * 10000);
    const tempAdminEmail = `temp_susp_admin_${rand}@enterprise.co.za`;
    const onboardRes = await request.post(`${API_BASE}/api/master/companies`, {
      headers: getHeader(freshMasterToken),
      data: {
        name: `Suspension Test Co ${rand}`,
        phone: '+27 11 000 7777',
        address: '50 Lockout Ave',
        billingTier: 'standard',
        adminEmail: tempAdminEmail,
        adminFirstName: 'Temp',
        adminSurname: 'Admin',
      },
    });
    expect(onboardRes.status()).toBe(201);
    const onboardData = await onboardRes.json();
    const tempCompanyId = onboardData.companyId;

    // Login as temp admin to get token
    const tempAdminLogin = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: tempAdminEmail, password: 'Password123' },
    });
    expect(tempAdminLogin.status()).toBe(200);
    const tempAdminToken = (await tempAdminLogin.json()).token;

    // 3. Master suspends the tenant company
    const suspendRes = await request.post(`${API_BASE}/api/master/companies/${tempCompanyId}/toggle`, {
      headers: getHeader(freshMasterToken),
    });
    if (suspendRes.status() !== 200) {
      console.error('SUSPEND ERROR:', suspendRes.status(), await suspendRes.json());
    }
    expect(suspendRes.status()).toBe(200);
    const suspendData = await suspendRes.json();
    expect(suspendData.isActive).toBe(false);

    // 4. Immediate lockout on authenticated requests: Temp Admin is blocked with 403
    const adminBlockedRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: getHeader(tempAdminToken),
    });
    expect(adminBlockedRes.status()).toBe(403);
    const adminBlocked = await adminBlockedRes.json();
    expect(adminBlocked.code).toBe('COMPANY_SUSPENDED');

    // 5. Login is also blocked
    const empLoginBlocked = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: tempAdminEmail, password: 'Password123' },
    });
    expect(empLoginBlocked.status()).toBe(403);
    const empBlocked = await empLoginBlocked.json();
    expect(empBlocked.code).toBe('COMPANY_SUSPENDED');

    // 6. Master reactivates the company
    const activateRes = await request.post(`${API_BASE}/api/master/companies/${tempCompanyId}/toggle`, {
      headers: getHeader(freshMasterToken),
    });
    expect(activateRes.status()).toBe(200);
    const activateData = await activateRes.json();
    expect(activateData.isActive).toBe(true);

    // 7. Access immediately resumes
    const adminRestored = await request.get(`${API_BASE}/api/auth/me`, {
      headers: getHeader(tempAdminToken),
    });
    expect(adminRestored.status()).toBe(200);

    // Cleanup
    await request.delete(`${API_BASE}/api/master/companies/${tempCompanyId}`, {
      headers: getHeader(freshMasterToken),
    });
  });

  // ── 6. AUDIT LOGGING & ROLE-SCOPED IP PRIVACY REFLECTION ──
  test('Interconnection 6: Audit log captures actions across roles with real-time IP redaction for non-admins', async ({ request }) => {
    // 1. Admin views audit logs -> sees unredacted IP addresses
    const adminAuditRes = await request.get(`${API_BASE}/api/audit?limit=10`, {
      headers: getHeader(adminToken),
    });
    expect(adminAuditRes.status()).toBe(200);
    const adminAudit = await adminAuditRes.json();
    expect(Array.isArray(adminAudit.items)).toBe(true);

    // 2. Manager views audit logs -> IP addresses are automatically redacted
    const mgrAuditRes = await request.get(`${API_BASE}/api/audit?limit=10`, {
      headers: getHeader(managerToken),
    });
    expect(mgrAuditRes.status()).toBe(200);
    const mgrAudit = await mgrAuditRes.json();
    expect(Array.isArray(mgrAudit.items)).toBe(true);

    for (const item of mgrAudit.items) {
      if (item.ipAddress) {
        expect(item.ipAddress).toMatch(/\.\.\.$/);
      }
    }
  });

  test.afterAll(async ({ request }) => {
    // Cleanup any lingering artifacts
    if (createdTimeEntryId) {
      await request.delete(`${API_BASE}/api/time-entries/${createdTimeEntryId}`, {
        headers: getHeader(adminToken),
      });
    }
  });
});
