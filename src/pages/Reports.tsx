/**
 * Reports Page
 * ------------
 * Payroll/overtime report with date range, branch/department filters,
 * and CSV export. Includes three tabs:
 * - Payroll Summary: aggregated per-employee totals
 * - Time Entries: detailed clock-in/out breakdown
 * - Grouped Daily Totals: all filtered entries combined by date
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  CalendarDays,
  Clock,
  Coins,
  Download,
  FileBarChart,
  ListChecks,
  Pencil,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ApiError,
  employeeApi,
  reportApi,
  timeEntryApi,
  type AttendanceCostRow,
  type Employee,
  type PayrollRow,
  type TimeEntry,
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import EditTimeEntryModal from '../components/time/EditTimeEntryModal';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from '../components/ui';
import { toDateStr, downloadCsv, formatHours, formatDate, formatTime } from '../lib/utils';
import { genericFlatFormat, timetrackStandardFormat } from '../utils/payrollExportFormats';
import {
  buildBreakdownCsv,
  buildCostCsv,
  buildDailyTotalsCsv,
  buildEntriesCsv,
  getEmployeeDayKey,
  type CsvPayload,
} from '../utils/reportCsvExports';
import GenericPayrollTable from '../components/reports/GenericPayrollTable';

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
  const [employeeEmail, setEmployeeEmail] = useState('');
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [directory, setDirectory] = useState<Employee[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [entriesLoaded, setEntriesLoaded] = useState(false);

  // ── Cost of Late Coming (Feature #9) ──
  const [costRows, setCostRows] = useState<AttendanceCostRow[]>([]);
  const [expandedCost, setExpandedCost] = useState<string | null>(null);
  const [costTotals, setCostTotals] = useState({
    lateMinutes: 0,
    earlyMinutes: 0,
    hoursLost: 0,
    randLost: 0,
  });
  const [loadingCost, setLoadingCost] = useState(false);
  const [costLoaded, setCostLoaded] = useState(false);

  // ── Edit time entry modal (admin/manager corrections) ──
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await reportApi.payroll({
        from,
        to,
        branch: branch || undefined,
        department: department || undefined,
        employeeEmail: employeeEmail || undefined,
      });
      setRows(res.rows);
      setLoaded(true);
    } catch (err) {
      toast.error('Failed to load payroll report');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [from, to, branch, department, employeeEmail]);

  const loadTimeEntries = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const res = await timeEntryApi.list({
        from,
        to,
        employeeEmail: employeeEmail || undefined,
        branch: branch || undefined,
        department: department || undefined,
        limit: 1000,
      });
      setTimeEntries(res.items);
      setEntriesLoaded(true);
    } catch (err) {
      toast.error('Failed to load time entries');
      console.error(err);
    } finally {
      setLoadingEntries(false);
    }
  }, [from, to, branch, department, employeeEmail]);

  /**
   * Delete a time entry (e.g. a double clock-in) from the manager's report
   * view, where entries can be filtered by employee/date. Authorization and
   * scope are enforced server-side (application/timeEntryDeletion.ts); the
   * server message is surfaced verbatim on refusal. Payroll totals refresh.
   */
  const handleDeleteEntry = async (entry: TimeEntry) => {
    const who = entry.employeeName || entry.employeeEmail;
    const when = `${formatDate(entry.date)} at ${formatTime(entry.clockIn)}`;
    if (!window.confirm(`Delete the time entry for ${who} (${when})?\n\nThis cannot be undone.`)) {
      return;
    }
    setDeletingEntryId(entry.id);
    try {
      await timeEntryApi.remove(entry.id);
      toast.success(`Time entry deleted for ${who}`);
      setTimeEntries((prev) => prev.filter((x) => x.id !== entry.id));
      void load();
      void loadTimeEntries();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the time entry');
    } finally {
      setDeletingEntryId(null);
    }
  };

  const duplicateCount = timeEntries.filter((e) => e.isFlaggedDuplicate).length;
  const visibleEntries = duplicatesOnly
    ? timeEntries.filter((e) => e.isFlaggedDuplicate)
    : timeEntries;

  const loadDirectory = useCallback(async () => {
    try {
      const result = await employeeApi.list({
        limit: 500,
        branch: branch || undefined,
        department: department || undefined,
      });
      setDirectory(result.items);
    } catch (err) {
      console.error('Failed to load report employee directory', err);
    }
  }, [branch, department]);

  // Cost of Late Coming — hours and Rand lost per employee (Feature #9).
  const loadCost = useCallback(async () => {
    setLoadingCost(true);
    try {
      const res = await reportApi.attendanceCost({
        from,
        to,
        branch: branch || undefined,
        department: department || undefined,
        employeeEmail: employeeEmail || undefined,
      });
      setCostRows(res.rows);
      setCostTotals(res.totals);
      setCostLoaded(true);
    } catch (err) {
      toast.error('Failed to load cost of late report');
      console.error(err);
    } finally {
      setLoadingCost(false);
    }
  }, [from, to, branch, department, employeeEmail]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadTimeEntries();
  }, [loadTimeEntries]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  useEffect(() => {
    loadCost();
  }, [loadCost]);

  const branches = [...new Set(rows.map((r) => r.branch))];
  const departments = [...new Set(rows.map((r) => r.department))];
  const employees = [...directory].sort((a, b) =>
    `${a.firstName} ${a.surname}`.localeCompare(`${b.firstName} ${b.surname}`),
  );

  // Keep the employee selection valid when branch or department filters change.
  useEffect(() => {
    if (employeeEmail && !directory.some((employee) => employee.email === employeeEmail)) {
      setEmployeeEmail('');
    }
  }, [employeeEmail, directory]);

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

  /**
   * Shared export path: build → download → audit-log → toast.
   *
   * Spec §4 requires an audit trail for payroll exports. The CSV itself is built
   * and downloaded client-side, so the server never sees it; we report the
   * download explicitly. Logging is BEST-EFFORT — a failed audit write must
   * never undo or block a download the user already has.
   */
  const runExport = (
    payload: CsvPayload,
    formatId: string,
    formatLabel: string,
    successMessage: string,
  ) => {
    downloadCsv(payload.filename, payload.headers, payload.data);
    toast.success(successMessage);
    void reportApi
      .logPayrollExport({
        formatId,
        formatLabel,
        from,
        to,
        rowCount: payload.data.length,
        filters: {
          tab: activeTab,
          branch: branch || null,
          department: department || null,
          employeeEmail: employeeEmail || null,
        },
        // Platform master (no company context): let the server attribute the
        // export to every company whose employees appear in the loaded data.
        ...(user?.role === 'master' && !user.companyProfileId
          ? {
              employeeIds: [
                ...new Set(
                  [
                    ...rows.map((r) => r.employeeId),
                    ...costRows.map((r) => r.employeeId),
                    ...timeEntries.map((e) => e.employeeId),
                  ].filter((id): id is string => Boolean(id)),
                ),
              ],
            }
          : {}),
      })
      .catch(() => {
        // Non-fatal: the export already succeeded.
      });
  };

  // Payroll Summary exports the TimeTrack Standard format — the same columns
  // rendered on the summary table, so screen and CSV always reconcile.
  const handleExportSummary = () => {
    runExport(
      {
        filename: timetrackStandardFormat.filename(from, to),
        headers: timetrackStandardFormat.headers(),
        data: timetrackStandardFormat.rows(rows, { from, to, geofenceLocationsByEmail }),
      },
      timetrackStandardFormat.id,
      timetrackStandardFormat.label,
      `Payroll CSV exported (${timetrackStandardFormat.label})`,
    );
  };

  // Generic Payroll tab exports its own fixed format (Normal / OT / PH) — the
  // same values rendered on screen, via the same helpers the CSV uses.
  const handleExportGeneric = () => {
    runExport(
      {
        filename: genericFlatFormat.filename(from, to),
        headers: genericFlatFormat.headers(),
        data: genericFlatFormat.rows(rows, { from, to, geofenceLocationsByEmail }),
      },
      genericFlatFormat.id,
      genericFlatFormat.label,
      `Generic Payroll CSV exported (${genericFlatFormat.label})`,
    );
  };

  const handleExportEntries = () => {
    runExport(
      buildEntriesCsv({ timeEntries, from, to, employeeInfoByEmail, employeeDayTotals }),
      'time-entries',
      'Time Entries (detailed)',
      'Time entries CSV exported',
    );
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

  // Per-employee/day totals make multiple entries on the same date easy to
  // reconcile without changing the existing detailed-entry rows.
  // (`getEmployeeDayKey` now lives in utils/reportCsvExports.ts.)
  const employeeDayTotals = new Map<string, number>();
  const groupedDailyTotals = new Map<
    string,
    { employees: Set<string>; entries: number; hours: number }
  >();
  for (const entry of timeEntries) {
    const hours = entry.totalHours ?? 0;
    const dayKey = entry.date.slice(0, 10);
    const employeeDayKey = getEmployeeDayKey(entry);
    employeeDayTotals.set(employeeDayKey, (employeeDayTotals.get(employeeDayKey) ?? 0) + hours);

    const day = groupedDailyTotals.get(dayKey) ?? {
      employees: new Set<string>(),
      entries: 0,
      hours: 0,
    };
    day.employees.add(entry.employeeId ?? entry.employeeEmail.toLowerCase());
    day.entries += 1;
    day.hours += hours;
    groupedDailyTotals.set(dayKey, day);
  }
  const dailyTotals = [...groupedDailyTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, total]) => ({
      date,
      employees: total.employees.size,
      entries: total.entries,
      hours: total.hours,
    }));

  const handleExportDailyTotals = () => {
    runExport(
      buildDailyTotalsCsv({ dailyTotals, from, to }),
      'grouped-daily-totals',
      'Grouped Daily Totals',
      'Grouped daily totals CSV exported',
    );
  };

  // ── Daily Breakdown (Features #5/#6): per-employee daily clocking listed
  // A–Z, each day's hours shown, plus the period breakdown line
  // "Normal Hours = X / Overtime = Y / Public Holiday = Z" per employee. ──
  const breakdownByEmployee = [...rows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => {
      const dayEntries = timeEntries
        .filter((e) => e.employeeEmail.toLowerCase() === r.email.toLowerCase())
        .sort((a, b) => a.date.localeCompare(b.date) || a.clockIn.localeCompare(b.clockIn));
      return {
        row: r,
        dayEntries,
        normal: r.ordinaryHours,
        overtime:
          r.dailyOvertimeHours +
          r.monthlyOvertimeHours +
          r.sundayOvertimeHours +
          r.saturdayOvertimeHours,
        publicHoliday: r.holidayOvertimeHours,
      };
    });

  const handleExportBreakdown = () => {
    runExport(
      buildBreakdownCsv({ breakdownByEmployee, employeeDayTotals, from, to }),
      'daily-breakdown',
      'Daily Breakdown (A–Z + period totals)',
      'Daily breakdown CSV exported',
    );
  };

  // ── Cost of Late Coming export (Feature #9) ──
  const handleExportCost = () => {
    runExport(
      buildCostCsv({ costRows, costTotals, from, to }),
      'cost-of-late',
      'Cost of Late Coming',
      'Cost of late CSV exported',
    );
  };

  /**
   * Spec §6 "Reset" → today. Collapses the range to the current business day and
   * re-runs whichever report the user is looking at, so a manager investigating
   * "who is late TODAY" is one click away instead of re-picking two dates.
   */
  const handleResetToToday = () => {
    const today = toDateStr(new Date());
    setFrom(today);
    setTo(today);
  };

  // Totals for time entries
  const entryTotals = timeEntries.reduce(
    (acc, e) => ({
      hours: acc.hours + (e.totalHours ?? 0),
      count: acc.count + 1,
    }),
    { hours: 0, count: 0 },
  );

  const exportDisabled =
    activeTab === 'summary' || activeTab === 'generic'
      ? rows.length === 0
      : activeTab === 'entries'
        ? timeEntries.length === 0
        : activeTab === 'breakdown'
          ? rows.length === 0
          : activeTab === 'cost'
            ? costRows.length === 0
            : dailyTotals.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileBarChart className="w-5 h-5 text-brand" />
            <h1 className="text-2xl font-bold">Payroll & Overtime Report</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Precision overtime computation · {rows.length} employees in range
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={
              activeTab === 'summary'
                ? handleExportSummary
                : activeTab === 'generic'
                  ? handleExportGeneric
                  : activeTab === 'entries'
                    ? handleExportEntries
                    : activeTab === 'breakdown'
                      ? handleExportBreakdown
                      : activeTab === 'cost'
                        ? handleExportCost
                        : handleExportDailyTotals
            }
            disabled={exportDisabled}
            className="bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20 rounded-xl"
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
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
          {/* Spec §6 "Reset" → today: collapse the range to the current day. */}
          <Button
            type="button"
            variant="outline"
            data-testid="reset-to-today"
            onClick={handleResetToToday}
            title="Set the date range to today"
          >
            <CalendarDays className="h-4 w-4" /> Today
          </Button>
          <div className="space-y-1">
            <Label htmlFor="r-branch">Branch</Label>
            <Select
              id="r-branch"
              className="w-44"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-dept">Department</Label>
            <Select
              id="r-dept"
              className="w-44"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
          {(activeTab === 'summary' ||
            activeTab === 'generic' ||
            activeTab === 'entries' ||
            activeTab === 'daily' ||
            activeTab === 'breakdown' ||
            activeTab === 'cost') && (
            <div className="space-y-1">
              <Label htmlFor="r-employee">Employee</Label>
              <Select
                id="r-employee"
                className="w-56"
                value={employeeEmail}
                onChange={(e) => setEmployeeEmail(e.target.value)}
              >
                <option value="">All employees</option>
                {employees.map((employee) => (
                  <option key={employee.email} value={employee.email}>
                    {employee.firstName} {employee.surname} ({employee.email})
                  </option>
                ))}
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tab navigation */}
      <Tabs
        tabs={[
          { id: 'summary', label: 'Payroll Summary', icon: <FileBarChart className="w-4 h-4" /> },
          { id: 'generic', label: 'Generic Payroll', icon: <FileBarChart className="w-4 h-4" /> },
          { id: 'entries', label: 'Time Entries', icon: <Clock className="w-4 h-4" /> },
          {
            id: 'daily',
            label: 'Grouped Daily Totals',
            icon: <CalendarDays className="w-4 h-4" />,
          },
          {
            id: 'breakdown',
            label: 'Daily Breakdown',
            icon: <ListChecks className="w-4 h-4" />,
          },
          { id: 'cost', label: 'Cost of Late', icon: <Coins className="w-4 h-4" /> },
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
                <span className="font-semibold text-foreground">
                  {formatHours(totals.total)} total
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
                      <TableHead className="text-right">Saturday OT</TableHead>
                      <TableHead className="text-right">Holiday OT</TableHead>
                      <TableHead className="text-right">Monthly OT</TableHead>
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
                        <TableCell className="text-right">
                          {formatHours(r.dailyOvertimeHours)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatHours(r.sundayOvertimeHours)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatHours(r.saturdayOvertimeHours)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatHours(r.holidayOvertimeHours)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatHours(r.monthlyOvertimeHours)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatHours(r.totalOvertimeHours)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatHours(r.totalWeightedOvertime)}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {formatHours(r.totalHours)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Totals row */}
                    <TableRow className="bg-muted/50 font-semibold">
                      <TableCell colSpan={3}>Totals ({rows.length} employees)</TableCell>
                      <TableCell className="text-right">{formatHours(totals.ordinary)}</TableCell>
                      <TableCell className="text-right" colSpan={5}>
                        {''}
                      </TableCell>
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

      {/* Generic Payroll Tab — flat Normal / OT / PH (the generic import layout) */}
      {activeTab === 'generic' && (
        <GenericPayrollTable rows={rows} loading={loading} loaded={loaded} from={from} to={to} />
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
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="duplicates-only-toggle"
                    checked={duplicatesOnly}
                    onChange={(ev) => setDuplicatesOnly(ev.target.checked)}
                  />
                  Duplicates only ({duplicateCount})
                </label>
                <span>{entryTotals.count} entries</span>
                <span className="font-semibold text-foreground">
                  {formatHours(entryTotals.hours)} total
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingEntries ? (
              <div className="flex h-48 items-center justify-center">
                <Spinner className="h-8 w-8" />
              </div>
            ) : visibleEntries.length === 0 ? (
              <EmptyState
                message={
                  !entriesLoaded
                    ? 'Loading…'
                    : duplicatesOnly
                      ? 'No flagged duplicate punches for this period'
                      : 'No time entries for this period'
                }
              />
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
                    <TableHead className="text-right">Entry Hours</TableHead>
                    <TableHead className="text-right">Day Total</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleEntries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <p className="font-medium">{e.employeeName || e.employeeEmail}</p>
                        <p className="text-xs text-muted-foreground">{e.employeeEmail}</p>
                      </TableCell>
                      <TableCell>{e.branch || '—'}</TableCell>
                      <TableCell>{formatDate(e.date)}</TableCell>
                      <TableCell>{formatTime(e.clockIn)}</TableCell>
                      <TableCell>{e.clockOut ? formatTime(e.clockOut) : '—'}</TableCell>
                      <TableCell className="text-right">
                        {e.breakMinutes != null ? `${e.breakMinutes}m` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatHours(e.totalHours)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatHours(employeeDayTotals.get(getEmployeeDayKey(e)) ?? 0)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={e.status === 'active' ? 'success' : 'secondary'}>
                            {e.status}
                          </Badge>
                          {e.isManualOverride && <Badge variant="warning">Manual</Badge>}
                          {e.isFlaggedDuplicate && <Badge variant="destructive">Duplicate</Badge>}
                        </div>
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-brand"
                              title="Edit time entry"
                              onClick={() => setEditEntry(e)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {e.status !== 'active' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                                title="Delete time entry (e.g. a double clock-in)"
                                aria-label={`Delete time entry for ${e.employeeName ?? e.employeeEmail} on ${formatDate(e.date)}`}
                                data-testid={`report-delete-entry-${e.id}`}
                                disabled={deletingEntryId === e.id}
                                onClick={() => void handleDeleteEntry(e)}
                              >
                                {deletingEntryId === e.id ? (
                                  <Spinner className="h-4 w-4" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={6}>Totals ({entryTotals.count} entries)</TableCell>
                    <TableCell className="text-right">{formatHours(entryTotals.hours)}</TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell>{''}</TableCell>
                    {canEdit && <TableCell>{''}</TableCell>}
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Grouped Daily Totals Tab */}
      {activeTab === 'daily' && (
        <Card className="border-border/50 overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-brand" />
                Grouped Daily Totals ({from} → {to})
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{dailyTotals.length} days</span>
                <span className="font-semibold text-foreground">
                  {formatHours(entryTotals.hours)} total
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingEntries ? (
              <div className="flex h-48 items-center justify-center">
                <Spinner className="h-8 w-8" />
              </div>
            ) : dailyTotals.length === 0 ? (
              <EmptyState
                message={entriesLoaded ? 'No time entries for this period' : 'Loading…'}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Employees</TableHead>
                    <TableHead className="text-right">Entries</TableHead>
                    <TableHead className="text-right">Total Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyTotals.map((day) => (
                    <TableRow key={day.date}>
                      <TableCell>{formatDate(day.date)}</TableCell>
                      <TableCell className="text-right">{day.employees}</TableCell>
                      <TableCell className="text-right">{day.entries}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatHours(day.hours)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={3}>Period total</TableCell>
                    <TableCell className="text-right">{formatHours(entryTotals.hours)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Daily Breakdown Tab — per-employee daily clocking A–Z + Normal/OT/PH breakdown */}
      {activeTab === 'breakdown' && (
        <Card className="border-border/50 overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-brand" />
                Daily Breakdown ({from} → {to})
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{breakdownByEmployee.length} employees</span>
                <span className="font-semibold text-foreground">
                  {formatHours(totals.total)} total
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading || loadingEntries ? (
              <div className="flex h-48 items-center justify-center">
                <Spinner className="h-8 w-8" />
              </div>
            ) : breakdownByEmployee.length === 0 ? (
              <EmptyState message={loaded ? 'No payroll data for this period' : 'Loading…'} />
            ) : (
              <div className="space-y-8">
                {breakdownByEmployee.map((b) => (
                  <div key={b.row.employeeId}>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-2">
                      <p className="text-sm font-semibold">
                        {b.row.name}
                        <span className="text-muted-foreground font-normal">
                          {' '}
                          · {b.row.branch} · {b.row.department}
                        </span>
                      </p>
                      <p
                        data-testid={`breakdown-line-${b.row.employeeId}`}
                        className="text-xs font-semibold text-brand"
                      >
                        Normal Hours = {formatHours(b.normal)} / Overtime ={' '}
                        {formatHours(b.overtime)} / Public Holiday = {formatHours(b.publicHoliday)}
                      </p>
                    </div>
                    {b.dayEntries.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No clocking recorded in this period.
                      </p>
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
                            <TableHead className="text-right">Entry Hours</TableHead>
                            <TableHead className="text-right">Day Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {b.dayEntries.map((e) => (
                            <TableRow key={e.id}>
                              <TableCell className="font-medium">{b.row.name}</TableCell>
                              <TableCell>{b.row.branch}</TableCell>
                              <TableCell>{formatDate(e.date)}</TableCell>
                              <TableCell>{formatTime(e.clockIn)}</TableCell>
                              <TableCell>{e.clockOut ? formatTime(e.clockOut) : '—'}</TableCell>
                              <TableCell className="text-right">{e.breakMinutes ?? 0}</TableCell>
                              <TableCell className="text-right">
                                {formatHours(e.totalHours ?? 0)}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatHours(employeeDayTotals.get(getEmployeeDayKey(e)) ?? 0)}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 font-semibold">
                            <TableCell colSpan={7}>Period total</TableCell>
                            <TableCell className="text-right">
                              {formatHours(b.row.totalHours)}
                            </TableCell>
                          </TableRow>
                          <TableRow className="bg-muted/50 font-semibold">
                            <TableCell
                              colSpan={7}
                              data-testid={`breakdown-normal-${b.row.employeeId}`}
                            >
                              Normal Hours
                            </TableCell>
                            <TableCell className="text-right">{formatHours(b.normal)}</TableCell>
                          </TableRow>
                          <TableRow className="bg-muted/50 font-semibold">
                            <TableCell
                              colSpan={7}
                              data-testid={`breakdown-overtime-${b.row.employeeId}`}
                            >
                              Overtime
                            </TableCell>
                            <TableCell className="text-right">{formatHours(b.overtime)}</TableCell>
                          </TableRow>
                          <TableRow className="bg-muted/50 font-semibold">
                            <TableCell colSpan={7} data-testid={`breakdown-ph-${b.row.employeeId}`}>
                              Public Holiday
                            </TableCell>
                            <TableCell className="text-right">
                              {formatHours(b.publicHoliday)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cost of Late Tab — hours and Rand lost to late-ins / early-outs (Feature #9) */}
      {activeTab === 'cost' && (
        <Card className="border-border/50 overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Coins className="w-4 h-4 text-brand" />
                Cost of Late Coming — totals for {from} → {to}
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{costRows.length} employees</span>
                <span className="font-semibold text-foreground">
                  {formatHours(costTotals.hoursLost)} lost · R {costTotals.randLost.toFixed(2)}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Totals cover only the selected period ({from} → {to}). Hours lost = minutes clocked in
              late + minutes clocked out early, measured against the scheduled shift, else the
              location&apos;s working hours, else company working hours. Rand lost = hours lost ×
              the employee&apos;s rate per hour. Click an employee for the per-day breakdown.
            </p>
            {loadingCost ? (
              <div className="flex h-48 items-center justify-center">
                <Spinner className="h-8 w-8" />
              </div>
            ) : costRows.length === 0 ? (
              <EmptyState
                message={
                  costLoaded
                    ? 'No late clock-ins or early clock-outs in this period 🎉'
                    : 'Loading…'
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Penalty Rate (R/hr)</TableHead>
                    <TableHead className="text-right">Late (min)</TableHead>
                    <TableHead className="text-right">Early (min)</TableHead>
                    <TableHead className="text-right">Hours Lost</TableHead>
                    <TableHead className="text-right">Rand Lost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costRows.map((r) => (
                    <Fragment key={r.employeeId}>
                      <TableRow>
                        <TableCell>
                          <button
                            type="button"
                            className="font-medium text-left hover:underline"
                            aria-expanded={expandedCost === r.employeeId}
                            title="Show the per-day breakdown"
                            onClick={() =>
                              setExpandedCost((prev) =>
                                prev === r.employeeId ? null : r.employeeId,
                              )
                            }
                          >
                            {expandedCost === r.employeeId ? '▾ ' : '▸ '}
                            {r.name}
                          </button>
                          <div className="text-xs text-muted-foreground">{r.email}</div>
                        </TableCell>
                        <TableCell>{r.branch}</TableCell>
                        <TableCell className="text-right">
                          {r.latePenaltyRate !== null ? (
                            `R ${r.latePenaltyRate.toFixed(2)}`
                          ) : (
                            <span
                              className="text-muted-foreground"
                              title="Set a late penalty rate (or hourly rate) on the employee profile to see Rand lost"
                            >
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.lateMinutes > 0 ? (
                            <Badge variant="warning">{r.lateMinutes}</Badge>
                          ) : (
                            '0'
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.earlyMinutes > 0 ? (
                            <Badge variant="warning">{r.earlyMinutes}</Badge>
                          ) : (
                            '0'
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatHours(r.hoursLost)}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-red-600">
                          {r.latePenaltyRate !== null ? `R ${r.randLost.toFixed(2)}` : '—'}
                        </TableCell>
                      </TableRow>
                      {expandedCost === r.employeeId &&
                        r.days.map((d) => (
                          <TableRow
                            key={`${r.employeeId}-${d.date}`}
                            className="bg-muted/30 text-xs"
                          >
                            <TableCell colSpan={3} className="pl-8 text-muted-foreground">
                              {formatDate(d.date)}
                            </TableCell>
                            <TableCell className="text-right">{d.lateMinutes}</TableCell>
                            <TableCell className="text-right">{d.earlyMinutes}</TableCell>
                            <TableCell className="text-right">
                              {formatHours((d.lateMinutes + d.earlyMinutes) / 60)}
                            </TableCell>
                            <TableCell className="text-right">
                              {r.latePenaltyRate !== null ? `R ${d.randLost.toFixed(2)}` : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                    </Fragment>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={3}>Totals ({costRows.length} employees)</TableCell>
                    <TableCell className="text-right">{costTotals.lateMinutes}</TableCell>
                    <TableCell className="text-right">{costTotals.earlyMinutes}</TableCell>
                    <TableCell className="text-right">
                      {formatHours(costTotals.hoursLost)}
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      R {costTotals.randLost.toFixed(2)}
                    </TableCell>
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
