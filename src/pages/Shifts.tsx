/**
 * Shifts Page
 * -----------
 * Shift schedule with Week / Month / custom Range views, per-store filtering,
 * and bulk creation (multiple employees × optional date range).
 * Role-aware:
 * - Employee: sees only their own shifts (read-only)
 * - Manager: manages shifts within their scope
 * - Admin/Master: full schedule management
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Plus, ChevronLeft, ChevronRight, Trash2, CalendarDays, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  shiftApi,
  employeeApi,
  settingsApi,
  type Shift,
  type Employee,
  type Geofence,
  type WorkingHoursSchedule,
  ApiError,
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../hooks/useSSE';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Modal,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '../components/ui';
import { toDateStr, formatDate } from '../lib/utils';

const statusVariant: Record<
  string,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  scheduled: 'secondary',
  active: 'success',
  completed: 'default',
  cancelled: 'warning',
  no_show: 'destructive',
};

type ViewMode = 'week' | 'month' | 'range';

/** Maximum number of day-cards rendered per view (protects long custom ranges). */
const MAX_RENDER_DAYS = 92;

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Parse a YYYY-MM-DD date-input value into a local-midnight Date (null if malformed). */
function parseInputDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Inclusive count of calendar days between two local-midnight dates. */
function daysInclusive(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

interface DayScheduleConfig {
  enabled: boolean;
  startTime: string;
  endTime: string;
  shiftType: string;
}

const defaultWeeklySchedule: Record<number, DayScheduleConfig> = {
  1: { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Mon
  2: { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Tue
  3: { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Wed
  4: { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Thu
  5: { enabled: true, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Fri
  6: { enabled: false, startTime: '08:00', endTime: '12:30', shiftType: 'half_day' }, // Sat (Closed)
  0: { enabled: false, startTime: '08:00', endTime: '16:30', shiftType: 'full_day' }, // Sun (Closed)
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const emptyForm = {
  branch: '',
  employeeIds: [] as string[],
  employeeId: '', // edit mode only (one shift = one employee)
  date: toDateStr(new Date()),
  endDate: '', // create mode only; empty = single day
  startTime: '08:00',
  endTime: '17:00',
  shiftType: 'full_day',
  // Selected Geofence Location ID ('' = none). The location's per-day working
  // hours pre-fill the start/end times and the weekly schedule, and its name
  // is stored on the shift (Shift.location).
  location: '',
  notes: '',
  // Range schedules default to the common Mon-Sat/Sunday-closed template.
  useCustomDailyHours: true,
  weeklySchedule: { ...defaultWeeklySchedule },
};

export default function Shifts() {
  const { isAdmin, isManager, isEmployee } = useAuth();
  const canManage = isAdmin || isManager;

  // ── View state: week | month | range ──
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [customFrom, setCustomFrom] = useState(() => toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(() => toDateStr(new Date()));
  const [branchFilter, setBranchFilter] = useState('');

  const [items, setItems] = useState<Shift[]>([]);
  const [total, setTotal] = useState(0);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Derive the inclusive date window for the current view
  const view = useMemo(() => {
    if (viewMode === 'week') {
      const end = new Date(weekStart);
      end.setDate(end.getDate() + 6);
      return { start: weekStart, end };
    }
    if (viewMode === 'month') {
      const start = startOfMonth(monthAnchor);
      return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 0) };
    }
    const start = parseInputDate(customFrom) ?? startOfWeek(new Date());
    const endRaw = parseInputDate(customTo) ?? start;
    return { start, end: endRaw < start ? start : endRaw };
  }, [viewMode, weekStart, monthAnchor, customFrom, customTo]);

  const from = toDateStr(view.start);
  const to = toDateStr(view.end);

  const load = useCallback(async () => {
    try {
      const res = await shiftApi.list({ from, to, branch: branchFilter || undefined, limit: 500 });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      toast.error('Failed to load shifts');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [from, to, branchFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (canManage) {
      employeeApi
        .list({ limit: 500 })
        .then((res) => setEmployees(res.items))
        .catch(() => {});
      // Geofence Locations power the shift-creation location selector and the
      // Mon–Sun working-hours summary (their schedules pre-fill shift times).
      settingsApi
        .listGeofences()
        .then((res) => setGeofences(res.geofences.filter((g) => g.isActive)))
        .catch(() => {});
    }
  }, [canManage]);

  useSSE(
    useCallback(
      (event) => {
        if (event.type === 'entity_event' && event.entity === 'Shift') load();
      },
      [load],
    ),
  );

  // Group shifts by date across the visible window
  const totalDays = daysInclusive(view.start, view.end);
  const renderDayCount = Math.min(totalDays, MAX_RENDER_DAYS);
  const days = useMemo(() => {
    const out: { date: Date; shifts: Shift[] }[] = [];
    for (let i = 0; i < renderDayCount; i++) {
      const d = new Date(view.start);
      d.setDate(d.getDate() + i);
      const dateStr = toDateStr(d);
      out.push({ date: d, shifts: items.filter((s) => toDateStr(new Date(s.date)) === dateStr) });
    }
    return out;
  }, [view.start, renderDayCount, items]);

  // Store/branch options (from loaded employees and visible shifts)
  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees) if (e.branch) set.add(e.branch);
    for (const s of items) if (s.branch) set.add(s.branch);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [employees, items]);

  // ── Navigation ──
  const navigate = (dir: -1 | 1) => {
    if (viewMode === 'week') {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + dir * 7);
      setWeekStart(d);
    } else if (viewMode === 'month') {
      setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + dir, 1));
    } else {
      // Shift the custom range by its own length (one day when from == to)
      const len = Math.max(daysInclusive(view.start, view.end), 1);
      const f = new Date(view.start);
      f.setDate(f.getDate() + dir * len);
      const t = new Date(view.end);
      t.setDate(t.getDate() + dir * len);
      setCustomFrom(toDateStr(f));
      setCustomTo(toDateStr(t));
    }
  };

  const resetView = () => {
    if (viewMode === 'week') setWeekStart(startOfWeek(new Date()));
    else if (viewMode === 'month') setMonthAnchor(startOfMonth(new Date()));
    else {
      const t = toDateStr(new Date());
      setCustomFrom(t);
      setCustomTo(t);
    }
  };

  // Dynamic center label: only says "This Week"/"This Month" when viewing the
  // current period, otherwise shows the actual period being viewed.
  const now = new Date();
  const isCurrentWeek = toDateStr(weekStart) === toDateStr(startOfWeek(now));
  const isCurrentMonth =
    monthAnchor.getFullYear() === now.getFullYear() && monthAnchor.getMonth() === now.getMonth();
  const centerLabel =
    viewMode === 'week'
      ? isCurrentWeek
        ? 'This Week'
        : `${formatDate(view.start)} – ${formatDate(view.end)}`
      : viewMode === 'month'
        ? isCurrentMonth
          ? 'This Month'
          : view.start.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
        : `${formatDate(view.start)} – ${formatDate(view.end)}`;

  // ── Create modal helpers ──
  /** Employees shown in the create modal, filtered by the chosen store. */
  const modalEmployees = form.branch
    ? employees.filter((e) => e.branch === form.branch)
    : employees;

  const toggleEmployee = (id: string) =>
    setForm((f) => ({
      ...f,
      employeeIds: f.employeeIds.includes(id)
        ? f.employeeIds.filter((x) => x !== id)
        : [...f.employeeIds, id],
    }));

  const selectAllEmployees = () =>
    setForm((f) => ({ ...f, employeeIds: modalEmployees.map((e) => e.id) }));
  const clearEmployees = () => setForm((f) => ({ ...f, employeeIds: [] }));

  /** Days covered by the create form's date range (null when dates are invalid). */
  const rangeDays = useMemo(() => {
    const s = parseInputDate(form.date);
    const e = form.endDate ? parseInputDate(form.endDate) : s;
    if (!s || !e || e < s) return null;
    return daysInclusive(s, e);
  }, [form.date, form.endDate]);

  /** Bulk path = more than one employee or more than one day. */
  const isBulkCreate = !editing && ((rangeDays ?? 1) > 1 || form.employeeIds.length > 1);
  const scheduledDays = useMemo(() => {
    if (!rangeDays) return 0;
    if (!form.useCustomDailyHours || rangeDays <= 1) return rangeDays;

    const start = parseInputDate(form.date);
    if (!start) return rangeDays;

    let openDays = 0;
    for (let i = 0; i < rangeDays; i++) {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      const config = form.weeklySchedule[day.getDay()];
      if (config?.enabled) openDays++;
    }
    return openDays;
  }, [form.date, form.useCustomDailyHours, form.weeklySchedule, rangeDays]);
  const projectedShifts = scheduledDays * form.employeeIds.length;

  // ── Geofence Location selector (per-day working hours) ──
  /** Effective per-day schedules of a geofence (migration 20, legacy fallback). */
  const geofenceSchedules = (gf: Geofence): WorkingHoursSchedule[] =>
    gf.workingHoursSchedules ??
    (gf.workingDays.length > 0
      ? [{ days: gf.workingDays, startTime: gf.workingStartTime, endTime: gf.workingEndTime }]
      : []);

  const scheduleForDay = (gf: Geofence, dayName: string): WorkingHoursSchedule | undefined =>
    geofenceSchedules(gf).find((s) => s.days.includes(dayName));

  /** Geofence IDs assigned to the employee(s) currently selected in the form. */
  const assignedGeofenceIds = useMemo(() => {
    const ids = new Set<string>();
    const relevant = editing
      ? employees.filter((e) => e.id === form.employeeId)
      : employees.filter((e) => form.employeeIds.includes(e.id));
    for (const e of relevant) {
      if (e.geofenceId) ids.add(e.geofenceId);
      for (const gid of e.geofenceIds ?? []) ids.add(gid);
    }
    return ids;
  }, [employees, editing, form.employeeId, form.employeeIds]);

  /**
   * Selector order: the selected employee's assigned geofence(s) FIRST,
   * labelled "(default)" in the dropdown, then the remaining locations.
   */
  const geofenceOptions = useMemo(
    () =>
      [...geofences].sort(
        (a, b) =>
          Number(assignedGeofenceIds.has(b.id)) - Number(assignedGeofenceIds.has(a.id)) ||
          a.name.localeCompare(b.name),
      ),
    [geofences, assignedGeofenceIds],
  );

  const selectedGeofence = useMemo(
    () => geofences.find((g) => g.id === form.location) ?? null,
    [geofences, form.location],
  );

  /**
   * Selecting a Geofence Location applies its per-day hours: the shared
   * start/end times follow the schedule for the form's start date, and the
   * range weekly schedule is filled per weekday (closed days are disabled).
   */
  const applyGeofenceLocation = (geofenceId: string) => {
    setForm((f) => {
      const gf = geofences.find((g) => g.id === geofenceId);
      if (!gf) return { ...f, location: geofenceId };
      const dateObj = parseInputDate(f.date);
      const daySchedule = dateObj ? scheduleForDay(gf, DAY_NAMES[dateObj.getDay()]) : undefined;
      const weekly = { ...f.weeklySchedule };
      for (let i = 0; i < 7; i++) {
        const s = scheduleForDay(gf, DAY_NAMES[i]);
        weekly[i] = s
          ? { enabled: true, startTime: s.startTime, endTime: s.endTime, shiftType: 'full_day' }
          : { ...weekly[i], enabled: false };
      }
      return {
        ...f,
        location: geofenceId,
        startTime: daySchedule?.startTime ?? f.startTime,
        endTime: daySchedule?.endTime ?? f.endTime,
        weeklySchedule: weekly,
      };
    });
  };

  // Changing the start date while a Geofence Location is selected re-applies
  // that day's hours (e.g. Friday 08:00–15:00 vs Monday 08:00–17:00).
  useEffect(() => {
    if (!selectedGeofence) return;
    const dateObj = parseInputDate(form.date);
    if (!dateObj) return;
    const s = scheduleForDay(selectedGeofence, DAY_NAMES[dateObj.getDay()]);
    if (!s) return;
    setForm((f) =>
      f.startTime === s.startTime && f.endTime === s.endTime
        ? f
        : { ...f, startTime: s.startTime, endTime: s.endTime },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, selectedGeofence?.id]);

  const openCreate = (dateStr?: string) => {
    setEditing(null);
    setForm({
      ...emptyForm,
      date: dateStr ?? toDateStr(new Date()),
      branch: branchFilter, // preselect the store being viewed
      employeeIds: [],
      endDate: '',
    });
    setModalOpen(true);
  };

  const openEdit = (shift: Shift) => {
    setEditing(shift);
    setForm({
      ...emptyForm,
      employeeId: shift.employeeId ?? '',
      branch: shift.branch ?? '',
      date: toDateStr(new Date(shift.date)),
      startTime: shift.startTime ?? '08:00',
      endTime: shift.endTime ?? '17:00',
      shiftType: shift.shiftType,
      notes: shift.notes ?? '',
      employeeIds: [],
      endDate: '',
      // Re-select the geofence whose name is stored on the shift (if any).
      location: geofences.find((g) => g.name === shift.location)?.id ?? '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.startTime && form.endTime && form.endTime <= form.startTime) {
      toast.error('End time must be after start time.');
      return;
    }
    // The shift stores the selected Geofence Location's NAME (Shift.location).
    const locationName = selectedGeofence?.name ?? form.location ?? undefined;
    if (
      !editing &&
      (rangeDays ?? 1) > 1 &&
      form.useCustomDailyHours &&
      Object.values(form.weeklySchedule).some(
        (config) =>
          config.enabled &&
          (!config.startTime || !config.endTime || config.endTime <= config.startTime),
      )
    ) {
      toast.error('Each open day must have an end time after its start time.');
      return;
    }
    if (isBulkCreate && form.employeeIds.length === 0) {
      toast.error('Select at least one employee for a multi-day or multi-employee schedule.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await shiftApi.update(editing.id, {
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          shiftType: form.shiftType,
          employeeId: form.employeeId || null,
          location: locationName ?? null,
          notes: form.notes || null,
        });
        toast.success('Shift updated');
      } else if (isBulkCreate) {
        // Bulk schedule: multiple employees and/or a date range
        const res = await shiftApi.bulkCreate({
          employeeIds: form.employeeIds,
          date: form.date,
          endDate: (rangeDays ?? 1) > 1 ? form.endDate : undefined,
          startTime: form.startTime,
          endTime: form.endTime,
          shiftType: form.shiftType,
          location: locationName,
          notes: form.notes || undefined,
          weeklySchedule:
            (rangeDays ?? 1) > 1 && form.useCustomDailyHours ? form.weeklySchedule : undefined,
        });
        toast.success(`Created ${res.created} shift${res.created === 1 ? '' : 's'}`);
        if (res.skipped > 0) {
          const sample = res.skippedDetails
            .slice(0, 3)
            .map((d) => `${d.employeeName}${d.date ? ` (${d.date})` : ''}`)
            .join(', ');
          toast.warning(
            `${res.skipped} shift${res.skipped === 1 ? '' : 's'} skipped due to conflicts: ${sample}${res.skipped > 3 ? '…' : ''}`,
          );
        }
      } else {
        // Single shift (one employee or unassigned) on a single day
        await shiftApi.create({
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          shiftType: form.shiftType,
          employeeId: form.employeeIds[0] ?? null,
          branch: form.branch || undefined,
          location: locationName,
          notes: form.notes || null,
        });
        toast.success('Shift created');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (shift: Shift, status: string) => {
    try {
      const notes = ['cancelled', 'no_show'].includes(status)
        ? (prompt('Reason for status change:') ?? shift.notes)
        : shift.notes;
      await shiftApi.update(shift.id, { status, notes });
      toast.success(`Shift marked ${status.replace('_', ' ')}`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Status update failed');
    }
  };

  const handleDelete = async (shift: Shift) => {
    if (!confirm('Delete this shift?')) return;
    try {
      await shiftApi.remove(shift.id);
      toast.success('Shift deleted');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Delete failed');
    }
  };

  const totalShifts = items.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CalendarDays className="w-5 h-5 text-brand" />
              <h1 className="text-2xl font-bold">Shift Schedule</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {formatDate(view.start)} — {formatDate(view.end)} · {totalShifts} shift
              {totalShifts === 1 ? '' : 's'}
              {total > items.length ? ` (showing first ${items.length} of ${total})` : ''}
            </p>
          </div>
          {canManage && (
            <Button
              onClick={() => openCreate()}
              className="bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20 rounded-xl"
            >
              <Plus className="h-4 w-4" /> Add Shift
            </Button>
          )}
        </div>

        {/* View controls: navigation, mode switcher, range picker, store filter */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="rounded-lg"
            onClick={() => navigate(-1)}
            aria-label="Previous period"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg min-w-[160px]"
            onClick={resetView}
            title="Jump to the current period"
          >
            {centerLabel}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-lg"
            onClick={() => navigate(1)}
            aria-label="Next period"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Week / Month / Range switcher */}
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(['week', 'month', 'range'] as ViewMode[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={viewMode === m ? 'default' : 'ghost'}
                className={
                  viewMode === m
                    ? 'rounded-none bg-brand text-white hover:bg-brand-dark'
                    : 'rounded-none'
                }
                onClick={() => setViewMode(m)}
              >
                {m === 'week' ? 'Week' : m === 'month' ? 'Month' : 'Range'}
              </Button>
            ))}
          </div>

          {viewMode === 'range' && (
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                aria-label="Range start date"
                className="w-36"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                aria-label="Range end date"
                className="w-36"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          )}

          <div className="ml-auto">
            <Select
              aria-label="Filter shifts by store"
              className="w-44"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
            >
              <option value="">All stores</option>
              {branchOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {renderDayCount < totalDays && (
        <div className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <span>
            Showing the first {renderDayCount} of {totalDays} days in this range. Narrow the range
            to see all days.
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : (
        <div className="space-y-4">
          {days.map(({ date, shifts }, dayIdx) => (
            <motion.div
              key={toDateStr(date)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(dayIdx * 0.02, 0.4) }}
            >
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-semibold">
                      {date.toLocaleDateString('en-ZA', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'short',
                      })}
                      {toDateStr(date) === toDateStr(new Date()) && (
                        <Badge className="ml-2" variant="success">
                          Today
                        </Badge>
                      )}
                    </h3>
                    {canManage && (
                      <Button variant="ghost" size="sm" onClick={() => openCreate(toDateStr(date))}>
                        <Plus className="h-3 w-3" /> Add
                      </Button>
                    )}
                  </div>
                  {shifts.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">No shifts scheduled</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Notes</TableHead>
                          {canManage && <TableHead className="text-right">Actions</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shifts.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>
                              <div className="font-medium">{s.employeeName || 'Unassigned'}</div>
                              {s.branch && (
                                <div className="text-xs text-muted-foreground">{s.branch}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              {s.startTime ?? '—'} – {s.endTime ?? '—'}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  s.shiftType === 'full_day'
                                    ? 'secondary'
                                    : s.shiftType === 'half_day'
                                      ? 'outline'
                                      : 'warning'
                                }
                              >
                                {s.shiftType.replace('_', ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariant[s.status] ?? 'secondary'}>
                                {s.status.replace('_', ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-muted-foreground">
                              {s.notes || '—'}
                            </TableCell>
                            {canManage && (
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  {s.status === 'scheduled' && (
                                    <>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => updateStatus(s, 'completed')}
                                      >
                                        Complete
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => updateStatus(s, 'cancelled')}
                                      >
                                        Cancel
                                      </Button>
                                    </>
                                  )}
                                  <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                                    Edit
                                  </Button>
                                  {!isEmployee && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleDelete(s)}
                                      aria-label="Delete shift"
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create/Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Shift' : 'Add Shift'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editing ? (
            <>
              {/* Store selection (filters the employee list below) */}
              <div className="space-y-2">
                <Label htmlFor="s-store">Store</Label>
                <Select
                  id="s-store"
                  value={form.branch}
                  onChange={(e) => {
                    const b = e.target.value;
                    setForm((f) => ({
                      ...f,
                      branch: b,
                      // drop any selected employees that fall outside the chosen store
                      employeeIds: b
                        ? f.employeeIds.filter(
                            (id) => employees.find((emp) => emp.id === id)?.branch === b,
                          )
                        : f.employeeIds,
                    }));
                  }}
                >
                  <option value="">All stores</option>
                  {branchOptions.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Multi-employee selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Employees · {form.employeeIds.length} selected</Label>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={selectAllEmployees}>
                      Select all
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={clearEmployees}>
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-border p-2">
                  {modalEmployees.length === 0 ? (
                    <p className="py-2 text-center text-sm text-muted-foreground">
                      No employees available{form.branch ? ` in ${form.branch}` : ''}
                    </p>
                  ) : (
                    modalEmployees.map((emp) => (
                      <label
                        key={emp.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={form.employeeIds.includes(emp.id)}
                          onChange={() => toggleEmployee(emp.id)}
                        />
                        <span>
                          {emp.firstName} {emp.surname}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">{emp.branch}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Date range: start date + optional end date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="s-date">Start date</Label>
                  <Input
                    id="s-date"
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="s-end-date">
                    End date <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="s-end-date"
                    type="date"
                    min={form.date}
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  />
                </div>
              </div>

              {(rangeDays ?? 1) > 1 && (
                <div className="space-y-3">
                  <p className="rounded-lg bg-muted/70 px-3 py-2 text-sm text-muted-foreground">
                    <Info className="mr-1.5 inline h-3.5 w-3.5" />
                    {projectedShifts > 0 ? (
                      <>
                        Creates {projectedShifts} shift{projectedShifts === 1 ? '' : 's'}:{' '}
                        {scheduledDays} open day{scheduledDays === 1 ? '' : 's'} of {rangeDays} ×{' '}
                        {form.employeeIds.length} employee{form.employeeIds.length === 1 ? '' : 's'}
                        .
                      </>
                    ) : (
                      <>
                        Range covers {rangeDays} days ({scheduledDays} open) — select employees
                        above to include them.
                      </>
                    )}
                  </p>

                  {/* Day-of-week customize toggle */}
                  <div className="rounded-xl border border-border p-3 bg-secondary/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-semibold">Custom Hours per Day of Week</span>
                        <p className="text-xs text-muted-foreground">
                          Set unique hours for weekdays, Saturdays, or mark Sundays Closed.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        id="s-custom-daily"
                        checked={form.useCustomDailyHours}
                        onChange={(e) =>
                          setForm({ ...form, useCustomDailyHours: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand cursor-pointer"
                      />
                    </div>

                    {form.useCustomDailyHours && (
                      <div className="space-y-2 pt-2 border-t border-border/50">
                        {/* Day list: Mon(1) to Sat(6), Sun(0) */}
                        {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => {
                          const config =
                            form.weeklySchedule[dayIdx] ?? defaultWeeklySchedule[dayIdx];
                          return (
                            <div
                              key={dayIdx}
                              className="flex items-center gap-2 text-xs py-1 px-2 rounded-lg bg-background border border-border/40"
                            >
                              <span className="w-20 font-medium">{DAY_NAMES[dayIdx]}</span>
                              <label className="flex items-center gap-1 cursor-pointer mr-2">
                                <input
                                  type="checkbox"
                                  checked={config.enabled}
                                  onChange={(e) => {
                                    const next = {
                                      ...form.weeklySchedule,
                                      [dayIdx]: { ...config, enabled: e.target.checked },
                                    };
                                    setForm({ ...form, weeklySchedule: next });
                                  }}
                                  className="h-3.5 w-3.5 rounded text-brand cursor-pointer"
                                />
                                <span
                                  className={
                                    config.enabled
                                      ? 'text-emerald-600 font-semibold'
                                      : 'text-muted-foreground'
                                  }
                                >
                                  {config.enabled ? 'Open' : 'Closed'}
                                </span>
                              </label>
                              {config.enabled && (
                                <>
                                  <input
                                    type="time"
                                    value={config.startTime}
                                    onChange={(e) => {
                                      const next = {
                                        ...form.weeklySchedule,
                                        [dayIdx]: { ...config, startTime: e.target.value },
                                      };
                                      setForm({ ...form, weeklySchedule: next });
                                    }}
                                    className="px-2 py-1 text-xs border rounded bg-secondary/30"
                                  />
                                  <span>to</span>
                                  <input
                                    type="time"
                                    value={config.endTime}
                                    onChange={(e) => {
                                      const next = {
                                        ...form.weeklySchedule,
                                        [dayIdx]: { ...config, endTime: e.target.value },
                                      };
                                      setForm({ ...form, weeklySchedule: next });
                                    }}
                                    className="px-2 py-1 text-xs border rounded bg-secondary/30"
                                  />
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="s-employee">Employee</Label>
                <Select
                  id="s-employee"
                  value={form.employeeId}
                  onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                >
                  <option value="">— Unassigned —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.surname} ({emp.branch})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-edit-date">Date</Label>
                <Input
                  id="s-edit-date"
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
            </>
          )}

          {/* Geofence Location — its per-day working hours pre-fill the times below */}
          {canManage && geofenceOptions.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="s-geofence">Geofence Location</Label>
              <Select
                id="s-geofence"
                value={form.location}
                onChange={(e) => applyGeofenceLocation(e.target.value)}
              >
                <option value="">— No location —</option>
                {geofenceOptions.map((gf) => (
                  <option key={gf.id} value={gf.id}>
                    {gf.name}
                    {assignedGeofenceIds.has(gf.id) ? ' (default)' : ''}
                  </option>
                ))}
              </Select>
              {selectedGeofence && (
                <div className="rounded-lg bg-muted/70 border border-border/60 p-3 space-y-1.5">
                  <p className="text-xs font-semibold">
                    <Info className="mr-1.5 inline h-3.5 w-3.5" />
                    Working hours at {selectedGeofence.name} — applied to the selected date
                    {form.endDate ? 's' : ''}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {DAY_NAMES.slice(1)
                      .concat(DAY_NAMES[0])
                      .map((day) => {
                        const s = scheduleForDay(selectedGeofence, day);
                        return (
                          <span key={day} className={s ? 'text-foreground font-medium' : ''}>
                            {day.slice(0, 3)}: {s ? `${s.startTime}–${s.endTime}` : 'Closed'}
                          </span>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Shared fields.
              Start/End time stay editable when "No location" is selected; when
              a Geofence Location is chosen they are HIDDEN — the shift times
              come from that location's per-day working hours (see the Mon–Sun
              summary above). The values remain in form state (pre-filled by
              applyGeofenceLocation) so submission still sends valid times. */}
          {!selectedGeofence && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="s-start">Start time</Label>
                <Input
                  id="s-start"
                  type="time"
                  required
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-end">End time</Label>
                <Input
                  id="s-end"
                  type="time"
                  required
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                />
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="s-type">Shift type</Label>
            <Select
              id="s-type"
              value={form.shiftType}
              onChange={(e) => setForm({ ...form, shiftType: e.target.value })}
            >
              <option value="full_day">Full day</option>
              <option value="half_day">Half day</option>
              <option value="Holiday">Holiday</option>
              <option value="Leave">Leave</option>
              <option value="Sick">Sick</option>
              <option value="PTO">PTO</option>
              <option value="Unpaid">Unpaid</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-notes">Notes</Label>
            <Textarea
              id="s-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create shift'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
