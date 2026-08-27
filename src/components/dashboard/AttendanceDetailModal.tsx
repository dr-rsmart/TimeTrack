/**
 * AttendanceDetailModal
 * ---------------------
 * Drill-down modal behind the Admin/Manager dashboard KPI cards.
 * Clicking any stat card opens this modal, which shows who is clocked in
 * right now and who hasn't — a single searchable roster table with live
 * clock status badges (clocked-in employees listed first).
 *
 * All data comes from a single GET /dashboard/attendance-detail call which
 * applies the same tenant + manager scope + business-timezone conventions
 * as /dashboard/summary, so the figures always match the KPI cards.
 */

import { useEffect, useState } from 'react';
import { UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import {
  dashboardApi,
  type AttendanceDetailEmployee,
  type AttendanceDetailResponse,
} from '../../services/api';
import {
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  Avatar,
  Spinner,
  EmptyState,
  Input,
} from '../ui';
import { formatTime } from '../../lib/utils';

// ── Shared table for employee rows ──
function DetailTable({
  rows,
  showStatus = false,
  emptyMessage,
}: {
  rows: AttendanceDetailEmployee[];
  showStatus?: boolean;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState message={emptyMessage ?? 'No employees to show'} />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Branch</TableHead>
          <TableHead>Clock In</TableHead>
          <TableHead>Clock Out</TableHead>
          <TableHead>Hours Today</TableHead>
          {showStatus && <TableHead>Status</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((emp) => (
          <TableRow key={emp.employeeId}>
            <TableCell>
              <div className="flex items-center gap-3">
                <Avatar name={emp.name} size="sm" />
                <div className="min-w-0">
                  <p className="font-medium truncate">{emp.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{emp.email}</p>
                </div>
              </div>
            </TableCell>
            <TableCell>{emp.branch || '—'}</TableCell>
            <TableCell>{formatTime(emp.clockIn ?? emp.firstClockIn)}</TableCell>
            <TableCell>{formatTime(emp.clockOut)}</TableCell>
            <TableCell>{emp.hoursToday > 0 ? `${emp.hoursToday.toFixed(1)}h` : '—'}</TableCell>
            {showStatus && (
              <TableCell>
                <Badge variant={emp.status === 'clocked_in' ? 'success' : 'secondary'}>
                  {emp.status === 'clocked_in' ? 'Clocked in' : 'Not clocked in'}
                </Badge>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function AttendanceDetailModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<AttendanceDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // Fetch fresh data every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setSearch('');
    let cancelled = false;
    setLoading(true);
    dashboardApi
      .attendanceDetail()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) toast.error('Failed to load workforce details');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const employees = data?.employees ?? [];
  const summary = data?.summary;

  const matchesSearch = (e: AttendanceDetailEmployee): boolean => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      (e.branch || '').toLowerCase().includes(q)
    );
  };

  const filtered = employees.filter(matchesSearch);
  const clockedInCount = filtered.filter((e) => e.status === 'clocked_in').length;
  const notClockedInCount = filtered.length - clockedInCount;
  // Clocked-in employees first, otherwise keep the alphabetical roster order.
  const rosterSorted = [...filtered].sort((a, b) => {
    if (a.status === b.status) return 0;
    return a.status === 'clocked_in' ? -1 : 1;
  });

  return (
    <Modal open={open} onClose={onClose} title="Workforce Details" wide>
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-7 w-7" />
          </div>
        ) : !data || employees.length === 0 ? (
          <EmptyState message="No employee data available" />
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <Badge variant="success">
                <UserCheck className="w-3.5 h-3.5 mr-1" />
                {summary?.clockedInNow ?? clockedInCount} clocked in now
              </Badge>
              <Badge variant="secondary">
                <UserX className="w-3.5 h-3.5 mr-1" />
                {summary ? summary.totalEmployees - summary.clockedInNow : notClockedInCount} not clocked in
              </Badge>
            </div>
            <Input
              placeholder="Search by name, email or branch…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <DetailTable rows={rosterSorted} showStatus emptyMessage="No employees match your search" />
          </>
        )}
      </div>
    </Modal>
  );
}

