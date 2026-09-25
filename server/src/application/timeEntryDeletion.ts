/**
 * Time-Entry Deletion use case (Feature Spec §5)
 * ==============================================
 * Extracted from application/attendance.ts (Open-09 LOC ratchet: that module was
 * 1006 lines against a 700-line ceiling) and extended with the employee
 * self-delete rule.
 *
 * Authorization layers, in order:
 *   1. Tenant match      — the entry must belong to the caller's tenant.
 *   2. Company access    — non-master callers cannot cross company profiles.
 *   3. Manager scope     — a manager may only touch their direct reports.
 *   4. §5 self-service   — an employee may delete their OWN entry within
 *                          TIME_ENTRY_SELF_DELETE_WINDOW_HOURS (default 24 h),
 *                          unless it is open, manager-corrected, or payroll-locked.
 *
 * Layers 1-3 are unchanged from the original implementation; layer 4 is new and
 * is pure logic in domain/deletionRules.ts.
 */

import prisma from '../prisma.js';
import type { AuthUser } from '../middleware/auth.js';
import { logAudit } from '../audit.js';
import { broadcastScoped } from '../sse.js';
import { assertTenantMatch } from '../tenantContext.js';
import {
  AttendanceUseCaseError,
  assertEmployeeAccess,
  assertManagerEmployeeScope,
} from './attendance.js';
import { evaluateTimeEntryDeletion, getSelfDeleteWindowHours } from '../domain/deletionRules.js';

export interface DeleteTimeEntryCommand {
  actor: AuthUser;
  id: string;
  clientIp: string;
}

/**
 * True when a finalized payroll snapshot already covers this entry's date for
 * this employee. Snapshots are written by POST /reports/payroll/snapshot and
 * are the tenant's declaration that a period has been paid — deleting time
 * inside one would silently desynchronize payroll from attendance.
 *
 * Fail-open on error: a snapshot lookup must never make an otherwise-legal
 * deletion impossible, and the 24 h window already bounds the blast radius.
 */
async function isPayrollLocked(entry: {
  date: Date;
  employeeId: string | null;
  employeeEmail: string;
  companyProfileId: string;
}): Promise<boolean> {
  try {
    const snapshot = await prisma.payrollPeriodSnapshot.findFirst({
      where: {
        companyProfileId: entry.companyProfileId,
        periodFrom: { lte: entry.date },
        periodTo: { gte: entry.date },
        ...(entry.employeeId
          ? { employeeId: entry.employeeId }
          : { employeeEmail: { equals: entry.employeeEmail, mode: 'insensitive' } }),
      },
      select: { id: true },
    });
    return snapshot !== null;
  } catch {
    return false;
  }
}

export async function deleteTimeEntry(command: DeleteTimeEntryCommand): Promise<{ id: string }> {
  const existing = await prisma.timeEntry.findUnique({ where: { id: command.id } });
  if (!existing) {
    throw new AttendanceUseCaseError('Time entry not found.', { status: 404, code: 'NOT_FOUND' });
  }

  assertTenantMatch(existing);
  assertEmployeeAccess(command.actor, existing.companyProfileId);
  // No-op unless the actor is a manager; keeps the original scope guarantee.
  await assertManagerEmployeeScope(command.actor, existing.employeeEmail);

  // ── §5 self-service rule (new) ──
  const payrollLocked = await isPayrollLocked(existing);
  const verdict = evaluateTimeEntryDeletion({
    actorRole: command.actor.role,
    actorEmail: command.actor.email,
    entryEmployeeEmail: existing.employeeEmail,
    entryStatus: existing.status,
    entryCreatedAt: existing.createdAt,
    entryIsManuallyAdjusted: existing.isManuallyAdjusted,
    entryIsManualOverride: existing.isManualOverride,
    payrollLocked,
    now: new Date(),
    windowHours: getSelfDeleteWindowHours(),
  });
  if (!verdict.allowed) {
    throw new AttendanceUseCaseError(verdict.message, {
      status: verdict.status,
      code: verdict.code,
    });
  }

  await prisma.timeEntry.delete({ where: { id: command.id } });

  await logAudit({
    entity: 'TimeEntry',
    entityId: command.id,
    action: 'delete',
    actorId: command.actor.id,
    actorEmail: command.actor.email,
    actorRole: command.actor.role,
    // Distinguish a self-correction from a manager deletion in the audit trail:
    // they carry very different weight in a payroll dispute.
    justification: verdict.selfService
      ? `Self-deleted own time entry within ${getSelfDeleteWindowHours()}h window`
      : `Deleted time entry for ${existing.employeeEmail}`,
    ipAddress: command.clientIp,
    branch: existing.branch,
    department: existing.department,
    changes: {
      employee_email: { before: existing.employeeEmail, after: null },
      employee_name: { before: existing.employeeName, after: null },
      date: { before: existing.date.toISOString().slice(0, 10), after: null },
      clock_in: { before: existing.clockIn.toISOString(), after: null },
      clock_out: { before: existing.clockOut?.toISOString() ?? null, after: null },
      total_hours: { before: existing.totalHours, after: null },
      status: { before: existing.status, after: null },
      is_manual_override: { before: existing.isManualOverride, after: null },
    },
    required: true,
  });

  broadcastScoped(
    'timeEntry',
    'delete',
    { id: command.id },
    {
      companyProfileId: existing.companyProfileId,
      branch: existing.branch,
      department: existing.department,
    },
  );

  return { id: command.id };
}

