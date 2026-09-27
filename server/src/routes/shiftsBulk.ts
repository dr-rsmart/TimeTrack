/**
 * Bulk Shift Operations (Feature Spec §5)
 * =======================================
 * `PATCH /shifts/bulk-edit`   — apply one change set to many shifts at once
 *                               (e.g. move a whole week from 08:00 to 09:00).
 * `POST  /shifts/bulk-delete` — delete many shifts at once.
 *
 * Previously only bulk CREATE existed (`POST /shifts/bulk`), so a manager who
 * mis-scheduled a fortnight had to edit 70 shifts one dialog at a time.
 *
 * Lives in its own module (not routes/shifts.ts) for two reasons: the Open-09
 * 700-line ratchet, and because bulk mutations deserve a single, reviewable
 * authorization path. Mounted from routes/shifts.ts so the public URLs stay
 * under /api/shifts/*.
 *
 * Safety model — every batch is partitioned before anything is written:
 *   tenant-scoped fetch  → ids belonging to another company are "not found"
 *                          (never disclosed as existing)
 *   manager scope        → direct reports only
 *   overlap validation   → skipped per-shift with a reason when it would clash
 * Nothing is mutated unless at least one shift survives all three filters, and
 * the whole mutation runs in a single transaction.
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../logger.js';
import prisma from '../prisma.js';
import { requireAdminOrManager } from '../middleware/auth.js';
import { isEmployeeInManagerScope } from '../middleware/scope.js';
import {
  validate,
  bulkEditShiftsSchema,
  bulkDeleteShiftsSchema,
  type BulkEditShifts,
  type BulkDeleteShifts,
} from '../validation.js';
import { logAudit, getClientIp } from '../audit.js';
import { broadcastScoped } from '../sse.js';
import { internalError, sendError } from '../errorResponse.js';
import { countOverlaps, type ShiftTimeWindow } from '../overlap.js';
import { tenantWhere } from '../tenantPolicy.js';

const router = Router();

type ShiftRow = {
  id: string;
  employeeId: string | null;
  employeeEmail: string | null;
  employeeName: string | null;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  shiftType: string;
  status: string;
  location: string | null;
  notes: string | null;
  branch: string | null;
  department: string | null;
  companyProfileId: string;
  version: number;
};

const SHIFT_SELECT = {
  id: true,
  employeeId: true,
  employeeEmail: true,
  employeeName: true,
  date: true,
  startTime: true,
  endTime: true,
  shiftType: true,
  status: true,
  location: true,
  notes: true,
  branch: true,
  department: true,
  companyProfileId: true,
  version: true,
} as const;

/**
 * Fetch the requested ids, restricted to the caller's tenant, then split them
 * into actionable vs. rejected buckets. Rejections are reported back so the UI
 * can explain a partial success instead of silently doing less than asked.
 */
async function resolveBatch(
  authUser: Parameters<typeof isEmployeeInManagerScope>[0],
  ids: string[],
): Promise<{
  actionable: ShiftRow[];
  notFound: string[];
  outOfScope: Array<{ id: string; reason: string }>;
}> {
  const uniqueIds = Array.from(new Set(ids));

  // Tenant filter is applied in the WHERE clause, so a cross-tenant id simply
  // does not resolve — we report NOT_FOUND rather than leaking its existence.
  const rows = (await prisma.shift.findMany({
    where: { id: { in: uniqueIds }, ...tenantWhere(authUser) },
    select: SHIFT_SELECT,
  })) as unknown as ShiftRow[];

  const foundIds = new Set(rows.map((r) => r.id));
  const notFound = uniqueIds.filter((id) => !foundIds.has(id));

  const actionable: ShiftRow[] = [];
  const outOfScope: Array<{ id: string; reason: string }> = [];

  for (const row of rows) {
    if (authUser.role === 'manager') {
      const inScope = await isEmployeeInManagerScope(
        authUser,
        row.employeeEmail ?? '',
        row.employeeId,
      );
      if (!inScope) {
        outOfScope.push({
          id: row.id,
          reason: `${row.employeeName ?? row.employeeEmail ?? 'Employee'} is outside your management scope`,
        });
        continue;
      }
    }
    actionable.push(row);
  }

  return { actionable, notFound, outOfScope };
}

