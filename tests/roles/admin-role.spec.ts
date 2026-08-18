import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:4000';
const PERF_BYPASS = { 'x-perf-bypass': 'tt_perf_bench_2026' };

test.describe.serial('Admin Role (Company Administrator) — Process Test Pack', () => {
  let adminToken: string;
  let createdEmployeeId: string;
  let testEmployeeEmail: string;
  let createdShiftId: string;
  let createdGeofenceId: string;
  let createdPresetId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Authentication
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: {
        email: 'admin@timetrack.com',
        password: 'Password123',
      },
    });
    expect(loginRes.status()).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.user.role).toBe('admin');
    adminToken = loginData.token;
  });

  const authHeader = () => ({
    Authorization: `Bearer ${adminToken}`,
    ...PERF_BYPASS,
  });

  // ── 1. EMPLOYEE MANAGEMENT PROCESSES ──
  test('Process 1: Create Employee with Auto-provisioned Login (POST /api/employees)', async ({ request }) => {
    const rand = Math.floor(Math.random() * 10000);
    testEmployeeEmail = `test_emp_${rand}@timetrack.com`;

    const res = await request.post(`${API_BASE}/api/employees`, {
      headers: authHeader(),
      data: {
        firstName: 'Test',
        surname: `Worker ${rand}`,
        email: testEmployeeEmail,
        position: 'Logistics Specialist',
        role: 'employee',
        branch: 'Sandton HQ',
        department: 'Operations',
      },
    });
    expect(res.status()).toBe(201);
    const emp = await res.json();
    expect(emp.id).toBeDefined();
    expect(emp.email).toBe(testEmployeeEmail);
    expect(emp.version).toBe(1);
    createdEmployeeId = emp.id;
  });

  test('Process 2: List Manager Assignment Options (GET /api/employees/managers)', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/employees/managers`, {
      headers: authHeader(),
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.managers)).toBe(true);
    expect(data.managers.length).toBeGreaterThanOrEqual(1);
  });

  test('Process 3: Update Employee & Enforce Optimistic Locking (PUT /api/employees/:id)', async ({ request }) => {
    expect(createdEmployeeId).toBeDefined();

    // Valid update
    const updateRes = await request.put(`${API_BASE}/api/employees/${createdEmployeeId}`, {
      headers: authHeader(),
      data: {
        position: 'Senior Logistics Specialist',
        version: 1,
      },
    });
    expect(updateRes.status()).toBe(200);
    const updatedEmp = await updateRes.json();
    expect(updatedEmp.position).toBe('Senior Logistics Specialist');
    expect(updatedEmp.version).toBe(2);

    // Stale version update conflict (optimistic lock rejection)
    const conflictRes = await request.put(`${API_BASE}/api/employees/${createdEmployeeId}`, {
      headers: authHeader(),
      data: {
        position: 'Outdated Attempt',
        version: 1, // Stale version
      },
    });
    expect(conflictRes.status()).toBe(409);
  });

  test('Process 4: Terminate Employee (Soft Delete) & Reactivate (DELETE & POST /reset-password)', async ({ request }) => {
    expect(createdEmployeeId).toBeDefined();

    // Terminate (soft delete)
    const delRes = await request.delete(`${API_BASE}/api/employees/${createdEmployeeId}`, {
      headers: authHeader(),
    });
    expect(delRes.status()).toBe(200);
    const delData = await delRes.json();
    expect(delData.softDelete).toBe(true);

    // Verify terminated employee cannot log in
    const blockedLogin = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: testEmployeeEmail, password: 'Password123' },
    });
    expect(blockedLogin.status()).toBe(403);
    const blockedData = await blockedLogin.json();
    expect(blockedData.code).toBe('EMPLOYEE_TERMINATED');

    // Admin resets password -> reactivates employee
    const resetRes = await request.post(`${API_BASE}/api/employees/${createdEmployeeId}/reset-password`, {
      headers: authHeader(),
    });
    expect(resetRes.status()).toBe(200);
    const resetData = await resetRes.json();
    expect(resetData.success).toBe(true);

    // Verify employee can log in again
    const restoredLogin = await request.post(`${API_BASE}/api/auth/login`, {
      headers: PERF_BYPASS,
      data: { email: testEmployeeEmail, password: 'Password123' },
    });
    expect(restoredLogin.status()).toBe(200);
  });

  // ── 2. SCHEDULING & SHIFT PROCESSES ──
  test('Process 5: Schedule Shift & Reject Overlapping Schedule (POST /api/shifts)', async ({ request }) => {
    expect(createdEmployeeId).toBeDefined();
    const testDate = '2026-11-20';

    // 1. Create shift
    const createRes = await request.post(`${API_BASE}/api/shifts`, {
      headers: authHeader(),
      data: {
        employeeId: createdEmployeeId,
        date: testDate,
        startTime: '08:00',
        endTime: '16:00',
        shiftType: 'full_day',
        location: 'Sandton HQ',
      },
    });
    expect(createRes.status()).toBe(201);
    const shift = await createRes.json();
    expect(shift.id).toBeDefined();
    createdShiftId = shift.id;

    // 2. Attempt overlapping shift (same employee & overlapping time)
    const overlapRes = await request.post(`${API_BASE}/api/shifts`, {
      headers: authHeader(),
      data: {
        employeeId: createdEmployeeId,
        date: testDate,
        startTime: '12:00',
        endTime: '18:00',
        shiftType: 'full_day',
      },
    });
    expect(overlapRes.status()).toBe(409);
    const overlapData = await overlapRes.json();
    expect(overlapData.error).toContain('overlap');
  });

  test('Process 6: Bulk Shift Assignment (POST /api/shifts/bulk)', async ({ request }) => {
    expect(createdEmployeeId).toBeDefined();
    const bulkDate = '2026-11-25';

    const bulkRes = await request.post(`${API_BASE}/api/shifts/bulk`, {
      headers: authHeader(),
      data: {
        employeeIds: [createdEmployeeId],
        date: bulkDate,
        startTime: '09:00',
        endTime: '17:00',
        shiftType: 'full_day',
        location: 'Sandton HQ',
      },
    });
    expect(bulkRes.status()).toBe(201);
    const bulkData = await bulkRes.json();
    expect(bulkData.created).toBe(1);
    expect(bulkData.shiftIds.length).toBe(1);
  });

  test('Process 7: Update Shift Status with Reason Requirement (PUT & DELETE /api/shifts/:id)', async ({ request }) => {
    expect(createdShiftId).toBeDefined();

    // Cancelling without reason must fail
    const failRes = await request.put(`${API_BASE}/api/shifts/${createdShiftId}`, {
      headers: authHeader(),
      data: { status: 'cancelled' },
    });
    expect(failRes.status()).toBe(400);

    // Cancelling with reason must succeed
    const okRes = await request.put(`${API_BASE}/api/shifts/${createdShiftId}`, {
      headers: authHeader(),
      data: {
        status: 'cancelled',
        notes: 'Operational schedule adjustment by administrator',
      },
    });
    expect(okRes.status()).toBe(200);
    const updated = await okRes.json();
    expect(updated.status).toBe('cancelled');

    // Delete shift
    const delRes = await request.delete(`${API_BASE}/api/shifts/${createdShiftId}`, {
      headers: authHeader(),
    });
    expect(delRes.status()).toBe(200);
  });

  // ── 3. TIME ENTRY OVERSIGHT & MANUAL OVERRIDES ──
  test('Process 8: Create Manual Time Entry with Audit Trail (POST /api/time-entries/manual)', async ({ request }) => {
    expect(createdEmployeeId).toBeDefined();
    const res = await request.post(`${API_BASE}/api/time-entries/manual`, {
      headers: authHeader(),
      data: {
        employeeId: createdEmployeeId,
        date: '2026-11-10',
        clockIn: '08:30',
        clockOut: '17:00',
        breakMinutes: 30,
      },
    });
    expect(res.status()).toBe(201);
    const entry = await res.json();
    expect(entry.isManualOverride).toBe(true);
    expect(entry.totalHours).toBe(8);

    // Cleanup entry
    await request.delete(`${API_BASE}/api/time-entries/${entry.id}`, {
      headers: authHeader(),
    });
  });

  test('Process 9: Proxy Clock-in & Force Clock-out for Subordinate (POST /clock-in, /clock-out)', async ({ request }) => {
    expect(testEmployeeEmail).toBeDefined();

    // Proxy clock-in by admin
    const clockInRes = await request.post(`${API_BASE}/api/time-entries/clock-in`, {
      headers: authHeader(),
      data: {
        employee_email: testEmployeeEmail,
        justification: 'Admin proxy punch — staff phone unavailable',
      },
    });
    expect(clockInRes.status()).toBe(201);
    const inEntry = await clockInRes.json();
    expect(inEntry.status).toBe('active');
    expect(inEntry.isManualOverride).toBe(true);

    // Force clock-out by admin
    const clockOutRes = await request.post(`${API_BASE}/api/time-entries/clock-out`, {
      headers: authHeader(),
      data: {
        employee_email: testEmployeeEmail,
        breakMinutes: 15,
      },
    });
    expect(clockOutRes.status()).toBe(200);
    const outEntry = await clockOutRes.json();
    expect(outEntry.status).toBe('completed');

    // Cleanup
    await request.delete(`${API_BASE}/api/time-entries/${outEntry.id}`, {
      headers: authHeader(),
    });
  });

  // ── 4. CONFIGURATION & GEOFENCES ──
  test('Process 10: Manage Company Settings & Geofences (PUT /settings, POST /geofences, /presets)', async ({ request }) => {
    // 1. Update company payroll rules
    const setRes = await request.put(`${API_BASE}/api/settings/settings`, {
      headers: authHeader(),
      data: {
        ordinaryHoursPerDay: 8,
        overtimeThresholdHours: 8,
        sundayOvertimeMultiplier: 1.5,
        publicHolidayOvertimeMultiplier: 2.0,
      },
    });
    expect(setRes.status()).toBe(200);

    // 2. Create Geofence
    const gfRes = await request.post(`${API_BASE}/api/settings/geofences`, {
      headers: authHeader(),
      data: {
        name: 'Sandton Annex Worksite',
        address: '15 Rivonia Rd, Sandton',
        latitude: -26.1080,
        longitude: 28.0570,
        radiusMeters: 350,
      },
    });
    expect(gfRes.status()).toBe(201);
    const gfData = await gfRes.json();
    createdGeofenceId = gfData.geofence.id;

    // 3. Assign employee to geofence
    const assignRes = await request.post(`${API_BASE}/api/settings/geofences/${createdGeofenceId}/assign-employees`, {
      headers: authHeader(),
      data: { employeeIds: [createdEmployeeId] },
    });
    expect(assignRes.status()).toBe(200);

    // 4. Create Location Preset
    const presetRes = await request.post(`${API_BASE}/api/settings/location-presets`, {
      headers: authHeader(),
      data: {
        name: 'Client Office Preset',
        latitude: -26.1090,
        longitude: 28.0580,
        radiusMeters: 200,
      },
    });
    expect(presetRes.status()).toBe(201);
    const presetData = await presetRes.json();
    createdPresetId = presetData.preset.id;
  });

  // ── 5. REPORTING & ANALYTICS ──
  test('Process 11: Generate Payroll and Attendance Reports (GET /api/reports/payroll, /attendance)', async ({ request }) => {
    // Payroll report
    const payRes = await request.get(`${API_BASE}/api/reports/payroll?from=2026-08-01&to=2026-08-31`, {
      headers: authHeader(),
    });
    expect(payRes.status()).toBe(200);
    const payData = await payRes.json();
    expect(Array.isArray(payData.rows)).toBe(true);
    expect(payData.settings).toBeDefined();

    // Attendance report
    const attRes = await request.get(`${API_BASE}/api/reports/attendance?from=2026-08-01&to=2026-08-31`, {
      headers: authHeader(),
    });
    expect(attRes.status()).toBe(200);
    const attData = await attRes.json();
    expect(Array.isArray(attData.entries)).toBe(true);
  });

  test('Process 12: View Multi-Tenant Dashboard KPIs and Overtime Forecasts (GET /api/dashboard/*)', async ({ request }) => {
    const [summaryRes, trendRes, deptRes, alertsRes, forecastRes] = await Promise.all([
      request.get(`${API_BASE}/api/dashboard/summary`, { headers: authHeader() }),
      request.get(`${API_BASE}/api/dashboard/hours-trend?days=14`, { headers: authHeader() }),
      request.get(`${API_BASE}/api/dashboard/department-performance`, { headers: authHeader() }),
      request.get(`${API_BASE}/api/dashboard/overtime-alerts?days=14`, { headers: authHeader() }),
      request.get(`${API_BASE}/api/dashboard/overtime-forecast`, { headers: authHeader() }),
    ]);

    expect(summaryRes.status()).toBe(200);
    expect(trendRes.status()).toBe(200);
    expect(deptRes.status()).toBe(200);
    expect(alertsRes.status()).toBe(200);
    expect(forecastRes.status()).toBe(200);
  });

  test.afterAll(async ({ request }) => {
    // Cleanup created geofence, preset, and employee
    if (createdGeofenceId) {
      await request.delete(`${API_BASE}/api/settings/geofences/${createdGeofenceId}`, { headers: authHeader() });
    }
    if (createdPresetId) {
      await request.delete(`${API_BASE}/api/settings/location-presets/${createdPresetId}`, { headers: authHeader() });
    }
  });
});
