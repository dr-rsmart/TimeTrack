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
 *                           payroll importers accept (one row per employee,
 *                           period totals).
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

/**
 * Normal (ordinary) hours for the flat layout. Exported so the Generic Payroll
 * table on screen and the generic CSV use the EXACT same arithmetic and can
 * never drift from each other.
 */
export const normalHours = (r: PayrollRow): number => n2(r.ordinaryHours);
/** Overtime = daily + monthly + Sunday + Saturday overtime (excluding public holidays). */
export const overtimeHours = (r: PayrollRow): number =>
  n2(
    r.dailyOvertimeHours + r.monthlyOvertimeHours + r.sundayOvertimeHours + r.saturdayOvertimeHours,
  );
/** Public-holiday hours. */
export const publicHolidayHours = (r: PayrollRow): number => n2(r.holidayOvertimeHours);

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
 * Component-per-row payroll import layout.
 * ----------------------------------------
 * Several payroll systems do NOT import one row per employee. They import one
 * row per employee PER PAY COMPONENT: the employee code, the component name
 * ("Basic Pay", "Overtime @ 1.5", "Overtime @ Double Time"), an input type and
 * the value. Three components for one employee means three rows.
 *
 * This factory builds that shape from the same authoritative PayrollRow totals
 * used by every other format, so the exported figures always reconcile with
 * the Payroll Summary on screen.
 *
 * Zero-value components are still emitted (rather than omitted): payroll
 * importers generally expect a complete component set per employee, and an
 * explicit 0.00 is what clears a component that carried a value last period.
 *
 * Optional trailing columns (cost centre, project, activity, recovery amount,
 * comments, add/overwrite) are exported EMPTY — they are payroll-side
 * allocations that TimeTrack does not own. They remain in the header so the
 * file imports without the admin re-adding columns.
 */
export function defineComponentFormat(opts: {
  id: string;
  label: string;
  description: string;
  filePrefix: string;
  /** Extra trailing headers exported as empty cells. */
  trailingHeaders?: string[];
  /** Component rows, in the order the payroll system expects them. */
  components: Array<{
    name: string;
    inputType: string;
    value: (r: PayrollRow) => string | number;
  }>;
}): PayrollExportFormat {
  const trailing = opts.trailingHeaders ?? [];
  return {
    id: opts.id,
    label: opts.label,
    description: opts.description,
    filename: (from, to) => `${opts.filePrefix}-${from}-to-${to}.csv`,
    headers: () => [
      'Employee Number',
      'Component Code Or Description',
      'Input Type',
      'Input Value',
      ...trailing,
    ],
    rows: (data) => {
      const out: (string | number)[][] = [];
      // Grouped BY COMPONENT, then by employee — all "Basic Pay" rows first,
      // then all overtime rows. This matches the layout payroll admins work
      // with and keeps the file stable between periods.
      for (const component of opts.components) {
        for (const r of data) {
          out.push([
            r.employeeNumber ?? '',
            component.name,
            component.inputType,
            component.value(r),
            ...trailing.map(() => ''),
          ]);
        }
      }
      return out;
    },
  };
}

/**
 * NOTE: The ready-to-use "Payroll Import (component rows)" format
 * (`payroll-component-hours`: Basic Pay / Overtime @ 1.5 / Overtime @ Double
 * Time) has been WITHDRAWN from the registry pending clarity on the target
 * payroll system's import spec. It is intentionally left as a one-line restore
 * here once that spec is confirmed:
 *
 *   export const componentHoursFormat = defineComponentFormat({
 *     id: 'payroll-component-hours',
 *     label: 'Payroll Import (component rows)',
 *     description: '…',
 *     filePrefix: 'payroll-import-components',
 *     trailingHeaders: [ 'Cost Centre Code', 'Project Code', 'Activity Code',
 *       'Closing recovery amount', 'Comments', 'Add or Overwrite' ],
 *     components: [
 *       { name: 'Basic Pay',              inputType: 'Hours', value: (r) => normalHours(r) },
 *       { name: 'Overtime @ 1.5',         inputType: 'Hours', value: (r) => overtimeHours(r) },
 *       { name: 'Overtime @ Double Time', inputType: 'Hours', value: (r) => publicHolidayHours(r) },
 *     ],
 *   });
 */

/**
 * Declarative factory for customer payroll-system formats. Provide the exact
 * column spec from the target system and a value selector per column.
 *
 * Example (once the customer spec is available):
 *   defineColumnFormat({
 *     id: 'payroll-system-x', label: 'Payroll System X', from/to → filename,
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
