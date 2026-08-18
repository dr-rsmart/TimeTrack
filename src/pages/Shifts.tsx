/**
 * Shifts Page
 * -----------
 * Weekly shift schedule with create/edit modal and status management.
 * Role-aware:
 * - Employee: sees only their own shifts (read-only)
 * - Manager: manages shifts within their scope
 * - Admin/Master: full schedule management
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Plus, ChevronLeft, ChevronRight, Trash2, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { shiftApi, employeeApi, type Shift, type Employee, ApiError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../hooks/useSSE';
import {
  Badge, Button, Card, CardContent, EmptyState, Input, Label, Modal, Select,
  Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea,
} from '../components/ui';
import { toDateStr, formatDate } from '../lib/utils';

const statusVariant: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  scheduled: 'secondary',
  active: 'success',
  completed: 'default',
  cancelled: 'warning',
  no_show: 'destructive',
};

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

const emptyForm = {
  date: toDateStr(new Date()),
  startTime: '08:00',
  endTime: '17:00',
  shiftType: 'full_day',
  employeeId: '',
  notes: '',
};

export default function Shifts() {
  const { isAdmin, isManager, isEmployee } = useAuth();
  const canManage = isAdmin || isManager;

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [items, setItems] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const from = toDateStr(weekStart);
  const to = toDateStr(weekEnd);

  const load = useCallback(async () => {
    try {
      const res = await shiftApi.list({ from, to, limit: 500 });
      setItems(res.items);
    } catch (err) {
      toast.error('Failed to load shifts');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (canManage) {
      employeeApi.list({ limit: 500 }).then((res) => setEmployees(res.items)).catch(() => {});
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

  // Group shifts by date
  const days: { date: Date; shifts: Shift[] }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = toDateStr(d);
    days.push({ date: d, shifts: items.filter((s) => toDateStr(new Date(s.date)) === dateStr) });
  }

  const openCreate = (dateStr?: string) => {
    setEditing(null);
    setForm({ ...emptyForm, date: dateStr ?? toDateStr(new Date()) });
    setModalOpen(true);
  };

  const openEdit = (shift: Shift) => {
    setEditing(shift);
    setForm({
      date: toDateStr(new Date(shift.date)),
      startTime: shift.startTime ?? '08:00',
      endTime: shift.endTime ?? '17:00',
      shiftType: shift.shiftType,
      employeeId: shift.employeeId ?? '',
      notes: shift.notes ?? '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        shiftType: form.shiftType,
        employeeId: form.employeeId || null,
        notes: form.notes || null,
      };
      if (editing) {
        await shiftApi.update(editing.id, payload);
        toast.success('Shift updated');
      } else {
        await shiftApi.create(payload);
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
        ? prompt('Reason for status change:') ?? shift.notes
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="w-5 h-5 text-brand" />
            <h1 className="text-2xl font-bold">Shift Schedule</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDate(weekStart)} — {formatDate(weekEnd)} · {totalShifts} shifts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="rounded-lg" onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); }} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setWeekStart(startOfWeek(new Date()))}>This Week</Button>
          <Button variant="outline" size="icon" className="rounded-lg" onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); }} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {canManage && (
            <Button onClick={() => openCreate()} className="bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20 rounded-xl">
              <Plus className="h-4 w-4" /> Add Shift
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <div className="space-y-4">
          {days.map(({ date, shifts }, dayIdx) => (
            <motion.div
              key={toDateStr(date)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: dayIdx * 0.04 }}
            >
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">
                    {date.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'short' })}
                    {toDateStr(date) === toDateStr(new Date()) && <Badge className="ml-2" variant="success">Today</Badge>}
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
                          <TableCell className="font-medium">{s.employeeName || 'Unassigned'}</TableCell>
                          <TableCell>{s.startTime ?? '—'} – {s.endTime ?? '—'}</TableCell>
                          <TableCell>
                            <Badge variant={s.shiftType === 'full_day' ? 'secondary' : s.shiftType === 'half_day' ? 'outline' : 'warning'}>
                              {s.shiftType.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant[s.status] ?? 'secondary'}>{s.status.replace('_', ' ')}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-muted-foreground">{s.notes || '—'}</TableCell>
                          {canManage && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {s.status === 'scheduled' && (
                                  <>
                                    <Button variant="outline" size="sm" onClick={() => updateStatus(s, 'completed')}>Complete</Button>
                                    <Button variant="outline" size="sm" onClick={() => updateStatus(s, 'cancelled')}>Cancel</Button>
                                  </>
                                )}
                                <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>Edit</Button>
                                {!isEmployee && (
                                  <Button variant="ghost" size="icon" onClick={() => handleDelete(s)} aria-label="Delete shift">
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
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Shift' : 'Add Shift'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="s-employee">Employee</Label>
            <Select id="s-employee" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
              <option value="">— Unassigned —</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.firstName} {emp.surname} ({emp.branch})</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="s-date">Date</Label>
              <Input id="s-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-start">Start</Label>
              <Input id="s-start" type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-end">End</Label>
              <Input id="s-end" type="time" required value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-type">Shift type</Label>
            <Select id="s-type" value={form.shiftType} onChange={(e) => setForm({ ...form, shiftType: e.target.value })}>
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
            <Textarea id="s-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create shift'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}