export interface ResolveDuplicateCommand {
  actor: AuthUser;
  /** The FLAGGED (newer, artefact) entry to discard. */
  id: string;
  clientIp: string;
}

/**
 * Resolve a flagged duplicate punch — "Option A: keep the first punch".
 *
 * The flagged row is the artefact; the row named by `duplicateOfId` (the earlier
 * clock-in) is the survivor and is left untouched. Restricted to admin/manager/
 * master: resolution destroys a payroll-relevant row, so it is a supervisory
 * action, not employee self-service. Employees see the warning and ask a manager.
 *
 * "Option B: manually adjust both" needs no new endpoint — it is the existing
 * PUT /time-entries/:id adjustment flow applied to each row, followed by this
 * call to clear the flag on the survivor if desired.
 */
export async function resolveDuplicatePunch(
  command: ResolveDuplicateCommand,
): Promise<{ deleted: string; kept: string | null }> {
  const flagged = await prisma.timeEntry.findUnique({ where: { id: command.id } });
  if (!flagged) {
    throw new AttendanceUseCaseError('Time entry not found.', { status: 404, code: 'NOT_FOUND' });
  }

  assertTenantMatch(flagged);
  assertEmployeeAccess(command.actor, flagged.companyProfileId);
  await assertManagerEmployeeScope(command.actor, flagged.employeeEmail);

  if (!['admin', 'manager', 'master'].includes(command.actor.role)) {
    throw new AttendanceUseCaseError(
      'Only a manager or administrator can resolve a duplicate punch.',
      { status: 403, code: 'ACCESS_DENIED' },
    );
  }

  if (!flagged.isFlaggedDuplicate) {
    throw new AttendanceUseCaseError('This entry is not flagged as a duplicate punch.', {
      status: 409,
      code: 'NOT_DUPLICATE',
    });
  }

  const keptId = flagged.duplicateOfId;

  await prisma.timeEntry.delete({ where: { id: command.id } });

  await logAudit({
    entity: 'TimeEntry',
    entityId: command.id,
    action: 'resolve_duplicate',
    actorId: command.actor.id,
    actorEmail: command.actor.email,
    actorRole: command.actor.role,
    justification: `Resolved duplicate punch for ${flagged.employeeEmail} — discarded the later entry, kept ${keptId ?? 'the surviving punch'}`,
    ipAddress: command.clientIp,
    branch: flagged.branch,
    department: flagged.department,
    changes: {
      is_flagged_duplicate: { before: true, after: null },
      duplicate_of: { before: keptId, after: null },
      clock_in: { before: flagged.clockIn.toISOString(), after: null },
      clock_out: { before: flagged.clockOut?.toISOString() ?? null, after: null },
    },
    required: true,
  });

  broadcastScoped(
    'timeEntry',
    'resolveDuplicate',
    { id: command.id, kept: keptId },
    {
      companyProfileId: flagged.companyProfileId,
      branch: flagged.branch,
      department: flagged.department,
    },
  );

  return { deleted: command.id, kept: keptId };
}
