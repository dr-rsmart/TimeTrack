/**
 * Report CSV Builders (extracted from src/pages/Reports.tsx)
 * ==========================================================
 * Pure, side-effect-free builders: each returns the filename, headers and row
 * data for one report export. Reports.tsx keeps only the wiring (call builder →
 * downloadCsv → audit-log → toast).
 *
 * Extracted for the Open-09 700-line ratchet — Reports.tsx was already over it —
 * and because pure builders are far easier to unit-test than handlers embedded
 * in a 1000-line component.
 */

import type { AttendanceCostRow, TimeEntry } from '../services/api';
import { formatDate, formatTime } from '../lib/utils';

/** A ready-to-download CSV payload. */
export interface CsvPayload {
  filename: string;
  headers: string[];
  data: (string | number)[][];
}

/** Minimal employee directory info needed by the entries export. */
export interface EmployeeCsvInfo {
  employeeNumber?: string | null;
  position?: string | null;
}

/**
 * Stable per-employee/per-day key. Prefers the employee id and falls back to a
 * normalised email so legacy rows without an id still group correctly.
 */
export function getEmployeeDayKey(entry: TimeEntry): string {
  return `${entry.employeeId ?? entry.employeeEmail.toLowerCase()}|${entry.date.slice(0, 10)}`;
}

/** Detailed time-entry export, one row per punch, plus a per-day total column. */
export function buildEntriesCsv(input: {
  timeEntries: TimeEntry[];
  from: string;
  to: string;
  employeeInfoByEmail: Map<string, EmployeeCsvInfo>;
  employeeDayTotals: Map<string, number>;
}): CsvPayload {
  const { timeEntries, from, to, employeeInfoByEmail, employeeDayTotals } = input;
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
  const data = timeEntries.map((e) => {
    const info = employeeInfoByEmail.get(e.employeeEmail);
    const dayTotal = employeeDayTotals.get(getEmployeeDayKey(e)) ?? 0;
    return [
      info?.employeeNumber ?? '',
      e.employeeName ?? '',
      info?.position ?? '',
      e.employeeEmail,
      e.branch ?? '',
      e.geofenceName ?? '',
      e.department ?? '',
      formatDate(e.date),
      formatTime(e.clockIn),
      e.clockOut ? formatTime(e.clockOut) : '',
      e.breakMinutes ?? '',
      e.totalHours ?? '',
      dayTotal,
      e.status,
      e.isManualOverride ? 'Yes' : 'No',
    ] as (string | number)[];
  });
  return { filename: `time-entries-${from}-to-${to}.csv`, headers, data };
}

/** One row per employee, with a trailing "Breakdown" line (Features #5/#6). */
export function buildBreakdownCsv(input: {
  breakdownByEmployee: Array<{
    row: { name: string };
    dayEntries: TimeEntry[];
    normal: number;
    overtime: number;
    publicHoliday: number;
  }>;
  from: string;
  to: string;
}): CsvPayload {
  const { breakdownByEmployee, from, to } = input;
  const headers = [
    'Employee',
    'Date',
    'Clock In',
    'Clock Out',
    'Day Hours',
    'Normal Hours',
    'Overtime Hours',
    'Public Holiday Hours',
  ];
  const data: (string | number)[][] = [];
  for (const b of breakdownByEmployee) {
    for (const e of b.dayEntries) {
      data.push([
        b.row.name,
        formatDate(e.date),
        formatTime(e.clockIn),
        e.clockOut ? formatTime(e.clockOut) : '',
        e.totalHours ?? 0,
        '',
        '',
        '',
      ]);
    }
    // Per-employee breakdown line (e.g. Normal = 195 / Overtime = 20 / PH = 9).
    data.push([b.row.name, 'Breakdown', '', '', '', b.normal, b.overtime, b.publicHoliday]);
  }
  return { filename: `daily-breakdown-${from}-to-${to}.csv`, headers, data };
}

/** Grouped per-day rollup: distinct employees, entry count and total hours. */
export function buildDailyTotalsCsv(input: {
  dailyTotals: Array<{ date: string; employees: number; entries: number; hours: number }>;
  from: string;
  to: string;
}): CsvPayload {
  const { dailyTotals, from, to } = input;
  return {
    filename: `grouped-daily-totals-${from}-to-${to}.csv`,
    headers: ['Date', 'Employees', 'Entries', 'Total Hours'],
    data: dailyTotals.map((day) => [formatDate(day.date), day.employees, day.entries, day.hours]),
  };
}

/** Cost of Late Coming (Feature #9), with a trailing TOTALS row. */
export function buildCostCsv(input: {
  costRows: AttendanceCostRow[];
  costTotals: { lateMinutes: number; earlyMinutes: number; hoursLost: number; randLost: number };
  from: string;
  to: string;
}): CsvPayload {
  const { costRows, costTotals, from, to } = input;
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
  const data: (string | number)[][] = costRows.map((r) => [
    r.employeeNumber ?? '',
    r.name,
    r.email,
    r.branch,
    r.department,
    r.latePenaltyRate ?? '',
    r.lateMinutes,
    r.earlyMinutes,
    r.hoursLost,
    r.randLost,
  ]);
  data.push([
    '',
    'TOTALS',
    '',
    '',
    '',
    '',
    costTotals.lateMinutes,
    costTotals.earlyMinutes,
    costTotals.hoursLost,
    costTotals.randLost,
  ]);
  return { filename: `cost-of-late-${from}-to-${to}.csv`, headers, data };
}