// ── PATCH /bulk-edit ────────────────────────────────────────────────────────
router.patch(
  '/bulk-edit',
  requireAdminOrManager,
  validate(bulkEditShiftsSchema),
  async (req, res) => {
    try {
      const authUser = req.authUser!;
      const body = req.body as BulkEditShifts;
      const { actionable, notFound, outOfScope } = await resolveBatch(authUser, body.ids);

      if (actionable.length === 0) {
        return sendError(res, 404, 'No shifts in this batch could be modified.', {
          code: 'BULK_NOTHING_TO_DO',
          details: { notFound, outOfScope },
        });
      }

      // Build the patch once; only keys the caller actually sent are written, so
      // a bulk "change the start time" cannot accidentally null out locations.
      const patch: Record<string, unknown> = { updatedBy: authUser.id };
      if (body.startTime !== undefined && body.startTime !== null) patch.startTime = body.startTime;
      if (body.endTime !== undefined && body.endTime !== null) patch.endTime = body.endTime;
      if (body.shiftType !== undefined) patch.shiftType = body.shiftType;
      if (body.location !== undefined) patch.location = body.location;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.status !== undefined) patch.status = body.status;

      const touchesTimes = 'startTime' in patch || 'endTime' in patch;
      const skipped: Array<{ id: string; reason: string }> = [];
      let toUpdate = actionable;

      // Overlap validation only matters when the time window changes.
      if (touchesTimes && !body.skipOverlaps) {
        const employeeIds = actionable
          .map((s) => s.employeeId)
          .filter((v): v is string => typeof v === 'string');
        const batchIds = new Set(actionable.map((s) => s.id));

        const existing = employeeIds.length
          ? await prisma.shift.findMany({
              where: {
                employeeId: { in: employeeIds },
                status: { in: ['scheduled', 'active'] },
                startTime: { not: null },
                endTime: { not: null },
                // Exclude the batch itself: those rows are about to change, so
                // comparing against their OLD times would be meaningless.
                id: { notIn: Array.from(batchIds) },
              },
              select: { employeeId: true, date: true, startTime: true, endTime: true },
            })
          : [];

        const windows = new Map<string, ShiftTimeWindow[]>();
        for (const s of existing) {
          // Dates are stored at UTC noon, so slice(0,10) is timezone-safe.
          const key = `${s.employeeId}|${s.date.toISOString().slice(0, 10)}`;
          const list = windows.get(key) ?? [];
          list.push({ startTime: s.startTime!, endTime: s.endTime! });
          windows.set(key, list);
        }

        toUpdate = actionable.filter((s) => {
          const nextStart = (patch.startTime as string | undefined) ?? s.startTime;
          const nextEnd = (patch.endTime as string | undefined) ?? s.endTime;
          if (!nextStart || !nextEnd) return true;
          const key = `${s.employeeId}|${s.date.toISOString().slice(0, 10)}`;
          if (countOverlaps(nextStart, nextEnd, windows.get(key) ?? []) > 0) {
            skipped.push({
              id: s.id,
              reason: 'New times overlap an existing shift for this employee',
            });
            return false;
          }
          return true;
        });
      }

      if (toUpdate.length === 0) {
        return sendError(
          res,
          409,
          'No shifts were modified — every shift in the batch was skipped.',
          {
            code: 'BULK_ALL_SKIPPED',
            details: { skipped, notFound, outOfScope },
          },
        );
      }

      const updated = await prisma.$transaction(
        toUpdate.map((s) =>
          prisma.shift.update({ where: { id: s.id }, data: patch, select: SHIFT_SELECT }),
        ),
      );

      const changedFields = Object.keys(patch).filter((k) => k !== 'updatedBy');
      // BATCH AUDIT (Cycle 17): a bulk mutation must be reconstructable as ONE
      // action. `batchId` is a stable, queryable identifier for the whole
      // operation (previously entityId was the arbitrary first shift id), and
      // `shift_ids` lists every affected shift so the full blast radius is
      // recoverable from the audit trail alone — no re-deriving from N
      // per-shift rows.
      const batchId = randomUUID();
      logAudit({
        entity: 'Shift',
        entityId: batchId,
        action: 'bulk_update',
        actorId: authUser.id,
        actorEmail: authUser.email,
        actorRole: authUser.role,
        justification: `Bulk edited ${updated.length} shift(s): ${body.reason}`,
        ipAddress: getClientIp(req),
        changes: {
          fields: { before: null, after: changedFields },
          shift_count: { before: null, after: updated.length },
          skipped_count: { before: null, after: skipped.length },
          shift_ids: { before: null, after: updated.map((s) => s.id) },
          start_time: { before: null, after: patch.startTime ?? null },
          end_time: { before: null, after: patch.endTime ?? null },
          shift_type: { before: null, after: patch.shiftType ?? null },
          status: { before: null, after: patch.status ?? null },
        } as never,
      });

      broadcastScoped(
        'shift',
        'bulkUpdate',
        { count: updated.length, ids: updated.map((s) => s.id), fields: changedFields },
        { companyProfileId: authUser.companyProfileId },
      );

      res.json({
        success: true,
        updated: updated.length,
        skipped: skipped.length,
        skippedDetails: skipped,
        notFound,
        outOfScope,
        shiftIds: updated.map((s) => s.id),
      });
    } catch (err) {
      logger.error('[shifts] Bulk edit error:', err);
      internalError(res, 'bulk editing shifts');
    }
  },
);

// ── POST /bulk-delete ───────────────────────────────────────────────────────
router.post(
  '/bulk-delete',
  requireAdminOrManager,
  validate(bulkDeleteShiftsSchema),
  async (req, res) => {
    try {
      const authUser = req.authUser!;
      const body = req.body as BulkDeleteShifts;
      const { actionable, notFound, outOfScope } = await resolveBatch(authUser, body.ids);

      if (actionable.length === 0) {
        return sendError(res, 404, 'No shifts in this batch could be deleted.', {
          code: 'BULK_NOTHING_TO_DO',
          details: { notFound, outOfScope },
        });
      }

      await prisma.$transaction(
        actionable.map((s) => prisma.shift.delete({ where: { id: s.id } })),
      );

      const batchId = randomUUID();
      logAudit({
        entity: 'Shift',
        entityId: batchId,
        action: 'bulk_delete',
        actorId: authUser.id,
        actorEmail: authUser.email,
        actorRole: authUser.role,
        justification: `Bulk deleted ${actionable.length} shift(s): ${body.reason}`,
        ipAddress: getClientIp(req),
        changes: {
          shift_count: { before: actionable.length, after: 0 },
          shift_ids: { before: actionable.map((s) => s.id), after: null },
        } as never,
      });

      broadcastScoped(
        'shift',
        'bulkDelete',
        { count: actionable.length, ids: actionable.map((s) => s.id) },
        { companyProfileId: authUser.companyProfileId },
      );

      res.json({
        success: true,
        deleted: actionable.length,
        deletedIds: actionable.map((s) => s.id),
        notFound,
        outOfScope,
      });
    } catch (err) {
      logger.error('[shifts] Bulk delete error:', err);
      internalError(res, 'bulk deleting shifts');
    }
  },
);

export default router;
