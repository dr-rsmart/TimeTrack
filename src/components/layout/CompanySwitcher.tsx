import { useCallback, useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { masterApi, type CompanyDetail } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Select } from '../ui';

/**
 * Spec §3 "multi-company dropdown for managers" (Option A).
 *
 * The platform has no user↔company membership table — a `User` belongs to ONE
 * `CompanyProfile`, and the only cross-tenant path is the `master` role's
 * impersonation JWT-swap (`POST /master/impersonate/:id`). This dropdown gives a
 * master operator a one-click way to enter any tenant directly from the header,
 * on top of the full company register in the Master Console.
 *
 * Only rendered when the current session is a *non-impersonating* master
 * (`user.role === 'master'`): while impersonating, the top banner already offers
 * "Return to Master Console".
 */
export default function CompanySwitcher() {
  const { user, refresh } = useAuth();
  const [companies, setCompanies] = useState<CompanyDetail[]>([]);
  const [busy, setBusy] = useState(false);

  const visible = user?.role === 'master' && user?.originalRole !== 'master';

  const loadCompanies = useCallback(async () => {
    try {
      const res = await masterApi.listCompanies();
      setCompanies(res.items.filter((c) => c.isActive));
    } catch {
      // Non-fatal: the Master Console register remains the full fallback.
    }
  }, []);

  useEffect(() => {
    if (visible) void loadCompanies();
  }, [visible, loadCompanies]);

  if (!visible) return null;

  const handleSwitch = async (id: string) => {
    if (!id || busy) return;
    setBusy(true);
    try {
      await masterApi.impersonate(id);
      await refresh();
      window.location.href = '/';
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to switch company');
      setBusy(false);
    }
  };

  return (
    <div className="hidden md:flex items-center gap-1.5" title="Switch company">
      <Building2 className="h-4 w-4 text-muted-foreground" />
      <Select
        aria-label="Switch company"
        value=""
        disabled={busy}
        onChange={(e) => void handleSwitch(e.target.value)}
        className="h-8 w-40 text-xs"
      >
        <option value="" disabled>
          {busy ? 'Switching…' : 'Switch company'}
        </option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
