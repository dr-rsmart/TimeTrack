/**
 * Time-Entry Deletion Rules (Feature Spec §5) — Pure Logic Module
 * ===============================================================
 * Decides WHO may delete a time entry, and under what conditions.
 *
 * Before migration 23 the DELETE /time-entries/:id route was gated by
 * `requireAdminOrManager`, so an employee who fat-fingered a punch had no
 * self-service correction path — they had to phone a manager. Spec §5 asks for
 * a bounded self-delete: an employee may remove their OWN erroneous punch, but
 * only inside a short window, so finalized payroll stays trustworthy.
 *
 * The rules below are pure so they can be exhaustively unit-tested without a
 * database (tests/unit/deletionRules.test.ts). The use case in
 * application/timeEntryDeletion.ts supplies the facts and performs I/O.
 */

/** Self-service deletion window, in hours, from the entry's creation instant. */
export const SELF_DELETE_WINDOW_HOURS = 24;

/** Configurable override (ops may tighten it); 0 disables employee self-delete. */
export function getSelfDeleteWindowHours(): number {
  const raw = process.env.TIME_ENTRY_SELF_DELETE_WINDOW_HOURS;
  if (raw === undefined || raw === null || raw === '') return SELF_DELETE_WINDOW_HOURS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return SELF_DELETE_WINDOW_HOURS;
  return parsed;
}

/** Roles that manage others' time and are therefore exempt from the 24 h rule. */
const PRIVILEGED_ROLES = new Set(['admin', 'manager', 'master']);

export interface SelfDeleteFacts {
  actorRole: string;
  actorEmail: string;
  /** The entry's stored employee email (identity is email-keyed in this schema). */
  entryEmployeeEmail: string;
  /** Entry status: "active" entries are open sessions, not deletable history. */
  entryStatus: string;
  /** When the row was created — the clock the 24 h window runs against. */
  entryCreatedAt: Date;
  /** True when a manager/admin adjusted this entry after capture. */
  entryIsManuallyAdjusted: boolean;
  /** True when a manager/admin created this entry as a manual override. */
  entryIsManualOverride: boolean;
  /** True when a payroll snapshot already covers the entry's period. */
  payrollLocked: boolean;
  /** Evaluation instant (injected for testability). */
  now: Date;
  windowHours?: number;
}

export type DeletionVerdict =
  | { allowed: true; selfService: boolean }
  | { allowed: false; status: number; code: string; message: string };

function deny(status: number, code: string, message: string): DeletionVerdict {
  return { allowed: false, status, code, message };
}

/** Case-insensitive email comparison — emails are stored in mixed case. */
export function sameEmployee(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Is the actor inside the self-delete window for this entry?
 * Pure boundary logic, split out so the exact edge (== windowHours) is testable.
 * The window is half-open: an entry EXACTLY 24 h old is no longer deletable.
 */
export function isWithinSelfDeleteWindow(
  entryCreatedAt: Date,
  now: Date,
  windowHours: number,
): boolean {
  if (!Number.isFinite(windowHours) || windowHours <= 0) return false;
  const ageMs = now.getTime() - entryCreatedAt.getTime();
  if (!Number.isFinite(ageMs)) return false;
  // A negative age means a future-dated createdAt (clock skew or backfill);
  // treat it as inside the window rather than silently allowing a stale delete.
  if (ageMs < 0) return true;
  return ageMs < windowHours * 60 * 60 * 1000;
}

/**
 * Full verdict for a delete attempt.
 *
 * Privileged roles (admin/manager/master) are NOT re-authorized here — tenant
 * match and manager-scope assertions remain the use case's job (they need the
 * live employee record). This function only answers the §5 self-service question.
 */
export function evaluateTimeEntryDeletion(facts: SelfDeleteFacts): DeletionVerdict {
  const windowHours = facts.windowHours ?? SELF_DELETE_WINDOW_HOURS;

  // Managers/admins/master bypass the self-service constraints entirely.
  if (PRIVILEGED_ROLES.has(facts.actorRole)) {
    return { allowed: true, selfService: false };
  }

  // ── Employee self-service path ──
  if (!sameEmployee(facts.actorEmail, facts.entryEmployeeEmail)) {
    return deny(403, 'ACCESS_DENIED', 'You can only delete your own time entries.');
  }

  // Deleting an OPEN session would silently discard worked time and bypass the
  // clock-out path (including the working-hours auto-close). Use Clock Out.
  if (facts.entryStatus === 'active') {
    return deny(
      409,
      'ACTIVE_SESSION',
      'This session is still open. Clock out instead of deleting it.',
    );
  }

  // Never let an employee undo a correction a manager made on their behalf —
  // that is how payroll disputes start. They must ask the manager to revisit it.
  if (facts.entryIsManuallyAdjusted || facts.entryIsManualOverride) {
    return deny(
      403,
      'MANAGER_ADJUSTED',
      'This entry was corrected by a manager and cannot be deleted by you. Please contact your manager.',
    );
  }

  if (facts.payrollLocked) {
    return deny(
      409,
      'PAYROLL_LOCKED',
      'This entry is inside a finalized payroll period and can no longer be deleted.',
    );
  }

  if (!isWithinSelfDeleteWindow(facts.entryCreatedAt, facts.now, windowHours)) {
    return deny(
      403,
      'SELF_DELETE_WINDOW_EXPIRED',
      `You can only delete your own entries within ${windowHours} hours of clocking in. Ask a manager to correct older entries.`,
    );
  }

  return { allowed: true, selfService: true };
}
