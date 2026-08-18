/**
 * Audit Log Routes
 * ----------------
 * View audit trail with IP redaction for non-admin roles.
 * Managers only see audits related to employees within their scope
 * (same branch + department, or their own actions).
 *
 * Supports both high-performance O(1) cursor-based pagination
 * (for enterprise retention datasets) and traditional offset pagination.
 */

import { Router } from 'express';
import prisma from '../prisma.js';
import { requireAuth, requireAdminOrManager } from '../middleware/auth.js';
import { redactIp, logAudit, getClientIp } from '../audit.js';
import { internalError } from '../errorResponse.js';

const router = Router();

router.use(requireAuth);

// ── Audit-trail access logging (throttled) ──
// Viewing the audit trail is a sensitive operation that must itself leave a
// trace. We throttle to one log entry per actor per 5 minutes to avoid
// flooding the log when the UI polls/paginates.
const AUDIT_ACCESS_LOG_INTERVAL_MS = 5 * 60_000;
const lastAuditAccessLog = new Map<string, number>();

function logAuditAccess(actorId: string, actorEmail: string, actorRole: string, ip: string | null, companyProfileId: string | null): void {
  const now = Date.now();
  const last = lastAuditAccessLog.get(actorId) ?? 0;
  if (now - last < AUDIT_ACCESS_LOG_INTERVAL_MS) return;
  lastAuditAccessLog.set(actorId, now);

  logAudit({
    entity: 'AuditLog',
    entityId: 'access',
    action: 'audit_trail_accessed',
    actorId,
    actorEmail,
    actorRole,
    justification: 'Viewed the audit trail',
    ipAddress: ip,
    companyProfileId,
  }).catch(() => {});
}

