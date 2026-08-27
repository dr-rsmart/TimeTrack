/**
 * ChangePasswordModal
 * -------------------
 * Password change dialog with server-enforced complexity rules.
 * When `forced` is true (account flagged with mustChangePassword), the modal
 * appears on login. The user can set a new password or keep the current one.
 */

import { useState, type FormEvent } from 'react';
import { ShieldAlert, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { authApi, ApiError, suppressUnauthenticatedErrors } from '../../services/api';
import { Button, Input, Label } from '../ui';
import { useAuth } from '../../context/AuthContext';

interface ChangePasswordModalProps {
  /** When true, the modal is mandatory (mustChangePassword flag). */
  forced?: boolean;
  /**
   * When false (account still on the default password), the "keep current
   * password" escape hatch is hidden — the server rejects keep-password for
   * default-password accounts, so the UI must not offer it.
   */
  allowKeep?: boolean;
  /** Called after a successful password change or keep-password decision. */
  onSuccess: () => void;
  /** Called when the user cancels (only when not forced). */
  onCancel?: () => void;
}

const COMPLEXITY_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
];

export default function ChangePasswordModal({ forced = false, allowKeep = true, onSuccess, onCancel }: ChangePasswordModalProps) {
  const { endSessionAfterPasswordChange } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Keep the current password — clears the mustChangePassword flag without changing anything. */
  const handleKeepPassword = async () => {
    setError(null);
    setKeeping(true);
    try {
      await authApi.keepPassword();
      toast.success('Keeping your current password');
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to keep current password');
    } finally {
      setKeeping(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    const failedRule = COMPLEXITY_RULES.find((r) => !r.test(newPassword));
    if (failedRule) {
      setError(`Password requirement missing: ${failedRule.label.toLowerCase()}.`);
      return;
    }

    setSaving(true);
    // Suppress 401 session banners around the rotation: on success the epoch
    // bump makes this session's cookie stale (expected), and on failure the
    // wrong-current-password reply must stay an inline modal error.
    const restore = suppressUnauthenticatedErrors();
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast.success('Password updated successfully');
      // End the revoked session voluntarily so the user lands on a friendly
      // "sign in with your new password" notice instead of a raw kick-out.
      await endSessionAfterPasswordChange();
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        setError(err.details.map((d) => d.message).join(' '));
      } else {
        setError(err instanceof ApiError ? err.message : 'Password change failed');
      }
    } finally {
      setSaving(false);
      restore();
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/60" />
      <div className="relative flex min-h-full items-center justify-center p-4">
        <div className="z-10 w-full max-w-md rounded-xl border bg-background p-6 shadow-xl">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
              {forced ? (
                <ShieldAlert className="h-5 w-5 text-amber-600" />
              ) : (
                <KeyRound className="h-5 w-5 text-brand" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold">
                {forced ? 'Password Change Required' : 'Change Password'}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {forced
                  ? 'Your account is using a default or reset password. Set a new, secure password — or keep the current one.'
                  : 'Choose a strong new password for your account.'}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cp-current">Current password</Label>
              <Input
                id="cp-current"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cp-new">New password</Label>
              <Input
                id="cp-new"
                type="password"
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              {/* Live complexity checklist */}
              <ul className="grid grid-cols-2 gap-1 pt-1">
                {COMPLEXITY_RULES.map((rule) => {
                  const ok = rule.test(newPassword);
                  return (
                    <li
                      key={rule.label}
                      className={`text-xs flex items-center gap-1.5 ${
                        ok ? 'text-emerald-600' : 'text-muted-foreground'
                      }`}
                    >
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                      {rule.label}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cp-confirm">Confirm new password</Label>
              <Input
                id="cp-confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-2 pt-2">
              {forced ? (
                allowKeep ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleKeepPassword}
                    disabled={saving || keeping}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {keeping ? 'Saving…' : 'Keep current password'}
                  </Button>
                ) : null
              ) : (
                <div>
                  {!forced && onCancel && (
                    <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
                      Cancel
                    </Button>
                  )}
                </div>
              )}
              <Button type="submit" disabled={saving || keeping}>
                {saving ? 'Updating…' : 'Update Password'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}