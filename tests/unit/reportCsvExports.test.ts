import { describe, expect, it } from 'vitest';
import {
  buildBreakdownCsv,
  buildCostCsv,
  buildDailyTotalsCsv,
  buildEntriesCsv,
  getEmployeeDayKey,
} from '../../src/utils/reportCsvExports';
import {
  PAYROLL_EXPORT_FORMATS,
  componentHoursFormat,
  getPayrollExportFormat,
} from '../../src/utils/payrollExportFormats';
import type { TimeEntry } from '../../contracts/index.js';
import type { AttendanceCostRow, PayrollRow } from '../../src/services/api';

function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'e1',
    employeeId: 'emp1',
    employeeEmail: 'jane@example.com',
    employeeName: 'Jane Doe',
    branch: 'Cape Town',
    department: 'Sales',
    clockIn: '2026-09-25T06:00:00.000Z',
    clockOut: '2026-09-25T14:00:00.000Z',
    date: '2026-09-25',
    totalHours: 8,
    status: 'completed',
    breakMinutes: 30,
    isManualOverride: false,
    isManuallyAdjusted: false,
    adjustedByName: null,
    adjustmentReason: null,
    geofenceName: 'Sitari Estate',
    ...overrides,
  };
}

function costRow(overrides: Partial<AttendanceCostRow> = {}): AttendanceCostRow {
  return {
    employeeId: 'emp1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    branch: 'Cape Town',
    department: 'Sales',
    position: 'Rep',
    employeeNumber: 'EMP001',
    hourlyRate: 50,
    latePenaltyRate: 75,
    lateMinutes: 15,
    earlyMinutes: 15,
    totalLostMinutes: 30,
    hoursLost: 0.5,
    randLost: 37.5,
    days: [],
    ...overrides,
  };
}

function payrollRow(overrides: Partial<PayrollRow> = {}): PayrollRow {
  return {
    employeeId: 'emp1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    branch: 'Cape Town',
    department: 'Sales',
    position: 'Rep',
    employeeNumber: 'EMP001',
    hourlyRate: 50,
    daysWorked: 21,
    ordinaryHours: 160,
    dailyOvertimeHours: 5,
    sundayOvertimeHours: 4,
    saturdayOvertimeHours: 3,
    holidayOvertimeHours: 8,
    monthlyOvertimeHours: 2,
    totalOvertimeHours: 22,
    sundayWeightedOvertime: 6,
    saturdayWeightedOvertime: 4.5,
    holidayWeightedOvertime: 16,
    totalWeightedOvertime: 26.5,
    totalHours: 182,
    ...overrides,
  };
}

describe('getEmployeeDayKey', () => {
  it('prefers the employee id, falling back to a lowercased email', () => {
    expect(getEmployeeDayKey(entry())).toBe('emp1|2026-09-25');
    const noId = entry({ employeeId: null, employeeEmail: 'Jane.Doe@Example.COM' });
    expect(getEmployeeDayKey(noId)).toBe('jane.doe@example.com|2026-09-25');
  });

  it('slices the date to YYYY-MM-DD even when a timestamp is present', () => {
    expect(getEmployeeDayKey(entry({ date: '2026-09-25T06:00:00.000Z' }))).toBe('emp1|2026-09-25');
  });
});
describe('buildEntriesCsv', () => {
  const headers = [
    'Employee Number',
    'Employee',
    'Position',
    'Email',
    'Branch',
    'Geofence Location',
    'Department',
    'Date',
    'Clock In',
    'Clock Out',
    'Break (min)',
    'Entry Hours',
    'Day Total Hours',
    'Status',
    'Manual Override',
  ];

  it('emits the exact payroll-import header order', () => {
    const out = buildEntriesCsv({
      timeEntries: [entry()],
      from: '2026-09-01',
      to: '2026-09-30',
      employeeInfoByEmail: new Map(),
      employeeDayTotals: new Map(),
    });
    expect(out.headers).toEqual(headers);
  });

  it('maps every entry to one row and resolves the per-day total via the day key', () => {
    const e = entry();
    const out = buildEntriesCsv({
      timeEntries: [e],
      from: '2026-09-01',
      to: '2026-09-30',
      employeeInfoByEmail: new Map([
        ['jane@example.com', { employeeNumber: 'EMP001', position: 'Rep' }],
      ]),
      employeeDayTotals: new Map([[getEmployeeDayKey(e), 8.5]]),
    });
    expect(out.data).toHaveLength(1);
    const row = out.data[0];
    expect(row[0]).toBe('EMP001');
    expect(row[1]).toBe('Jane Doe');
    expect(row[2]).toBe('Rep');
    expect(row[3]).toBe('jane@example.com');
    expect(row[4]).toBe('Cape Town');
    expect(row[5]).toBe('Sitari Estate');
    expect(row[6]).toBe('Sales');
    expect(String(row[7])).not.toBe('—');
    expect(String(row[8])).not.toBe('—');
    expect(String(row[9])).not.toBe('');
    expect(row[10]).toBe(30);
    expect(row[11]).toBe(8);
    expect(row[12]).toBe(8.5);
    expect(row[13]).toBe('completed');
    expect(row[14]).toBe('No');
  });

  it('renders blank strings for a missing employee directory entry and missing clock-out', () => {
    const out = buildEntriesCsv({
      timeEntries: [entry({ clockOut: null, isManualOverride: true })],
      from: '2026-09-01',
      to: '2026-09-30',
      employeeInfoByEmail: new Map(),
      employeeDayTotals: new Map(),
    });
    const row = out.data[0];
    expect(row[0]).toBe('');
    expect(row[2]).toBe('');
    expect(row[9]).toBe('');
    expect(row[14]).toBe('Yes');
  });

  it('builds the period-scoped filename', () => {
    const out = buildEntriesCsv({
      timeEntries: [],
      from: '2026-09-01',
      to: '2026-09-30',
      employeeInfoByEmail: new Map(),
      employeeDayTotals: new Map(),
    });
    expect(out.filename).toBe('time-entries-2026-09-01-to-2026-09-30.csv');
  });
});

