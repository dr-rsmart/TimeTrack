import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { remove, toastSuccess, toastError } = vi.hoisted(() => ({
  remove: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'mgr@test', role: 'manager', businessTimezone: 'UTC' } }),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('../../../services/api', async (orig) => {
  const actual = await orig<typeof import('../../../services/api')>();
  return { ...actual, timeEntryApi: { ...actual.timeEntryApi, remove } };
});

import EditTimeEntryModal from '../EditTimeEntryModal';
import type { TimeEntry } from '../../../services/api';

const entry = {
  id: 'dup-1',
  employeeEmail: 'jane@test',
  employeeName: 'Jane Doe',
  date: '2026-09-28T12:00:00.000Z',
  clockIn: '2026-09-28T08:02:00.000Z',
  clockOut: '2026-09-28T08:03:00.000Z',
  breakMinutes: 0,
  totalHours: 0.02,
  status: 'completed',
  isFlaggedDuplicate: true,
} as unknown as TimeEntry;

beforeEach(() => {
  remove.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('EditTimeEntryModal — delete entry (double clock-in)', () => {
  it('deletes the entry, refreshes the parent and closes', async () => {
    remove.mockResolvedValue({ success: true, deleted: 'dup-1' });
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(<EditTimeEntryModal open entry={entry} onClose={onClose} onDone={onDone} />);

    fireEvent.click(screen.getByTestId('edit-modal-delete-entry'));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('dup-1'));
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Time entry deleted for Jane Doe');
  });

  it('does nothing when the confirmation is cancelled', () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    render(<EditTimeEntryModal open entry={entry} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('edit-modal-delete-entry'));
    expect(remove).not.toHaveBeenCalled();
  });

  it('surfaces the server refusal and keeps the modal open', async () => {
    const { ApiError } = await import('../../../services/api');
    remove.mockRejectedValue(new ApiError('This employee is outside your management scope.', 403));
    const onClose = vi.fn();
    render(<EditTimeEntryModal open entry={entry} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('edit-modal-delete-entry'));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('This employee is outside your management scope.'),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hides delete for an open (active) session — it must be clocked out instead', () => {
    render(
      <EditTimeEntryModal
        open
        entry={{ ...entry, status: 'active', clockOut: null } as TimeEntry}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('edit-modal-delete-entry')).toBeNull();
  });
});