// ── GET / (List audit logs — admin/manager only) ──
router.get('/', requireAdminOrManager, async (req, res) => {
  try {
    const authUser = req.authUser!;

    // Log that the audit trail was accessed (throttled per actor).
    logAuditAccess(
      authUser.id,
      authUser.email,
      authUser.role,
      getClientIp(req),
      authUser.companyProfileId,
    );
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const cursor = (req.query.cursor as string) || undefined;
    const entity = req.query.entity as string;
    const action = req.query.action as string;

    const where: Record<string, unknown> = {};

    if (entity) where.entity = entity;
    if (action) where.action = action;

    // ── Tenant isolation (compliance): non-master users may ONLY see audit
    // rows belonging to their own company. Masters (and masters impersonating
    // a tenant admin via originalRole) see the impersonated tenant's rows.
    if (authUser.role !== 'master') {
      where.companyProfileId = authUser.companyProfileId ?? '__none__';
    }

    // ── Manager scope: only show audits within their branch/department ──
    // Managers should NOT see general audits from everyone — only audits
    // related to employees under their supervision (same branch + department)
    // or actions they performed themselves.
    if (authUser.role === 'manager') {
      const managerEmployee = await prisma.employee.findFirst({
        where: { email: authUser.email, companyProfileId: authUser.companyProfileId ?? undefined },
        select: { id: true, branch: true, department: true },
      });

      if (managerEmployee) {
        where.OR = [
          // Audits performed by the manager themselves
          { actorId: authUser.id },
          // Audits within the manager's branch + department scope
          {
            AND: [
              { branch: managerEmployee.branch },
              { department: managerEmployee.department },
            ],
          },
        ];
      } else {
        // Manager has no employee record — only show their own actions
        where.actorId = authUser.id;
      }
    }

    // Query configuration: supports cursor pagination or offset pagination
    const findArgs: any = {
      where,
      take: limit + 1, // Fetch one extra to determine if next page exists
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    };

    if (cursor) {
      findArgs.cursor = { id: cursor };
      findArgs.skip = 1; // Skip the cursor itself
    } else if (offset > 0) {
      findArgs.skip = offset;
      findArgs.take = limit;
    }

    const [rawItems, total] = await Promise.all([
      prisma.auditLog.findMany(findArgs),
      prisma.auditLog.count({ where }),
    ]);

    let hasMore = false;
    let nextCursor: string | null = null;
    let items = rawItems;

    if (!cursor && offset === 0) {
      if (rawItems.length > limit) {
        hasMore = true;
        items = rawItems.slice(0, limit);
        nextCursor = items[items.length - 1]?.id ?? null;
      }
    } else if (cursor) {
      if (rawItems.length > limit) {
        hasMore = true;
        items = rawItems.slice(0, limit);
        nextCursor = items[items.length - 1]?.id ?? null;
      }
    } else {
      hasMore = offset + items.length < total;
    }

    // ── Enrich with staff name (the employee affected by the audit event) ──
    // Batch-resolve names per entity type to avoid N+1 queries.
    // Following the same pattern as reports: resolve staff info directly from source tables.
    const employeeIds = items.filter((i) => i.entity === 'Employee').map((i) => i.entityId);
    const timeEntryIds = items.filter((i) => i.entity === 'TimeEntry').map((i) => i.entityId);
    const shiftIds = items.filter((i) => i.entity === 'Shift').map((i) => i.entityId);
    const userIds = items.filter((i) => i.entity === 'User').map((i) => i.entityId);

    const [employeeRows, timeEntryRows, shiftRows, userRows] = await Promise.all([
      employeeIds.length > 0
        ? prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, firstName: true, surname: true, email: true } })
        : [],
      timeEntryIds.length > 0
        ? prisma.timeEntry.findMany({ where: { id: { in: timeEntryIds } }, select: { id: true, employeeName: true, employeeEmail: true } })
        : [],
      shiftIds.length > 0
        ? prisma.shift.findMany({ where: { id: { in: shiftIds } }, select: { id: true, employeeName: true, employeeEmail: true } })
        : [],
      userIds.length > 0
        ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } })
        : [],
    ]);

    const employeeNameMap = new Map(employeeRows.map((e) => [e.id, `${e.firstName} ${e.surname}`]));
    const timeEntryNameMap = new Map(timeEntryRows.map((t) => [t.id, t.employeeName || t.employeeEmail]));
    const shiftNameMap = new Map(shiftRows.map((s) => [s.id, s.employeeName || s.employeeEmail]));
    const userNameMap = new Map(userRows.map((u) => [u.id, u.fullName || u.email]));

    // Also resolve actor names (the user who performed the action)
    const actorIds = [...new Set(items.map((i) => i.actorId))];
    const actorRows = actorIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })
      : [];
    const actorNameMap = new Map(actorRows.map((u) => [u.id, u.fullName]));

    // Redact IPs for managers
    const shouldRedact = authUser.role === 'manager';
    const sanitized = items.map((item) => {
      let staffName: string | null = null;
      if (item.entity === 'Employee') {
        staffName = employeeNameMap.get(item.entityId) ?? null;
      } else if (item.entity === 'TimeEntry') {
        staffName = timeEntryNameMap.get(item.entityId) ?? null;
      } else if (item.entity === 'Shift') {
        staffName = shiftNameMap.get(item.entityId) ?? null;
      } else if (item.entity === 'User') {
        staffName = userNameMap.get(item.entityId) ?? null;
      }
      return {
        ...item,
        ipAddress: shouldRedact ? redactIp(item.ipAddress) : item.ipAddress,
        staffName,
        actorName: actorNameMap.get(item.actorId) ?? null,
      };
    });

    res.json({
      items: sanitized,
      total,
      nextCursor,
      hasMore,
    });
  } catch (err) {
    console.error('[audit] List error:', err);
    internalError(res, 'fetching audit logs');
  }
});

// ── GET /entities — distinct entity types for filter dropdown ──
// Tenant-scoped so the dropdown only reflects the caller's own audit data.
router.get('/entities', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const where: Record<string, unknown> =
      authUser.role !== 'master' ? { companyProfileId: authUser.companyProfileId ?? '__none__' } : {};

    const entities = await prisma.auditLog.groupBy({
      by: ['entity'],
      where,
      _count: { id: true },
    });
    res.json({ entities: entities.map((e) => ({ entity: e.entity, count: e._count.id })) });
  } catch (err) {
    console.error('[audit] Entities error:', err);
    internalError(res, 'fetching audit entities');
  }
});

export default router;
