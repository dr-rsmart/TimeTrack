/**
 * Duplicate Punch Detection (Feature Spec §7) — Pure Logic Module
 * ===============================================================
 * CORRECTIVE counterpart to `reclockGuard.ts`, which is PREVENTIVE.
 *
 * Why both exist
 * --------------
 * `reclockGuard` rejects a self-service clock-in that arrives within
 * RECLOCK_GUARD_SECONDS (default 120) of the employee's last clock-out. That
 * stops the common "clocked out, immediately clocked back in" client glitch —
 * but it deliberately does NOT cover every path, so duplicates still reach the
 * database:
 *
 *   - Manager/admin proxy punches (`manual`, `bulk-clock-in`) bypass the guard
 *     by design — an operator correcting a missed punch must not be blocked.
 *   - Offline outbox replays can arrive out of order and after the guard window
 *     has closed, yet still represent the same physical punch.
 *   - A geofence auto-clock firing alongside a manual tap on two devices.
 *
 * Rather than rejecting those (which would lose a legitimate punch), this module
 * FLAGS them: `TimeEntry.isFlaggedDuplicate = true` with `duplicateOfId`
 * pointing at the surviving entry. Payroll and the Notification Centre then
 * surface the pair for one-tap resolution.
 *
 * All functions are pure and side-effect free so they can be unit-tested
 * without a database (see tests/unit/duplicatePunch.test.ts).
 */

/**
 * Window (seconds) inside which two punches by the SAME employee for the SAME
 * punch kind are considered duplicates of one another.
 *
 * Defaults to 600 to match `RECLOCK_GUARD_SECONDS`, so the preventive and
 * corrective layers agree on what "a double punch" means. Configurable via
 * DUPLICATE_PUNCH_WINDOW_SECONDS; set to 0 to disable flagging entirely.
 *
 * DWELL WINDOW (Cycle 17): raised 120s -> 600s alongside the reclock guard.
 * The two constants are a preventive/corrective PAIR and must not drift: a
 * punch the guard lets through is precisely the punch this module has to
 * flag. At 120s a ~3-minute GPS bounce inside the fence was neither blocked
 * nor flagged and silently became a second session — the root cause of the
 * "multiple clock in/out while on site" reports.
 */
export const DEFAULT_DUPLICATE_WINDOW_SECONDS = 600;

export function getDuplicateWindowSeconds(): number {
  const raw = process.env.DUPLICATE_PUNCH_WINDOW_SECONDS;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_DUPLICATE_WINDOW_SECONDS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DUPLICATE_WINDOW_SECONDS;
  return Math.floor(parsed);
}

/** Which end of a session the punch represents. */
export type PunchKind = 'clock_in' | 'clock_out';

/**
 * Absolute gap in seconds between two punch instants.
 * Returns null when either side is missing/invalid so callers never have to
 * reason about NaN propagation into a comparison.
 */
export function punchGapSeconds(
  a: Date | null | undefined,
  b: Date | null | undefined,
): number | null {
  if (!a || !b) return null;
  const ms = Math.abs(a.getTime() - b.getTime());
  if (!Number.isFinite(ms)) return null;
  return ms / 1000;
}

/**
 * True when `candidate` duplicates `existing` — i.e. the two punches are the
 * same KIND for the same employee and fall within `windowSeconds` of each other.
 *
 * Deliberately strict about the boundaries:
 *   - A zero/negative window disables flagging (opt-out parity with reclockGuard).
 *   - A gap of EXACTLY windowSeconds is NOT a duplicate (half-open interval,
 *     matching `isWithinReclockWindow`'s `< guardSeconds * 1000`).
 *   - Order-independent: an offline replay may arrive with the OLDER punch
 *     second, so we compare absolute distance, not "candidate after existing".
 */
export function isDuplicatePunch(
  existing: Date | null | undefined,
  candidate: Date | null | undefined,
  windowSeconds: number,
): boolean {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return false;
  const gap = punchGapSeconds(existing, candidate);
  if (gap === null) return false;
  return gap < windowSeconds;
}

/**
 * Decide which of a duplicate pair SURVIVES when the employee/manager picks
 * "Option A — keep the first punch". The earliest clock-in is the trustworthy
 * one (the employee arrived then); the latest clock-out is the trustworthy one
 * (they left then). Anything else is the artefact.
 *
 * Returns the id to keep and the id to discard/merge.
 */
export function pickSurvivingEntry(
  kind: PunchKind,
  a: { id: string; at: Date },
  b: { id: string; at: Date },
): { keepId: string; discardId: string } {
  const aFirst = a.at.getTime() <= b.at.getTime();
  // clock_in → keep earliest; clock_out → keep latest.
  const keep = kind === 'clock_in' ? (aFirst ? a : b) : aFirst ? b : a;
  const discard = keep.id === a.id ? b : a;
  return { keepId: keep.id, discardId: discard.id };
}

/**
 * Classify a stored pair for display: how far apart they were, in seconds,
 * rounded to whole seconds (the UI shows "punched twice within Ns").
 * Returns null when the pair cannot be measured.
 */
export function describeDuplicateGap(
  a: Date | null | undefined,
  b: Date | null | undefined,
): number | null {
  const gap = punchGapSeconds(a, b);
  if (gap === null) return null;
  return Math.round(gap);
}
