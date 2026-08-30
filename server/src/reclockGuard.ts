/**
 * Re-clock-in protection (double clock-in/out prevention)
 * --------------------------------------------------------
 * Pure, dependency-free helpers shared by the clock-in route and unit tests.
 * See routes/timeEntries.ts where the guard is enforced on self-service
 * clock-ins.
 */

/**
 * Minimum seconds that must elapse after a clock-out before the SAME employee
 * can self-service clock in again. Prevents the "clocked out, immediately
 * clocked back in" double-punch pattern caused by client glitches (e.g. an
 * auto clock-in firing right after a manual clock-out) and gives a clear,
 * auditable error instead of a mysterious extra session.
 *
 * Configurable via RECLOCK_GUARD_SECONDS (default 120). Set to 0 to disable.
 * Admin/manager/master proxy punches (manual overrides) always bypass it.
 */
export function getReclockGuardSeconds(): number {
  const raw = process.env.RECLOCK_GUARD_SECONDS;
  if (raw === undefined || raw === null || raw === '') return 120;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 120;
  return Math.floor(parsed);
}

/**
 * Pure guard: true when `lastClockOut` is within `guardSeconds` of `now`
 * (i.e. the new clock-in must be rejected). A null lastClockOut (employee
 * has never clocked out) never blocks.
 */
export function isWithinReclockWindow(
  lastClockOut: Date | null,
  now: Date,
  guardSeconds: number,
): boolean {
  if (!lastClockOut || guardSeconds <= 0) return false;
  return now.getTime() - lastClockOut.getTime() < guardSeconds * 1000;
}