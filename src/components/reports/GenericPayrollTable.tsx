/**
 * Generic Payroll Table (Normal / OT / PH)
 * ----------------------------------------
 * Flat one-row-per-employee view: Normal Hours, Overtime Hours and Public
 * Holiday Hours — the common denominator most payroll-system imports accept.
 *
 * The three figures reuse the exact helpers that drive the `generic-flat` CSV
 * export (`payrollExportFormats.ts`), so what is shown on screen is byte-for-byte
 * the same values that get exported — they can never drift apart.
 */

import { FileBarChart } from 'lucide-react';
import type { PayrollRow } from '../../services/api';
import { formatHours } from '../../lib/utils';
import { normalHours, overtimeHours, publicHolidayHours } from '../../utils/payrollExportFormats';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui';

interface GenericPayrollTableProps {
  rows: PayrollRow[];
  loading: boolean;
  loaded: boolean;
  from: string;
  to: string;
}

export default function GenericPayrollTable({
  rows,
  loading,
  loaded,
  from,
  to,
}: GenericPayrollTableProps) {
  const totals = rows.reduce(
    (acc, r) => ({
      normal: acc.normal + normalHours(r),
      overtime: acc.overtime + overtimeHours(r),
      publicHoliday: acc.publicHoliday + publicHolidayHours(r),
    }),
    { normal: 0, overtime: 0, publicHoliday: 0 },
  );

  return (
    <Card className="border-border/50 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileBarChart className="w-4 h-4 text-brand" />
            Generic Payroll ({from} → {to})
          </CardTitle>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{rows.length} employees</span>
            <span className="font-semibold text-foreground">
              {formatHours(totals.normal + totals.overtime + totals.publicHoliday)} total
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner className="h-8 w-8" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState message={loaded ? 'No payroll data for this period' : 'Loading…'} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Normal Hours</TableHead>
                <TableHead className="text-right">Overtime Hours</TableHead>
                <TableHead className="text-right">Public Holiday Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.position || r.email}</p>
                  </TableCell>
                  <TableCell>{r.branch}</TableCell>
                  <TableCell className="text-right">{formatHours(normalHours(r))}</TableCell>
                  <TableCell className="text-right">{formatHours(overtimeHours(r))}</TableCell>
                  <TableCell className="text-right">{formatHours(publicHolidayHours(r))}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-semibold">
                <TableCell colSpan={2}>Totals ({rows.length} employees)</TableCell>
                <TableCell className="text-right">{formatHours(totals.normal)}</TableCell>
                <TableCell className="text-right">{formatHours(totals.overtime)}</TableCell>
                <TableCell className="text-right">{formatHours(totals.publicHoliday)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
