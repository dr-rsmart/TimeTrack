/**
 * Bulk Shift Toolbar (Feature Spec §5)
 * ====================================
 * Multi-select bulk EDIT and bulk DELETE for the Shifts list. Previously only
 * bulk create existed, so re-scheduling a fortnight meant one dialog per shift.
 *
 * Extracted into its own component (rather than inlined in Shifts.tsx) because
 * that page is already well over the Open-09 700-line ratchet. This component
 * owns its own modals and API calls; the parent only owns the selection set.
 *
 * Both operations require a free-text `reason`, which the server writes to the
 * audit log — bulk mutations are high blast-radius and must be attributable.
 */

import { useState } from 'react';
import { Pencil, Trash2, X, CheckSquare } from 'lucide-react';
import { toast } from 'sonner';
import { shiftApi, ApiError } from '../../services/api';
import { SHIFT_STATUS, SHIFT_TYPE } from '../../../contracts/index.js';
import { Button, Input, Label, Modal, Select, Spinner, Textarea } from '../ui';

interface BulkShiftToolbarProps {
  /** Currently selected shift ids. */
  selectedIds: string[];
  /** Ids of the rows currently rendered — drives "select all". */
  visibleIds: string[];
  onSelectionChange: (ids: string[]) => void;
  /** Called after a successful mutation so the parent can reload. */
  onDone: () => void;
}

const EMPTY_EDIT = {
  startTime: '',
  endTime: '',
  shiftType: '',
  status: '',
  location: '',
  notes: '',
  skipOverlaps: false,
  reason: '',
};

