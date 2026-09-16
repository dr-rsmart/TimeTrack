/**
 * AutoClockStatusNote — presentational explanation banner
 * --------------------------------------------------------
 * Renders the resolved reason why an automatic clock-in has not fired while
 * the employee is inside their geofence (see utils/autoClockStatus.ts).
 * Purely presentational: all reasoning happens in the pure helper so the
 * ladder stays unit-testable without a DOM.
 */

import type { ResolvedAutoClockStatus, AutoClockStatusTone } from '../../utils/autoClockStatus';

const toneClasses: Record<AutoClockStatusTone, string> = {
  muted: 'bg-slate-50 border-slate-200 text-slate-600',
  info: 'bg-blue-50 border-blue-200 text-blue-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-700',
  danger: 'bg-red-50 border-red-200 text-red-700',
};

export function AutoClockStatusNote({ status }: { status: ResolvedAutoClockStatus }) {
  return (
    <div className={`rounded-lg border p-2.5 ${toneClasses[status.tone]}`} role="status">
      <p className="text-xs font-semibold">{status.title}</p>
      <p className="text-xs mt-0.5 opacity-90">{status.detail}</p>
    </div>
  );
}
