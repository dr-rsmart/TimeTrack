/**
 * Reports Page
 * ------------
 * Payroll/overtime report with date range, branch/department filters,
 * and CSV export. Includes two tabs:
 * - Payroll Summary: aggregated per-employee totals
 * - Time Entries: detailed clock-in/out breakdown
 */

import { useCallback, useEffect, useState } from 'react';
import { Clock, Download, FileBarChart, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { reportApi, timeEntryApi, type PayrollRow, type TimeEntry } from '../services/api';
import { useAuth } from '../context/AuthContext';
import EditTimeEntryModal from '../components/time/EditTimeEntryModal';
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label,
  Select, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs,
} from '../components/ui';
import { toDateStr, downloadCsv, formatHours, formatDate, formatTime } from '../lib/utils';

export default function Reports() {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'master';

  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);

  const [activeTab, setActiveTab] = useState('summary');
  const [from, setFrom] = useState(toDateStr(firstOfMonth));
  const [to, setTo] = useState(toDateStr(new Date()));
  const [branch, setBranch] = useState('');
  const [department, setDepartment] = useState('');
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [entriesLoaded, setEntriesLoaded] = useState(false);

  // ── Edit time entry modal (admin/manager corrections) ──
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);

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

  const loadTimeEntries = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const res = await timeEntryApi.list({
        from,
        to,
        limit: 1000,
      });
      // Filter by branch/department client-side since the API doesn't support these filters
      let filtered = res.items;
      if (branch) {
        filtered = filtered.filter((e) => e.branch === branch);
      }
      if (department) {
        filtered = filtered.filter((e) => e.department === department);
      }
      setTimeEntries(filtered);
      setEntriesLoaded(true);
    } catch (err) {
      toast.error('Failed to load time entries');
      console.error(err);
    } finally {
      setLoadingEntries(false);
    }
  }, [from, to, branch, department]);

  useEffect(() => {
    load();
    loadTimeEntries();
  }, [load, loadTimeEntries]);

  const branches = [...new Set(rows.map((r) => r.branch))];
  const departments = [...new Set(rows.map((r) => r.department))];

  // Employee number / position lookup built from the payroll summary rows so
  // the Time Entries tab and its CSV export align with the payroll report.
  const employeeInfoByEmail = new Map(
    rows.map((r) => [r.email, { employeeNumber: r.employeeNumber, position: r.position }]),
  );

  // Geofence location(s) per employee, derived from the time entries in range
  // so the payroll summary CSV can include a "Geofence Location" column.
  const geofenceLocationsByEmail = new Map<string, string>();
  for (const e of timeEntries) {
    if (!e.geofenceName) continue;
    const existing = geofenceLocationsByEmail.get(e.employeeEmail);
    if (existing) {
      if (!existing.split('; ').includes(e.geofenceName)) {
        geofenceLocationsByEmail.set(e.employeeEmail, `${existing}; ${e.geofenceName}`);
      }
    } else {
      geofenceLocationsByEmail.set(e.employeeEmail, e.geofenceName);
    }
  }

  const handleExportSummary = () => {
    const headers = [
      'Employee Number', 'Employee', 'Position', 'Email', 'Branch', 'Geofence Location', 'Department', 'Days Worked',
      'Ordinary Hours', 'Daily OT', 'Sunday OT', 'Holiday OT', 'Monthly OT',
      'Total OT', 'Weighted OT', 'Total Hours',
    ];
    const data = rows.map((r) => [
      r.employeeNumber ?? '', r.name, r.position ?? '', r.email, r.branch,
      geofenceLocationsByEmail.get(r.email) ?? '', r.department, r.daysWorked,
      r.ordinaryHours, r.dailyOvertimeHours, r.sundayOvertimeHours,
      r.holidayOvertimeHours, r.monthlyOvertimeHours, r.totalOvertimeHours,
      r.totalWeightedOvertime, r.totalHours,
    ]);
    downloadCsv(`payroll-summary-${from}-to-${to}.csv`, headers, data);
    toast.success('Summary CSV exported');
  };

  const handleExportEntries = () => {
    const headers = [
      'Employee Number', 'Employee', 'Position', 'Email', 'Branch', 'Geofence Location', 'Department',
      'Date', 'Clock In', 'Clock Out', 'Break (min)', 'Total Hours',
      'Status', 'Manual Override',
    ];
    const data = timeEntries.map((e) => {
      const info = employeeInfoByEmail.get(e.employeeEmail);
      return [
        info?.employeeNumber ?? '', e.employeeName ?? '', info?.position ?? '',
        e.employeeEmail, e.branch ?? '', e.geofenceName ?? '', e.department ?? '',
        formatDate(e.date), formatTime(e.clockIn), e.clockOut ? formatTime(e.clockOut) : '',
        e.breakMinutes ?? '', e.totalHours ?? '', e.status,
        e.isManualOverride ? 'Yes' : 'No',
      ];
    });
    downloadCsv(`time-entries-${from}-to-${to}.csv`, headers, data);
    toast.success('Time entries CSV exported');
  };

  // Totals for summary
  const totals = rows.reduce(
    (acc, r) => ({
      ordinary: acc.ordinary + r.ordinaryHours,
      overtime: acc.overtime + r.totalOvertimeHours,
      weighted: acc.weighted + r.totalWeightedOvertime,
      total: acc.total + r.totalHours,
    }),
    { ordinary: 0, overtime: 0, weighted: 0, total: 0 },
  );

  // Totals for time entries
  const entryTotals = timeEntries.reduce(
    (acc, e) => ({
      hours: acc.hours + (e.totalHours ?? 0),
      count: acc.count + 1,
    }),
    { hours: 0, count: 0 },
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
          onClick={activeTab === 'summary' ? handleExportSummary : handleExportEntries}
          disabled={activeTab === 'summary' ? rows.length === 0 : timeEntries.length === 0}
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

      {/* Tab navigation */}
      <Tabs
        tabs={[
          { id: 'summary', label: 'Payroll Summary', icon: <FileBarChart className="w-4 h-4" /> },
          { id: 'entries', label: 'Time Entries', icon: <Clock className="w-4 h-4" /> },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* Payroll Summary Tab */}
      {activeTab === 'summary' && (
        <Card className="border-border/50 overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileBarChart className="w-4 h-4 text-brand" />
                Payroll Summary ({from} → {to})
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{rows.length} employees</span>
                <span className="font-semibold text-foreground">{formatHours(totals.total)} total</span>
              </div>
            </div>
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
      )}

      {/* Time Entries Tab */}
      {activeTab === 'entries' && (
        <Card className="border-border/50 overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-brand" />
                Time Entries ({from} → {to})
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{entryTotals.count} entries</span>
                <span className="font-semibold text-foreground">{formatHours(entryTotals.hours)} total</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingEntries ? (
              <div className="flex h-48 items-center justify-center"><Spinner className="h-8 w-8" /></div>
            ) : timeEntries.length === 0 ? (
              <EmptyState message={entriesLoaded ? 'No time entries for this period' : 'Loading…'} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Clock In</TableHead>
                    <TableHead>Clock Out</TableHead>
                    <TableHead className="text-right">Break</TableHead>
                    <TableHead className="text-right">Total Hours</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timeEntries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <p className="font-medium">{e.employeeName || e.employeeEmail}</p>
                        <p className="text-xs text-muted-foreground">{e.employeeEmail}</p>
                      </TableCell>
                      <TableCell>{e.branch || '—'}</TableCell>
                      <TableCell>{formatDate(e.date)}</TableCell>
                      <TableCell>{formatTime(e.clockIn)}</TableCell>
                      <TableCell>{e.clockOut ? formatTime(e.clockOut) : '—'}</TableCell>
                      <TableCell className="text-right">{e.breakMinutes != null ? `${e.breakMinutes}m` : '—'}</TableCell>
                      <TableCell className="text-right font-medium">{formatHours(e.totalHours)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={e.status === 'active' ? 'success' : 'secondary'}>{e.status}</Badge>
                          {e.isManualOverride && <Badge variant="warning">Manual</Badge>}
                        </div>
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-brand"
                            title="Edit time entry"
                            onClick={() => setEditEntry(e)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={6}>Totals ({entryTotals.count} entries)</TableCell>
                    <TableCell className="text-right">{formatHours(entryTotals.hours)}</TableCell>
                    <TableCell>{''}</TableCell>
                    {canEdit && <TableCell>{''}</TableCell>}
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edit time entry modal — admin/manager corrections */}
      {canEdit && (
        <EditTimeEntryModal
          open={editEntry !== null}
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onDone={() => {
            load();
            loadTimeEntries();
          }}
        />
      )}
    </div>
  );
}
