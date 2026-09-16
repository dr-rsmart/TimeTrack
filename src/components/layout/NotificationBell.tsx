/**
 * Notification Centre (Feature #3)
 * --------------------------------
 * In-app bell + dropdown feed for managers/admins: employees who clocked in
 * late, clocked out early, no-shows and absences — surfaced inside the app
 * (no separate notification channel). Backed by GET /reports/attendance-alerts
 * and refreshed every 60s; unread state is a per-device "last seen" timestamp
 * persisted in localStorage so the badge survives reloads.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Clock, LogOut, RefreshCw, UserX, CalendarX2, Inbox } from 'lucide-react';
import { reportApi, type AttendanceAlert } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { cn, formatDate } from '../../lib/utils';

const LAST_SEEN_KEY = 'tt-notification-centre-last-seen';
const POLL_INTERVAL_MS = 60_000;

const TYPE_META: Record<
  AttendanceAlert['type'],
  { icon: typeof Clock; label: string; className: string }
> = {
  late_clock_in: { icon: Clock, label: 'Late clock-in', className: 'text-amber-500' },
  early_clock_out: { icon: LogOut, label: 'Early clock-out', className: 'text-orange-500' },
  no_show: { icon: CalendarX2, label: 'No-show', className: 'text-red-500' },
  absence: { icon: UserX, label: 'Absence', className: 'text-rose-400' },
};

const SEVERITY_DOT: Record<AttendanceAlert['severity'], string> = {
  info: 'bg-sky-400',
  warning: 'bg-amber-400',
  critical: 'bg-red-500',
};

export default function NotificationBell() {
  const { user } = useAuth();
  const isManager = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'master';

  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AttendanceAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!isManager) return;
    setLoading(true);
    try {
      const res = await reportApi.attendanceAlerts(7);
      setAlerts(res.alerts);
      const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
      // Alert dates are YYYY-MM-DD; anything dated strictly after the last-seen
      // day counts as unread (day granularity keeps the badge honest).
      const seenDay = lastSeen ? lastSeen.slice(0, 10) : null;
      setUnread(seenDay ? res.alerts.filter((a) => a.date > seenDay).length : res.alerts.length);
    } catch {
      // Silent: the bell is an enhancement; never interrupt the app.
    } finally {
      setLoading(false);
    }
  }, [isManager]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Close the dropdown on outside clicks.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const markAllRead = () => {
    localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    setUnread(0);
  };

  if (!isManager) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        data-testid="notification-bell"
        aria-label="Notification centre"
        title="Notification centre — late-ins, early-outs, no-shows"
        className="relative flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span
            data-testid="notification-unread-badge"
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="notification-panel"
          className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[28rem] overflow-hidden rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-2xl z-50 flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
            <div>
              <p className="text-sm font-semibold">Notification Centre</p>
              <p className="text-[11px] text-muted-foreground">Attendance alerts · last 7 days</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => void load()}
                aria-label="Refresh alerts"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              </button>
              <button
                onClick={markAllRead}
                className="text-[11px] font-medium text-brand hover:underline px-1"
              >
                Mark all read
              </button>
            </div>
          </div>

          <div className="overflow-y-auto flex-1">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Inbox className="w-6 h-6 mb-2 opacity-50" />
                <p className="text-xs">No attendance alerts — everything is on time.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/30">
                {alerts.slice(0, 50).map((alert) => {
                  const meta = TYPE_META[alert.type];
                  const Icon = meta.icon;
                  return (
                    <li key={alert.id} className="px-4 py-2.5 flex items-start gap-3">
                      <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', meta.className)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium leading-snug">{alert.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {meta.label} · {formatDate(alert.date)}
                          {alert.branch ? ` · ${alert.branch}` : ''}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'w-2 h-2 rounded-full mt-1 shrink-0',
                          SEVERITY_DOT[alert.severity],
                        )}
                        title={alert.severity}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
