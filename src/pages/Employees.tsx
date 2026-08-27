/**
 * Employees Page (Workforce Directory)
 * ------------------------------------
 * Employee directory with search, filters, and CRUD (RBAC-aware).
 * - Master: sees all companies' employees
 * - Admin: full company access, can assign roles
 * - Manager: scoped to branch/department, salary info masked
 * - Employee: not accessible (route guarded)
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, Pencil, Trash2, Users, ShieldCheck, MapPin, UserCog, KeyRound, RotateCcw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { employeeApi, type Employee, type ManagerOption } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../hooks/useSSE';
import {
  Badge, Button, Card, CardContent, EmptyState, Input, Label, Modal, Select,
  Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Avatar,
} from '../components/ui';
import ImportEmployeesModal from '../components/employees/ImportEmployeesModal';
import { formatDate } from '../lib/utils';
import { ApiError } from '../services/api';

interface GeofenceOption {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
}

const emptyForm = {
  firstName: '',
  surname: '',
  email: '',
  position: '',
  role: 'employee',
  branch: 'Unassigned',
  department: 'General',
  employeeNumber: '',
  phone: '',
  managerId: '' as string,
};

export default function Employees() {
  const { isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;
  // Only admins can add/delete employees; managers can only edit (change location)
  const canAddEmployee = isAdmin;

  const [items, setItems] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [department, setDepartment] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  
  // Geofence options for assignment
  const [geofences, setGeofences] = useState<GeofenceOption[]>([]);
  const [formGeofenceId, setFormGeofenceId] = useState<string | null>(null);

  // Manager options loaded from dedicated endpoint (admin only)
  const [managerOptions, setManagerOptions] = useState<ManagerOption[]>([]);

  // Dedicated "Assign Manager" modal state
  const [assignManagerModalOpen, setAssignManagerModalOpen] = useState(false);
  const [assignManagerTarget, setAssignManagerTarget] = useState<Employee | null>(null);
  const [assignManagerValue, setAssignManagerValue] = useState('');
  const [assigningManager, setAssigningManager] = useState(false);

  // Bulk import (CSV onboarding) modal — admin only, like Add Employee
  const [importModalOpen, setImportModalOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await employeeApi.list({ search, branch, department, limit: 500 });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      toast.error('Failed to load employees');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, branch, department]);

  // Load geofences for dropdown
  const loadGeofences = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/geofences');
      const data = await res.json();
      setGeofences(data.geofences || []);
    } catch (err) {
      console.error('[Employees] Failed to load geofences:', err);
    }
  }, []);

  useEffect(() => {
    loadGeofences();
  }, [loadGeofences]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce search
    return () => clearTimeout(t);
  }, [load]);

  useSSE(
    useCallback(
      (event) => {
        if (event.type === 'entity_event' && event.entity === 'Employee') load();
      },
      [load],
    ),
  );

  const branches = [...new Set(items.map((e) => e.branch))];
  const departments = [...new Set(items.map((e) => e.department))];

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditing(emp);
    setForm({
      firstName: emp.firstName,
      surname: emp.surname,
      email: emp.email,
      position: emp.position ?? '',
      role: emp.role,
      branch: emp.branch,
      department: emp.department,
      employeeNumber: emp.employeeNumber ?? '',
      phone: emp.phone ?? '',
      managerId: emp.managerId ?? '',
    });
    const geofenceId = (emp as any).geofenceId || (emp as any).geofence_id || null;
    setFormGeofenceId(geofenceId);
    setModalOpen(true);
  };

  // Load manager options from dedicated endpoint (admin only)
  const loadManagers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await employeeApi.listManagers();
      setManagerOptions(res.managers || []);
    } catch (err) {
      console.error('[Employees] Failed to load manager options:', err);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadManagers();
  }, [loadManagers]);

  const getManagerName = (emp: Employee): string => {
    if (!emp.managerId) return '—';
    // Use the included manager relation from the API response
    if (emp.manager) return `${emp.manager.firstName} ${emp.manager.surname}`;
    // Fallback: look up in the loaded items
    const mgr = items.find((e) => e.id === emp.managerId);
    return mgr ? `${mgr.firstName} ${mgr.surname}` : '—';
  };

  // Open the dedicated "Assign Manager" modal
  const openAssignManager = (emp: Employee) => {
    setAssignManagerTarget(emp);
    setAssignManagerValue(emp.managerId ?? '');
    setAssignManagerModalOpen(true);
  };

  // Save manager assignment from the dedicated modal
  const handleAssignManager = async () => {
    if (!assignManagerTarget) return;
    setAssigningManager(true);
    try {
      await employeeApi.update(assignManagerTarget.id, {
        managerId: assignManagerValue || null,
        version: assignManagerTarget.version,
      });
      const mgrName = assignManagerValue
        ? managerOptions.find((m) => m.id === assignManagerValue)
        : null;
      toast.success(
        mgrName
          ? `${assignManagerTarget.firstName} ${assignManagerTarget.surname} assigned to ${mgrName.firstName} ${mgrName.surname}`
          : `Manager unassigned for ${assignManagerTarget.firstName} ${assignManagerTarget.surname}`,
      );
      setAssignManagerModalOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Manager assignment failed');
    } finally {
      setAssigningManager(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        firstName: form.firstName,
        surname: form.surname,
        email: form.email,
        position: form.position || null,
        role: form.role,
        branch: form.branch,
        department: form.department,
        employeeNumber: form.employeeNumber || null,
        phone: form.phone || null,
      };
      // Admin controls manager assignment (assign or move employee between managers)
      if (isAdmin) {
        payload.managerId = form.managerId || null;
      }
      // Include geofence assignment if admin/master
      if (formGeofenceId) {
        payload.geofenceId = formGeofenceId;
      } else if (formGeofenceId === null && editing) {
        // Clear geofence assignment
        payload.geofenceId = null;
      }
      if (editing) {
        await employeeApi.update(editing.id, { ...payload, version: editing.version });
        toast.success('Employee updated');
      } else {
        await employeeApi.create(payload);
        toast.success('Employee created');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (emp: Employee) => {
    if (!confirm(`Reset password for ${emp.firstName} ${emp.surname}? Their password will be set to the temporary password "Password123". On next login they can set a new password or keep it.`)) return;
    try {
      const res = await employeeApi.resetPassword(emp.id);
      toast.success(res.message);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Password reset failed');
    }
  };

  // Reset password from within the Edit modal (admin only)
  const [resettingInModal, setResettingInModal] = useState(false);
  const handleResetPasswordInModal = async () => {
    if (!editing) return;
    if (!confirm(`Reset password for ${editing.firstName} ${editing.surname}? Their password will be set to the temporary password "Password123". On next login they can set a new password or keep it.`)) return;
    setResettingInModal(true);
    try {
      const res = await employeeApi.resetPassword(editing.id);
      toast.success(res.message);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Password reset failed');
    } finally {
      setResettingInModal(false);
    }
  };

  const handleDelete = async (emp: Employee) => {
    if (!confirm(`Terminate ${emp.firstName} ${emp.surname}? Their record and history will be kept, but they will be marked as terminated.`)) return;
    try {
      await employeeApi.remove(emp.id);
      toast.success('Employee terminated (record kept)');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Delete failed');
    }
  };

  const handleReactivate = async (emp: Employee) => {
    if (!confirm(`Reactivate ${emp.firstName} ${emp.surname}? Their account will be restored to active status and they will be able to log in again.`)) return;
    try {
      const res = await employeeApi.reactivate(emp.id);
      toast.success(res.message);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Reactivation failed');
    }
  };

  const roleBadgeVariant = (role: string) => {
    switch (role) {
      case 'master': return 'default';
      case 'admin': return 'destructive';
      case 'manager': return 'warning';
      default: return 'secondary';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-5 h-5 text-brand" />
            <h1 className="text-2xl font-bold">Workforce Directory</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {total} employees · {branches.length} branches · {departments.length} departments
          </p>
        </div>
        {canAddEmployee && (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setImportModalOpen(true)}
              className="rounded-xl"
              title="Bulk onboard employees from a CSV file"
            >
              <Upload className="h-4 w-4" /> Import Employees
            </Button>
            <Button
              onClick={openCreate}
              className="bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20 rounded-xl"
            >
              <Plus className="h-4 w-4" /> Add Employee
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <Card className="border-border/50">
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="emp-search">Search</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="emp-search"
                className="pl-9"
                placeholder="Name, email or position…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="emp-branch">Branch</Label>
            <Select id="emp-branch" className="mt-1 w-44" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="emp-dept">Department</Label>
            <Select id="emp-dept" className="mt-1 w-44" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-border/50 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-48 items-center justify-center"><Spinner className="h-8 w-8" /></div>
          ) : items.length === 0 ? (
            <EmptyState message="No employees found matching your criteria" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/30">
                  <TableHead>Employee</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Department</TableHead>
                  {isAdmin && <TableHead>Manager</TableHead>}
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hired</TableHead>
                  {canManage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((emp, idx) => (
                  <motion.tr
                    key={emp.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                    className="border-b transition-colors hover:bg-muted/50"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={`${emp.firstName} ${emp.surname}`} size="sm" />
                        <div>
                          <p className="font-medium text-sm">{emp.firstName} {emp.surname}</p>
                          <p className="text-xs text-muted-foreground">{emp.email}</p>
                          {emp.hasLoginAccount === false && (
                            <p className="text-xs font-semibold text-red-600 dark:text-red-400 mt-0.5" title="This employee is visible in Workforce but has no login account — they cannot sign in.">
                              ⚠ No login account
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{emp.position || '—'}</TableCell>
                    <TableCell className="text-sm">{emp.branch}</TableCell>
                    <TableCell className="text-sm">{emp.department}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-sm text-muted-foreground">{getManagerName(emp)}</TableCell>
                    )}
                    <TableCell>
                      <Badge variant={roleBadgeVariant(emp.role)} className="capitalize">
                        {emp.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={emp.status === 'active' ? 'success' : emp.status === 'suspended' ? 'warning' : 'destructive'} className="capitalize">
                        {emp.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(emp.hireDate)}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openAssignManager(emp)}
                              aria-label="Assign manager"
                              title="Assign / change manager"
                              className="h-8 w-8"
                            >
                              <UserCog className="h-3.5 w-3.5 text-brand" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => openEdit(emp)} aria-label="Edit" className="h-8 w-8">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {canAddEmployee && (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => handleResetPassword(emp)} aria-label="Reset password" title="Reset password" className="h-8 w-8">
                                <KeyRound className="h-3.5 w-3.5 text-brand" />
                              </Button>
                              {emp.status === 'terminated' ? (
                                <Button variant="ghost" size="icon" onClick={() => handleReactivate(emp)} aria-label="Reactivate" title="Reactivate employee" className="h-8 w-8 hover:bg-emerald-500/10">
                                  <RotateCcw className="h-3.5 w-3.5 text-emerald-600" />
                                </Button>
                              ) : (
                                <Button variant="ghost" size="icon" onClick={() => handleDelete(emp)} aria-label="Delete" className="h-8 w-8 hover:bg-destructive/10">
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Employee' : 'Add Employee'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="f-first">First name</Label>
              <Input id="f-first" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-surname">Surname</Label>
              <Input id="f-surname" required value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="f-email">Email</Label>
            <Input id="f-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="f-position">Position</Label>
              <Input id="f-position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-number">Employee #</Label>
              <Input id="f-number" value={form.employeeNumber} onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="f-branch">Branch</Label>
              <Input id="f-branch" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-dept">Department</Label>
              <Input id="f-dept" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
          </div>
          {isAdmin && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="f-role">Role</Label>
                <Select id="f-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="f-phone">Phone</Label>
                <Input id="f-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
          )}

          {/* Manager Assignment (Admin only — assign or move employee between managers) */}
          {isAdmin && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <div className="flex items-center gap-2">
                <UserCog className="w-4 h-4 text-brand" />
                <Label htmlFor="f-manager" className="text-sm font-semibold text-slate-700">Assigned Manager</Label>
              </div>
              <Select
                id="f-manager"
                value={form.managerId}
                onChange={(e) => setForm({ ...form, managerId: e.target.value })}
              >
                <option value="">— No manager assigned —</option>
                {managerOptions.map((mgr) => (
                  <option key={mgr.id} value={mgr.id}>
                    {mgr.firstName} {mgr.surname} ({mgr.role} · {mgr.branch})
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Controls which manager this employee reports to. The manager's scope determines who can view and manage
                this employee's shifts, time entries and profile. Change this to move the employee to a different manager.
              </p>
            </div>
          )}

          {/* Reset Password (Admin only — available when editing an existing employee) */}
          {isAdmin && editing && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-brand" />
                <Label className="text-sm font-semibold text-slate-700">Password</Label>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleResetPasswordInModal}
                disabled={resettingInModal}
                className="w-full justify-center gap-2"
              >
                <KeyRound className="h-4 w-4" />
                {resettingInModal ? 'Resetting…' : 'Reset Password to Password123'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Resets this employee's login password to the temporary password{' '}
                <span className="font-semibold">Password123</span>. On their next login they can
                set a new password or keep this one. Use this when an employee contacts you
                because they forgot their password.
              </p>
            </div>
          )}

          {/* Geofence Assignment (Admin and Manager — managers can change location of their supervised employees) */}
          {canManage && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-500" />
                <Label htmlFor="f-geofence" className="text-sm font-semibold text-slate-700">Work Location (Geofence)</Label>
              </div>
              <Select
                id="f-geofence"
                value={formGeofenceId ?? ''}
                onChange={(e) => setFormGeofenceId(e.target.value || null)}
              >
                <option value="">— No geofence assigned —</option>
                {geofences.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.address || 'No address'}) ⌀ radius
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Assign this employee to a work location for automatic clock-in validation. Employees can only clock in when within the geofence radius.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create employee'}</Button>
          </div>
        </form>
      </Modal>

      {/* Assign Manager modal (Admin only) */}
      <Modal
        open={assignManagerModalOpen}
        onClose={() => setAssignManagerModalOpen(false)}
        title="Assign Manager"
      >
        {assignManagerTarget && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-secondary/40 rounded-lg">
              <Avatar name={`${assignManagerTarget.firstName} ${assignManagerTarget.surname}`} size="sm" />
              <div>
                <p className="font-medium text-sm">{assignManagerTarget.firstName} {assignManagerTarget.surname}</p>
                <p className="text-xs text-muted-foreground">
                  {assignManagerTarget.position || 'No position'} · {assignManagerTarget.branch} · {assignManagerTarget.department}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="assign-manager-select">Reporting Manager</Label>
              <Select
                id="assign-manager-select"
                value={assignManagerValue}
                onChange={(e) => setAssignManagerValue(e.target.value)}
              >
                <option value="">— No manager assigned —</option>
                {managerOptions
                  .filter((m) => m.id !== assignManagerTarget.id)
                  .map((mgr) => (
                    <option key={mgr.id} value={mgr.id}>
                      {mgr.firstName} {mgr.surname} ({mgr.role} · {mgr.branch})
                    </option>
                  ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Select which manager this employee reports to. The assigned manager can view and manage
                this employee's shifts, time entries, and profile. Changing this moves the employee
                to the new manager's scope. The change is recorded in the audit log and employment history.
              </p>
            </div>

            {assignManagerTarget.managerId && assignManagerValue !== assignManagerTarget.managerId && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                ⚠️ This will move <strong>{assignManagerTarget.firstName}</strong> from{' '}
                <strong>{getManagerName(assignManagerTarget)}</strong> to{' '}
                <strong>{managerOptions.find((m) => m.id === assignManagerValue)?.firstName ?? ''}{' '}
                {managerOptions.find((m) => m.id === assignManagerValue)?.surname ?? 'Unassigned'}</strong>.
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAssignManagerModalOpen(false)}>Cancel</Button>
              <Button onClick={handleAssignManager} disabled={assigningManager}>
                {assigningManager ? 'Assigning…' : 'Save Assignment'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
      {/* Bulk Import (CSV onboarding) modal — Admin only */}
      <ImportEmployeesModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onDone={load}
      />
    </div>
  );
}
