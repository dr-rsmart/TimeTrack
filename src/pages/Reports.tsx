/**
 * Reports Page
 * ------------
 * Payroll/overtime report with date range, branch/department filters,
 * and CSV export.
 */

import { useCallback, useEffect, useState } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import { toast } from 'sonner';
import { reportApi, type PayrollRow } from '../services/api';
import {
  Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label,
  Select, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../components/ui';
import { toDateStr, downloadCsv, formatHours } from '../lib/utils';

export default function Reports() {
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);

  const [from, setFrom] = useState(toDateStr(firstOfMonth));
  const [to, setTo] = useState(toDateStr(new Date()));
  const [branch, setBranch] = useState('');
  const [department, setDepartment] = useState('');
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await reportApi.payroll({
        from,
        to,
        branch: branch || undefined,
        department: department || undefined,
      });
      setRows(res.rows);
      setLoaded(true);
    } catch (err) {
      toast.error('Failed to load payroll report');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [from, to, branch, department]);

  useEffect(() => {
    load();
  }, [load]);

  const branches = [...new Set(rows.map((r) => r.branch))];
  const departments = [...new Set(rows.map((r) => r.department))];

  const handleExport = () => {
    const headers = [
      'Employee Number', 'Employee', 'Position', 'Email', 'Branch', 'Department', 'Days Worked',
      'Ordinary Hours', 'Daily OT', 'Sunday OT', 'Holiday OT', 'Monthly OT',
      'Total OT', 'Weighted OT', 'Total Hours',
    ];
    const data = rows.map((r) => [
      r.employeeNumber ?? '', r.name, r.position ?? '', r.email, r.branch, r.department, r.daysWorked,
      r.ordinaryHours, r.dailyOvertimeHours, r.sundayOvertimeHours,
      r.holidayOvertimeHours, r.monthlyOvertimeHours, r.totalOvertimeHours,
      r.totalWeightedOvertime, r.totalHours,
    ]);
    downloadCsv(`payroll-report-${from}-to-${to}.csv`, headers, data);
    toast.success('CSV exported');
  };

  // Totals
  const totals = rows.reduce(
    (acc, r) => ({
      ordinary: acc.ordinary + r.ordinaryHours,
      overtime: acc.overtime + r.totalOvertimeHours,
      weighted: acc.weighted + r.totalWeightedOvertime,
      total: acc.total + r.totalHours,
    }),
    { ordinary: 0, overtime: 0, weighted: 0, total: 0 },
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileBarChart className="w-5 h-5 text-brand" />
            <h1 className="text-2xl font-bold">Payroll & Overtime Report</h1>
          </div>
          <p className="text-sm text-muted-foreground">Precision overtime computation · {rows.length} employees in range</p>
        </div>
        <Button
          onClick={handleExport}
          disabled={rows.length === 0}
          className="bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20 rounded-xl"
        >
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-border/50">
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="space-y-1">
            <Label htmlFor="r-from">From</Label>
            <Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-to">To</Label>
            <Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-branch">Branch</Label>
            <Select id="r-branch" className="w-44" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-dept">Department</Label>
            <Select id="r-dept" className="w-44" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Report table */}
      <Card className="border-border/50 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Payroll Summary ({from} → {to})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-48 items-center justify-center"><Spinner className="h-8 w-8" /></div>
          ) : rows.length === 0 ? (
            <EmptyState message={loaded ? 'No payroll data for this period' : 'Loading…'} />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead className="text-right">Ordinary</TableHead>
                    <TableHead className="text-right">Daily OT</TableHead>
                    <TableHead className="text-right">Sunday OT</TableHead>
                    <TableHead className="text-right">Holiday OT</TableHead>
                    <TableHead className="text-right">Total OT</TableHead>
                    <TableHead className="text-right">Weighted OT</TableHead>
                    <TableHead className="text-right">Total Hours</TableHead>
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
                      <TableCell>{r.daysWorked}</TableCell>
                      <TableCell className="text-right">{formatHours(r.ordinaryHours)}</TableCell>
                      <TableCell className="text-right">{formatHours(r.dailyOvertimeHours)}</TableCell>
                      <TableCell className="text-right">{formatHours(r.sundayOvertimeHours)}</TableCell>
                      <TableCell className="text-right">{formatHours(r.holidayOvertimeHours)}</TableCell>
                      <TableCell className="text-right font-medium">{formatHours(r.totalOvertimeHours)}</TableCell>
                      <TableCell className="text-right">{formatHours(r.totalWeightedOvertime)}</TableCell>
                      <TableCell className="text-right font-bold">{formatHours(r.totalHours)}</TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={3}>Totals ({rows.length} employees)</TableCell>
                    <TableCell className="text-right">{formatHours(totals.ordinary)}</TableCell>
                    <TableCell className="text-right" colSpan={3}>{''}</TableCell>
                    <TableCell className="text-right">{formatHours(totals.overtime)}</TableCell>
                    <TableCell className="text-right">{formatHours(totals.weighted)}</TableCell>
                    <TableCell className="text-right">{formatHours(totals.total)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}