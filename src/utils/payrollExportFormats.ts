/**
 * Payroll Export Format Registry (Feature #4)
 * -------------------------------------------
 * Payroll export formats differ per payroll system. This registry makes the
 * export format PLUGGABLE: each format declares its headers, row mapping and
 * filename. The Reports page renders every registered format in its "Format"
 * selector — adding one of the customer's three payroll-system formats is a
 * pure data addition here (no UI or API changes needed).
 *
 * Shipped formats:
 *  - `timetrack-standard` — full TimeTrack detail (current default).
 *  - `generic-flat`       — the flat Normal/Overtime/Public-Holiday layout most
 *                           SA payroll importers accept (Sage/PaySpace/EasyPay
 *                           style: one row per employee, period totals).
 *
 * To register a customer-supplied format, append a `defineColumnFormat({...})`
 * entry with the exact column order/labels from that system's spec sheet.
 */

import type { PayrollRow } from '../services/api';

export interface PayrollExportContext {
  from: string;
  to: string;
  /** Geofence location(s) per employee email, derived from time entries. */
  geofenceLocationsByEmail: Map<string, string>;
}

export interface PayrollExportFormat {
  id: string;
  label: string;
  description: string;
  filename(from: string, to: string): string;
  headers(): string[];
  rows(data: PayrollRow[], ctx: PayrollExportContext): (string | number)[][];
}

/** Round to 2dp for export cells (payroll convention). */
const n2 = (v: number): number => parseFloat(v.toFixed(2));

/** Normal (ordinary) hours for the flat layout. */
const normalHours = (r: PayrollRow): number => n2(r.ordinaryHours);
/** Overtime = daily + monthly + Sunday + Saturday overtime (excluding public holidays). */
const overtimeHours = (r: PayrollRow): number =>
  n2(
    r.dailyOvertimeHours + r.monthlyOvertimeHours + r.sundayOvertimeHours + r.saturdayOvertimeHours,
  );
/** Public-holiday hours. */
const publicHolidayHours = (r: PayrollRow): number => n2(r.holidayOvertimeHours);

export const timetrackStandardFormat: PayrollExportFormat = {
  id: 'timetrack-standard',
  label: 'TimeTrack Standard',
  description: 'Full TimeTrack payroll detail with all overtime categories.',
  filename: (from, to) => `payroll-summary-${from}-to-${to}.csv`,
  headers: () => [
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
  ],
  rows: (data, ctx) =>
    data.map((r) => [
      r.employeeNumber ?? '',
      r.name,
      r.position ?? '',
      r.email,
      r.branch,
      ctx.geofenceLocationsByEmail.get(r.email) ?? '',
      r.department,
      r.daysWorked,
      r.ordinaryHours,
      r.dailyOvertimeHours,
      r.sundayOvertimeHours,
      r.saturdayOvertimeHours,
      r.holidayOvertimeHours,
      r.monthlyOvertimeHours,
      r.totalOvertimeHours,
      r.totalWeightedOvertime,
      r.totalHours,
    ]),
};

export const genericFlatFormat: PayrollExportFormat = {
  id: 'generic-flat',
  label: 'Generic Payroll (Normal / OT / PH)',
  description:
    'Flat one-row-per-employee layout: Normal Hours, Overtime Hours, Public Holiday Hours — the common denominator accepted by most payroll system imports.',
  filename: (from, to) => `payroll-export-generic-${from}-to-${to}.csv`,
  headers: () => [
    'Employee Number',
    'Employee Name',
    'Email',
    'Period From',
    'Period To',
    'Normal Hours',
    'Overtime Hours',
    'Public Holiday Hours',
    'Total Hours',
  ],
  rows: (data, ctx) =>
    data.map((r) => [
      r.employeeNumber ?? '',
      r.name,
      r.email,
      ctx.from,
      ctx.to,
      normalHours(r),
      overtimeHours(r),
      publicHolidayHours(r),
      n2(r.totalHours),
    ]),
};

/**
 * Declarative factory for customer payroll-system formats. Provide the exact
 * column spec from the target system and a value selector per column.
 *
 * Example (once the customer spec is available):
 *   defineColumnFormat({
 *     id: 'sage-pastel', label: 'Sage Pastel Payroll', from/to → filename,
 *     columns: [
 *       { header: 'Employee Code', value: (r) => r.employeeNumber ?? '' },
 *       { header: 'Reg Hours',     value: (r) => normalHours(r) },
 *       ...
 *     ],
 *   })
 */
export function defineColumnFormat(opts: {
  id: string;
  label: string;
  description: string;
  filePrefix: string;
  columns: Array<{
    header: string;
    value: (r: PayrollRow, ctx: PayrollExportContext) => string | number;
  }>;
}): PayrollExportFormat {
  return {
    id: opts.id,
    label: opts.label,
    description: opts.description,
    filename: (from, to) => `${opts.filePrefix}-${from}-to-${to}.csv`,
    headers: () => opts.columns.map((c) => c.header),
    rows: (data, ctx) => data.map((r) => opts.columns.map((c) => c.value(r, ctx))),
  };
}

/** All registered formats, in selector order. The first entry is the default. */
export const PAYROLL_EXPORT_FORMATS: PayrollExportFormat[] = [
  timetrackStandardFormat,
  genericFlatFormat,
  // ← append customer payroll-system formats here via defineColumnFormat(...)
];

export function getPayrollExportFormat(id: string): PayrollExportFormat {
  return PAYROLL_EXPORT_FORMATS.find((f) => f.id === id) ?? PAYROLL_EXPORT_FORMATS[0];
}
