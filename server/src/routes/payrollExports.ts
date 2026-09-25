/**
 * Payroll Export Audit Trail (Feature Spec §4)
 * ============================================
 * Payroll CSVs are generated CLIENT-side (src/utils/payrollExportFormats.ts +
 * downloadCsv), so the server never sees the file. To still satisfy the
 * compliance requirement "who exported which period, in which format, when",
 * the client reports each successful download here and we persist an
 * append-only PayrollExportLog row (migration 23).
 *
 * Trust model: the report is self-declared by an authenticated admin/manager,
 * so it is an accountability trail rather than a security control — a malicious
 * client could under-report. That is acceptable because the sensitive act
 * (reading payroll data) is already authorized and audited on the READ side by
 * GET /reports/payroll; this closes the "data left the building" gap.
 *
 * Mounted from routes/reports.ts so URLs stay under /api/reports/*.
 */

import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import prisma from '../prisma.js';
import { requireAuth, requireAdminOrManager } from '../middleware/auth.js';
import { validate } from '../validation.js';
import { getClientIp } from '../audit.js';
import { internalError, sendError } from '../errorResponse.js';
import { parseDate } from '../overlap.js';
import { tenantWhere } from '../tenantPolicy.js';

const router = Router();

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.');

export const payrollExportLogSchema = z.object({
  formatId: z.string().min(1).max(64),
  formatLabel: z.string().min(1).max(120),
  from: dateStr,
  to: dateStr,
  rowCount: z.number().int().min(0).max(1_000_000).default(0),
  filters: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export type PayrollExportLogInput = z.infer<typeof payrollExportLogSchema>;

// ── POST /payroll/export-log — record a client-side CSV download ──
router.post(
  '/payroll/export-log',
  requireAdminOrManager,
  validate(payrollExportLogSchema),
  async (req, res) => {
    try {
      const authUser = req.authUser!;
      const body = req.body as PayrollExportLogInput;

      if (!authUser.companyProfileId) {
        // Only `master` can lack a tenant, and master does not run payroll
        // exports for a single company. Refuse rather than write an orphan row.
        return sendError(res, 400, 'A company context is required to log a payroll export.', {
          code: 'TENANT_REQUIRED',
        });
      }
      if (body.to < body.from) {
        return sendError(res, 400, 'The export period end date precedes its start date.', {
          code: 'BAD_RANGE',
          details: { field: 'to' },
        });
      }

      const row = await prisma.payrollExportLog.create({
        data: {
          companyProfileId: authUser.companyProfileId,
          formatId: body.formatId,
          formatLabel: body.formatLabel,
          periodFrom: parseDate(body.from),
          periodTo: parseDate(body.to),
          rowCount: body.rowCount,
          filters: (body.filters ?? {}) as object,
          actorId: authUser.id,
          actorEmail: authUser.email,
          actorRole: authUser.role,
          ipAddress: getClientIp(req),
        },
        select: { id: true, createdAt: true },
      });

      res.status(201).json({ success: true, id: row.id, createdAt: row.createdAt });
    } catch (err) {
      logger.error('[payroll-exports] Log write error:', err);
      internalError(res, 'recording the payroll export');
    }
  },
);

// ── GET /payroll/export-logs — tenant-scoped audit history ──
router.get('/payroll/export-logs', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    if (!['admin', 'manager', 'master'].includes(authUser.role)) {
      return sendError(res, 403, 'Payroll export history requires a manager context.', {
        code: 'ACCESS_DENIED',
      });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 200);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const where: Record<string, unknown> = { ...tenantWhere(authUser) };
    if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      where.createdAt = { gte: parseDate(from), lte: parseDate(to) };
    }

    const items = await prisma.payrollExportLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json({ items, count: items.length, limit });
  } catch (err) {
    logger.error('[payroll-exports] List error:', err);
    internalError(res, 'fetching payroll export history');
  }
});

export default router;