describe('buildBreakdownCsv', () => {
  it('emits the exact header order and a per-employee Breakdown line', () => {
    const e = entry();
    const out = buildBreakdownCsv({
      breakdownByEmployee: [
        { row: { name: 'Jane Doe' }, dayEntries: [e], normal: 195, overtime: 20, publicHoliday: 9 },
      ],
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(out.headers).toEqual([
      'Employee',
      'Date',
      'Clock In',
      'Clock Out',
      'Day Hours',
      'Normal Hours',
      'Overtime Hours',
      'Public Holiday Hours',
    ]);
    expect(out.data).toHaveLength(2);
    expect(out.data[0][0]).toBe('Jane Doe');
    expect(out.data[0][4]).toBe(8);
    expect(out.data[1]).toEqual(['Jane Doe', 'Breakdown', '', '', '', 195, 20, 9]);
    expect(out.filename).toBe('daily-breakdown-2026-09-01-to-2026-09-30.csv');
  });

  it('populates per-day Normal/Overtime/PH cells that reconcile to period totals', () => {
    const days = [
      entry({ id: 'd1', date: '2026-09-01', totalHours: 10 }),
      entry({ id: 'd2', date: '2026-09-02', totalHours: 8 }),
      entry({ id: 'd3', date: '2026-09-03', totalHours: 6 }),
    ];
    const out = buildBreakdownCsv({
      breakdownByEmployee: [
        { row: { name: 'Jane Doe' }, dayEntries: days, normal: 16, overtime: 5, publicHoliday: 3 },
      ],
      from: '2026-09-01',
      to: '2026-09-30',
    });

    const dayRows = out.data.slice(0, 3);
    // No blank cells any more - blanks were what forced manual payroll work.
    for (const row of dayRows) {
      expect(typeof row[5]).toBe('number');
      expect(typeof row[6]).toBe('number');
      expect(typeof row[7]).toBe('number');
    }

    const sumColumn = (i: number) => dayRows.reduce((acc, r) => acc + (r[i] as number), 0);
    // Each column reconciles EXACTLY to the payroll engine period total.
    expect(sumColumn(5)).toBeCloseTo(16, 2);
    expect(sumColumn(6)).toBeCloseTo(5, 2);
    expect(sumColumn(7)).toBeCloseTo(3, 2);

    // No day may be allocated more hours than it actually worked.
    dayRows.forEach((r, i) => {
      const allocated = (r[5] as number) + (r[6] as number) + (r[7] as number);
      expect(allocated).toBeLessThanOrEqual((days[i].totalHours as number) + 0.001);
    });
  });

  it('emits only the Breakdown line when an employee has no day entries', () => {
    const out = buildBreakdownCsv({
      breakdownByEmployee: [
        { row: { name: 'Ghost' }, dayEntries: [], normal: 100, overtime: 10, publicHoliday: 5 },
      ],
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(out.data).toHaveLength(1);
    expect(out.data[0][1]).toBe('Breakdown');
  });
});

describe('buildDailyTotalsCsv', () => {
  it('emits the exact headers and one row per day', () => {
    const out = buildDailyTotalsCsv({
      dailyTotals: [
        { date: '2026-09-01', employees: 3, entries: 5, hours: 24 },
        { date: '2026-09-02', employees: 2, entries: 3, hours: 16 },
      ],
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(out.headers).toEqual(['Date', 'Employees', 'Entries', 'Total Hours']);
    expect(out.data).toHaveLength(2);
    expect(out.data[0]).toHaveLength(4);
    expect(out.data[0][1]).toBe(3);
    expect(out.data[1][3]).toBe(16);
    expect(out.filename).toBe('grouped-daily-totals-2026-09-01-to-2026-09-30.csv');
  });
});

describe('buildCostCsv', () => {
  const headers = [
    'Employee Number',
    'Employee',
    'Email',
    'Branch',
    'Department',
    'Penalty Rate (ZAR)',
    'Late Minutes',
    'Early Minutes',
    'Hours Lost',
    'Rand Lost (ZAR)',
  ];

  it('emits the exact header order and a trailing TOTALS row', () => {
    const out = buildCostCsv({
      costRows: [costRow()],
      costTotals: { lateMinutes: 15, earlyMinutes: 15, hoursLost: 0.5, randLost: 37.5 },
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(out.headers).toEqual(headers);
    expect(out.data).toHaveLength(2);
    expect(out.data[0]).toEqual([
      'EMP001',
      'Jane Doe',
      'jane@example.com',
      'Cape Town',
      'Sales',
      75,
      15,
      15,
      0.5,
      37.5,
    ]);
    expect(out.data[1]).toEqual(['', 'TOTALS', '', '', '', '', 15, 15, 0.5, 37.5]);
    expect(out.filename).toBe('cost-of-late-2026-09-01-to-2026-09-30.csv');
  });

  it('falls back to an empty cell when the penalty rate is null', () => {
    const out = buildCostCsv({
      costRows: [costRow({ latePenaltyRate: null })],
      costTotals: { lateMinutes: 0, earlyMinutes: 0, hoursLost: 0, randLost: 0 },
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(out.data[0][5]).toBe('');
  });
});

describe('componentHoursFormat (payroll component-row import)', () => {
  const ctx = { from: '2026-09-01', to: '2026-09-30', geofenceLocationsByEmail: new Map() };

  it('exports the component header set including the payroll-side columns', () => {
    expect(componentHoursFormat.headers()).toEqual([
      'Employee Number',
      'Component Code Or Description',
      'Input Type',
      'Input Value',
      'Cost Centre Code',
      'Project Code',
      'Activity Code',
      'Closing recovery amount',
      'Comments',
      'Add or Overwrite',
    ]);
  });

  it('emits one row per employee PER component, grouped by component', () => {
    const a = payrollRow({ employeeNumber: 'CBE-012' });
    const b = payrollRow({ employeeNumber: 'CBE-015' });
    const rows = componentHoursFormat.rows([a, b], ctx);

    // 2 employees x 3 components
    expect(rows).toHaveLength(6);
    expect(rows[0][1]).toBe('Basic Pay');
    expect(rows[1][1]).toBe('Basic Pay');
    expect(rows[2][1]).toBe('Overtime @ 1.5');
    expect(rows[4][1]).toBe('Overtime @ Double Time');
    // Employee code leads every row; Input Type is always Hours.
    expect(rows[0][0]).toBe('CBE-012');
    expect(rows[1][0]).toBe('CBE-015');
    expect(rows[0][2]).toBe('Hours');
  });

  it('maps ordinary / overtime / public-holiday hours onto the components', () => {
    const rows = componentHoursFormat.rows([payrollRow()], ctx);
    expect(rows[0][3]).toBe(160); // Basic Pay = ordinary
    expect(rows[1][3]).toBe(14); // 5 daily + 2 monthly + 4 Sunday + 3 Saturday
    expect(rows[2][3]).toBe(8); // Double time = public holiday
  });

  it('still emits zero-value components so the importer clears them', () => {
    const rows = componentHoursFormat.rows([payrollRow({ holidayOvertimeHours: 0 })], ctx);
    expect(rows[2][1]).toBe('Overtime @ Double Time');
    expect(rows[2][3]).toBe(0);
  });

  it('leaves payroll-side allocation columns empty', () => {
    const rows = componentHoursFormat.rows([payrollRow()], ctx);
    expect(rows[0].slice(4)).toEqual(['', '', '', '', '', '']);
  });

  it('is registered in the selector so Reports can offer it', () => {
    expect(PAYROLL_EXPORT_FORMATS.map((f) => f.id)).toContain('payroll-component-hours');
    expect(getPayrollExportFormat('payroll-component-hours').label).toBe(
      'Payroll Import (component rows)',
    );
  });
});