export default function BulkShiftToolbar({
  selectedIds,
  visibleIds,
  onSelectionChange,
  onDone,
}: BulkShiftToolbarProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(EMPTY_EDIT);
  const [deleteReason, setDeleteReason] = useState('');

  const count = selectedIds.length;
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const toggleAll = () => {
    onSelectionChange(allVisibleSelected ? [] : [...visibleIds]);
  };

  const submitEdit = async () => {
    if (edit.reason.trim().length < 3) {
      toast.error('Please give a reason — bulk changes are audited.');
      return;
    }
    setBusy(true);
    try {
      // Only send fields the user actually filled in: an omitted field is left
      // untouched server-side, which is what makes a partial bulk edit safe.
      const res = await shiftApi.bulkEdit({
        ids: selectedIds,
        ...(edit.startTime ? { startTime: edit.startTime } : {}),
        ...(edit.endTime ? { endTime: edit.endTime } : {}),
        ...(edit.shiftType ? { shiftType: edit.shiftType } : {}),
        ...(edit.status ? { status: edit.status } : {}),
        ...(edit.location ? { location: edit.location } : {}),
        ...(edit.notes ? { notes: edit.notes } : {}),
        skipOverlaps: edit.skipOverlaps,
        reason: edit.reason.trim(),
      });
      const parts = [`${res.updated} shift(s) updated`];
      if (res.skipped > 0) parts.push(`${res.skipped} skipped`);
      if (res.outOfScope.length > 0) parts.push(`${res.outOfScope.length} outside your scope`);
      if (res.notFound.length > 0) parts.push(`${res.notFound.length} not found`);
      toast.success(parts.join(' · '));
      if (res.skipped > 0) {
        toast.warning(res.skippedDetails[0]?.reason ?? 'Some shifts were skipped.');
      }
      setEditOpen(false);
      setEdit(EMPTY_EDIT);
      onSelectionChange([]);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Bulk edit failed');
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    if (deleteReason.trim().length < 3) {
      toast.error('Please give a reason — bulk deletions are audited.');
      return;
    }
    setBusy(true);
    try {
      const res = await shiftApi.bulkDelete(selectedIds, deleteReason.trim());
      const parts = [`${res.deleted} shift(s) deleted`];
      if (res.outOfScope.length > 0) parts.push(`${res.outOfScope.length} outside your scope`);
      if (res.notFound.length > 0) parts.push(`${res.notFound.length} not found`);
      toast.success(parts.join(' · '));
      setDeleteOpen(false);
      setDeleteReason('');
      onSelectionChange([]);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Bulk delete failed');
    } finally {
      setBusy(false);
    }
  };

  if (count === 0) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="bulk-select-all"
        onClick={toggleAll}
        disabled={visibleIds.length === 0}
      >
        <CheckSquare className="h-4 w-4" /> Select all
      </Button>
    );
  }

  return (
    <>
      <div
        data-testid="bulk-shift-toolbar"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/40 bg-brand/5 px-3 py-2"
      >
        <span className="text-sm font-semibold">
          {count} shift{count === 1 ? '' : 's'} selected
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={toggleAll}>
            {allVisibleSelected ? 'Clear all' : 'Select all'}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="bulk-edit-shifts"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-4 w-4" /> Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            data-testid="bulk-delete-shifts"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear selection"
            onClick={() => onSelectionChange([])}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {/* ── Bulk edit modal ── */}
      <Modal
        open={editOpen}
        onClose={() => !busy && setEditOpen(false)}
        title={`Edit ${count} shift${count === 1 ? '' : 's'}`}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Leave a field blank to keep its current value. Every selected shift gets the same
            change.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bulk-start">Start time</Label>
              <Input
                id="bulk-start"
                type="time"
                value={edit.startTime}
                onChange={(e) => setEdit({ ...edit, startTime: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-end">End time</Label>
              <Input
                id="bulk-end"
                type="time"
                value={edit.endTime}
                onChange={(e) => setEdit({ ...edit, endTime: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-type">Shift type</Label>
              <Select
                id="bulk-type"
                value={edit.shiftType}
                onChange={(e) => setEdit({ ...edit, shiftType: e.target.value })}
              >
                <option value="">No change</option>
                {Object.values(SHIFT_TYPE).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-status">Status</Label>
              <Select
                id="bulk-status"
                value={edit.status}
                onChange={(e) => setEdit({ ...edit, status: e.target.value })}
              >
                <option value="">No change</option>
                {Object.values(SHIFT_STATUS).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bulk-location">Location</Label>
            <Input
              id="bulk-location"
              value={edit.location}
              onChange={(e) => setEdit({ ...edit, location: e.target.value })}
              placeholder="No change"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bulk-notes">Notes</Label>
            <Textarea
              id="bulk-notes"
              rows={2}
              value={edit.notes}
              onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
              placeholder="No change"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={edit.skipOverlaps}
              onChange={(e) => setEdit({ ...edit, skipOverlaps: e.target.checked })}
            />
            Skip overlap validation (allow clashes with existing shifts)
          </label>
          <div className="space-y-1">
            <Label htmlFor="bulk-reason">Reason (required, audited)</Label>
            <Textarea
              id="bulk-reason"
              rows={2}
              value={edit.reason}
              onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
              placeholder="e.g. Store trading hours moved to 09:00 for the week"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitEdit()}
              disabled={busy}
              data-testid="bulk-edit-submit"
            >
              {busy ? <Spinner className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {busy ? 'Updating…' : `Update ${count} shift${count === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      </Modal>
      {/* ── Bulk delete confirmation ── */}
      <Modal
        open={deleteOpen}
        onClose={() => !busy && setDeleteOpen(false)}
        title={`Delete ${count} shift${count === 1 ? '' : 's'}?`}
      >
        <div className="space-y-4">
          <p className="text-sm text-red-600 font-medium">
            This permanently removes {count} scheduled shift{count === 1 ? '' : 's'}. Employees lose
            the reminders and the auto clock-in/out window tied to them.
          </p>
          <div className="space-y-1">
            <Label htmlFor="bulk-delete-reason">Reason (required, audited)</Label>
            <Textarea
              id="bulk-delete-reason"
              rows={2}
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="e.g. Branch closed for stocktake — shifts created in error"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitDelete()}
              disabled={busy}
              data-testid="bulk-delete-submit"
            >
              {busy ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              {busy ? 'Deleting…' : `Delete ${count} shift${count === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
