/**
 * Select the automatic clocking ownership model at runtime.
 *
 * Hybrid model (2026-09): the web geofence monitor is the PRIMARY foreground
 * auto-clock path — in plain browsers AND inside the React Native WebView
 * shell. It is the proven high-success-rate path that punches as soon as the
 * employee opens TimeTrack on site. Inside the shell the native background
 * location task keeps running as the BACKUP for closed/locked/backgrounded
 * states, covering the residual cases the foreground web monitor cannot see.
 *
 * Both punch paths are idempotent server-side (partial unique index +
 * 409 ALREADY_CLOCKED_IN, plus the reclock guard), and both clients treat
 * those responses as "already clocked" — so a simultaneous web+native punch
 * is safe and resolves to a single time entry.
 */
export type AutoClockRuntime = 'disabled' | 'web' | 'hybrid';

export function getAutoClockRuntime(
  enabled: boolean,
  nativeShellPresent: boolean,
): AutoClockRuntime {
  if (!enabled) return 'disabled';
  return nativeShellPresent ? 'hybrid' : 'web';
}
