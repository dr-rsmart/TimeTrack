/**
 * GET /reports/attendance-alerts — Shift Presence Rule (route level)
 * ------------------------------------------------------------------
 * Drives the real Express handler with Prisma mocked. Location AND company
 * working hours are configured (08:00–17:00) so a regression back to the old
 * "evaluate every worked day against fallback hours" logic would flag the
 * unscheduled employee as late/early and fail this test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settingsFindFirst: vi.fn(),
  settingsFindMany: vi.fn(),
  employeeFindMany: vi.fn(),
  shiftFindMany: vi.fn(),
  timeEntryFindMany: vi.fn(),
}));

vi.mock('../../server/src/prisma.js', () => ({
  default: {
    companySettings: { findFirst: mocks.settingsFindFirst, findMany: mocks.settingsFindMany },
    employee: { findMany: mocks.employeeFindMany },
    shift: { findMany: mocks.shiftFindMany },
    timeEntry: { findMany: mocks.timeEntryFindMany },
  },
}));
vi.mock('../../server/src/middleware/auth.js', () => ({
  requireAuth: (req: { authUser?: unknown }, _res: unknown, next: () => void) => {
    req.authUser = { id: 'admin-1', role: 'admin', companyProfileId: 'company-1' };
    next();
  },
}));
vi.mock('../../server/src/middleware/scope.js', () => ({
  getManagerScopeFilter: vi.fn(async () => ({})),
}));
vi.mock('../../server/src/routes/payrollExports.js', () => ({
  default: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import reportsRouter from '../../server/src/routes/reports.js';

interface AlertBody {
  alerts: Array<{
    id: string;
    type: string;
    employeeEmail: string;
    minutes?: number;
    message: string;
  }>;
}

const hours = [
  {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    startTime: '08:00',
    endTime: '17:00',
  },
];
const DATE = new Date('2026-09-28T12:00:00.000Z'); // Monday (UTC-noon DATE convention)
const emp = (id: string) => ({
  id,
  firstName: id,
  surname: 'Test',
  email: `${id}@timetrack.co.za`,
  branch: null,
  department: null,
});
const shift = (employeeId: string, extra: Record<string, unknown> = {}) => ({
  id: `shift-${employeeId}`,
  employeeId,
  employeeEmail: `${employeeId}@timetrack.co.za`,
  employeeName: employeeId,
  date: DATE,
  startTime: '08:00',
  endTime: '17:00',
  shiftType: 'full_day',
  status: 'scheduled',
  ...extra,
});
// 09:30 → 15:00 SAST: 90 min late and 120 min early against 08:00–17:00.
const entry = (employeeId: string) => ({
  employeeId,
  employeeEmail: `${employeeId}@timetrack.co.za`,
  date: DATE,
  clockIn: new Date('2026-09-28T07:30:00.000Z'),
  clockOut: new Date('2026-09-28T13:00:00.000Z'),
  status: 'completed',
  companyProfileId: 'company-1',
  geofence: { workingHoursSchedules: hours },
});

async function getAlerts(): Promise<{ status: number; body: AlertBody }> {
  return new Promise((resolve, reject) => {
    const req = {
      method: 'GET',
      url: '/attendance-alerts?days=1',
      query: { days: '1' },
      headers: {},
    };
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: AlertBody) {
        resolve({ status: this.statusCode, body });
        return this;
      },
      setHeader() {},
      getHeader() {},
    };
    const handle = (reportsRouter as unknown as { handle: (...a: unknown[]) => void }).handle;
    handle.call(reportsRouter, req, res, (err?: unknown) =>
      reject(err ?? new Error('route not matched')),
    );
  });
}

describe('GET /reports/attendance-alerts — Shift Presence Rule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T16:00:00.000Z')); // 18:00 SAST, after every shift
    mocks.settingsFindFirst.mockResolvedValue({ lateGraceMinutes: 0 });
    mocks.settingsFindMany.mockResolvedValue([
      { companyProfileId: 'company-1', defaultWorkingHoursSchedules: hours, lateGraceMinutes: 0 },
    ]);
    mocks.employeeFindMany.mockResolvedValue(['sched', 'unsched', 'noshow', 'leave'].map(emp));
    mocks.shiftFindMany.mockResolvedValue([
      shift('sched'),
      shift('noshow', { status: 'no_show' }),
      shift('leave', { shiftType: 'Leave', startTime: null, endTime: null }),
    ]);
    mocks.timeEntryFindMany.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      args.where.isFlaggedDuplicate ? [] : ['sched', 'unsched', 'noshow', 'leave'].map(entry),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flags late/early only for the employee with an assigned working shift', async () => {
    const { status, body } = await getAlerts();
    expect(status).toBe(200);
    const lateEarly = body.alerts.filter(
      (a) => a.type === 'late_clock_in' || a.type === 'early_clock_out',
    );
    expect(lateEarly.map((a) => [a.type, a.employeeEmail, a.minutes])).toEqual([
      ['late_clock_in', 'sched@timetrack.co.za', 90],
      ['early_clock_out', 'sched@timetrack.co.za', 120],
    ]);
    expect(lateEarly[0].message).toContain('(vs scheduled shift 08:00)');
    expect(lateEarly[1].message).toContain('(vs scheduled shift 17:00)');
  });

  it('never flags an unscheduled employee, even when location and company hours exist', async () => {
    const { body } = await getAlerts();
    expect(body.alerts.filter((a) => a.employeeEmail === 'unsched@timetrack.co.za')).toEqual([]);
  });

  it('reports a no-show shift as no_show only, and a leave shift not at all', async () => {
    const { body } = await getAlerts();
    expect(
      body.alerts.filter((a) => a.employeeEmail === 'noshow@timetrack.co.za').map((a) => a.type),
    ).toEqual(['no_show']);
    expect(body.alerts.filter((a) => a.employeeEmail === 'leave@timetrack.co.za')).toEqual([]);
  });
});
