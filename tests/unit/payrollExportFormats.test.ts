import { describe, expect, it } from 'vitest';
import {
  defineColumnFormat,
  genericFlatFormat,
  getPayrollExportFormat,
  PAYROLL_EXPORT_FORMATS,
  timetrackStandardFormat,
} from '../../src/utils/payrollExportFormats';
import type { PayrollRow } from '../../src/services/api';

function row(overrides: Partial<PayrollRow> = {}): PayrollRow {
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

const ctx = {
  from: '2026-09-01',
  to: '2026-09-30',
  geofenceLocationsByEmail: new Map([['jane@example.com', 'Sitari Estate']]),
};

describe('timetrackStandardFormat', () => {
  it('exposes a stable id and full header order', () => {
    expect(timetrackStandardFormat.id).toBe('timetrack-standard');
    expect(timetrackStandardFormat.headers()).toEqual([
      'Employee Number',
      'Employee',
      'Position',
      'Email',
      'Branch',
      'Geofence Location',
      'Department',
      'Days Worked',
      'Ordinary Hours',
      'Daily OT',
      'Sunday OT',
      'Saturday OT',
      'Holiday OT',
      'Monthly OT',
      'Total OT',
      'Weighted OT',
      'Total Hours',
    ]);
  });

  it('maps each employee to one row, resolving the geofence location by email', () => {
    const rows = timetrackStandardFormat.rows([row()], ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('EMP001');
    expect(rows[0][1]).toBe('Jane Doe');
    expect(rows[0][5]).toBe('Sitari Estate');
    expect(rows[0][16]).toBe(182); // Total Hours
  });

  it('produces a period-scoped filename', () => {
    expect(timetrackStandardFormat.filename('2026-09-01', '2026-09-30')).toBe(
      'payroll-summary-2026-09-01-to-2026-09-30.csv',
    );
  });
});

describe('genericFlatFormat', () => {
  it('exposes the flat Normal / OT / PH header order', () => {
    expect(genericFlatFormat.id).toBe('generic-flat');
    expect(genericFlatFormat.headers()).toEqual([
      'Employee Number',
      'Employee Name',
      'Email',
      'Period From',
      'Period To',
      'Normal Hours',
      'Overtime Hours',
      'Public Holiday Hours',
      'Total Hours',
    ]);
  });

  it('sums overtime (daily + monthly + Sunday + Saturday) but EXCLUDES holiday hours', () => {
    const rows = genericFlatFormat.rows([row()], ctx);
    // daily 5 + monthly 2 + sunday 4 + saturday 3 = 14 (holiday 8 excluded).
    expect(rows[0][6]).toBe(14);
    expect(rows[0][7]).toBe(8); // public holiday hours in their own column
    expect(rows[0][5]).toBe(160); // normal hours
    expect(rows[0][8]).toBe(182); // total hours
  });

  it('rounds money/hours to 2dp', () => {
    const rows = genericFlatFormat.rows(
      [
        row({
          ordinaryHours: 8.126,
          dailyOvertimeHours: 1.006,
          monthlyOvertimeHours: 0,
          sundayOvertimeHours: 0,
          saturdayOvertimeHours: 0,
          holidayOvertimeHours: 0,
          totalHours: 9.132,
        }),
      ],
      ctx,
    );
    expect(rows[0][5]).toBe(8.13);
    expect(rows[0][6]).toBe(1.01);
    expect(rows[0][8]).toBe(9.13);
  });
});

describe('defineColumnFormat', () => {
  const custom = defineColumnFormat({
    id: 'sage-pastel',
    label: 'Sage Pastel',
    description: 'Customer payroll system',
    filePrefix: 'sage',
    columns: [
      { header: 'Employee Code', value: (r) => r.employeeNumber ?? '' },
      { header: 'Reg Hours', value: (r) => r.ordinaryHours },
    ],
  });

  it('derives headers, filename and rows from the declared column spec', () => {
    expect(custom.headers()).toEqual(['Employee Code', 'Reg Hours']);
    expect(custom.filename('2026-09-01', '2026-09-30')).toBe('sage-2026-09-01-to-2026-09-30.csv');
    expect(custom.rows([row()], ctx)).toEqual([['EMP001', 160]]);
  });
});

describe('registry / getPayrollExportFormat', () => {
  it('defaults the first registered format when the id is unknown', () => {
    expect(getPayrollExportFormat('does-not-exist')).toBe(PAYROLL_EXPORT_FORMATS[0]);
  });

  it('returns the registered format by id', () => {
    expect(getPayrollExportFormat('generic-flat')).toBe(genericFlatFormat);
    expect(getPayrollExportFormat('timetrack-standard')).toBe(timetrackStandardFormat);
  });

  it('defaults to TimeTrack Standard as the first entry', () => {
    expect(PAYROLL_EXPORT_FORMATS[0].id).toBe('timetrack-standard');
  });
});
