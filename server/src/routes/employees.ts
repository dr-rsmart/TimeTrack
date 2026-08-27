/**
 * Employee Routes
 * ---------------
 * CRUD + RBAC-scoped employee directory management.
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma.js';
import { requireAuth, requireAdminOrManager, invalidateLiveRoleCache } from '../middleware/auth.js';
import { getManagerScopeFilter, isEmployeeInManagerScope } from '../middleware/scope.js';
import { validate, createEmployeeSchema, updateEmployeeSchema } from '../validation.js';
import { logAudit, getClientIp, computeChanges } from '../audit.js';
import { invalidateEmployeeStatusCache } from '../middleware/auth.js';
import { broadcastScoped, disconnectUserClients } from '../sse.js';
import { assertTenantMatch } from '../tenantContext.js';
import { DEFAULT_PASSWORD } from '../passwords.js';
import { disconnectUserClusterWide } from '../invalidation.js';
import {
  badRequest,
  notFound,
  accessDenied,
  outsideScope,
  internalError,
  duplicateRecord,
  optimisticLockError,
} from '../errorResponse.js';

const router = Router();

router.use(requireAuth);

// Helper: tenant where clause
function tenantWhere(authUser: { role: string; companyProfileId: string | null }) {
  return authUser.role === 'master' ? {} : { companyProfileId: authUser.companyProfileId ?? '__none__' };
}

// ── GET / (List employees) ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 500, 500);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const search = (req.query.search as string) || '';
    const branch = (req.query.branch as string) || '';
    const department = (req.query.department as string) || '';

    const where: Record<string, unknown> = { ...tenantWhere(authUser) };

    if (authUser.role === 'employee') {
      where.email = authUser.email;
    } else if (authUser.role === 'manager') {
      const scopeFilter = await getManagerScopeFilter(authUser);
      Object.assign(where, scopeFilter);
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { surname: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { position: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (branch) where.branch = branch;
    if (department) where.department = department;

    const [items, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { firstName: 'asc', surname: 'asc' },
        include: {
          geofence: { select: { id: true, name: true } },
          manager: { select: { id: true, firstName: true, surname: true, role: true, branch: true } },
        },
      }),
      prisma.employee.count({ where }),
    ]);

    // ── Login-account health flag ──
    // Attach `hasLoginAccount` to each employee so the Workforce UI can warn
    // admins about employees who are visible in the roster but cannot log in
    // (missing User record). One batched lookup — no per-row queries.
    let enrichedItems: Array<Record<string, unknown>> = items;
    try {
      const emails = items.map((i) => i.email.toLowerCase().trim());
      const accountRows = emails.length > 0
        ? await prisma.$queryRawUnsafe<Array<{ email: string }>>(
            `SELECT DISTINCT lower(trim(email)) AS email FROM "User" WHERE lower(trim(email)) = ANY($1::text[])`,
            emails,
          )
        : [];
      const accountSet = new Set(accountRows.map((r) => r.email));
      enrichedItems = items.map((i) => ({
        ...i,
        hasLoginAccount: accountSet.has(i.email.toLowerCase().trim()),
      }));
    } catch (flagErr) {
      // Non-fatal: if the health check fails, serve the list without the flag.
      console.warn('[employees] hasLoginAccount flag computation failed:', flagErr);
    }

    res.json({ items: enrichedItems, total });
  } catch (err) {
    console.error('[employees] List error:', err);
    internalError(res, 'fetching employees');
  }
});

// ── GET /managers (List manager options for assignment) ──
// Returns all active employees with manager or admin role within the tenant.
// Used by the Workforce "Assign Manager" dropdown. Admin/master only.
router.get('/managers', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    if (authUser.role !== 'admin' && authUser.role !== 'master') {
      return accessDenied(res, 'Only admins can view the manager assignment list.');
    }

    const managers = await prisma.employee.findMany({
      where: {
        ...tenantWhere(authUser),
        role: { in: ['manager', 'admin'] },
        status: 'active',
      },
      select: {
        id: true,
        firstName: true,
        surname: true,
        email: true,
        role: true,
        branch: true,
        department: true,
        position: true,
      },
      orderBy: [{ surname: 'asc' }, { firstName: 'asc' }],
    });

    res.json({ managers });
  } catch (err) {
    console.error('[employees] List managers error:', err);
    internalError(res, 'fetching manager options');
  }
});

// ── GET /:id ──
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;

    const item = await prisma.employee.findUnique({
      where: { id },
      include: { geofence: true, manager: { select: { id: true, firstName: true, surname: true } } },
    });
    if (!item) return notFound(res, 'Employee');

    // Defense-in-depth: verify the fetched record belongs to the request's
    // tenant context (blocks any future query that forgets its tenant filter).
    assertTenantMatch(item);

    // Access control
    if (authUser.role === 'employee' && item.email !== authUser.email) {
      return accessDenied(res, 'You can only view your own profile.');
    }
    if (authUser.role === 'manager') {
      const inScope = await isEmployeeInManagerScope(authUser, item.email);
      if (!inScope) return outsideScope(res, 'Employee');
    }
    if (authUser.role !== 'master' && item.companyProfileId && item.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res, 'Employee belongs to a different company.');
    }

    // Mask salary info for non-admin viewers
    if (authUser.role === 'manager' || authUser.role === 'employee') {
      const { salaryInfo, ...rest } = item;
      return res.json(rest);
    }

    res.json(item);
  } catch (err) {
    console.error('[employees] Get error:', err);
    internalError(res, 'fetching employee details');
  }
});

// ── POST / (Create employee) ──
router.post('/', requireAdminOrManager, validate(createEmployeeSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const data = { ...req.body } as Record<string, unknown>;

    // Managers can only create employees, branch/dept auto-assigned
    if (authUser.role === 'manager') {
      data.role = 'employee';
      const managerEmp = await prisma.employee.findFirst({
        where: { email: authUser.email, companyProfileId: authUser.companyProfileId ?? undefined },
        select: { branch: true, department: true, id: true },
      });
      data.branch = managerEmp?.branch ?? 'Unassigned';
      data.department = managerEmp?.department ?? 'General';
      data.managerId = managerEmp?.id ?? null;
    }

    const companyProfileId = authUser.role === 'master' ? (data.companyProfileId as string) : authUser.companyProfileId;

    if (typeof data.email === 'string') {
      data.email = data.email.toLowerCase().trim();
    }
    const normalizedEmail = data.email as string;

    // Check duplicate email within tenant case-insensitively
    const existing = await prisma.employee.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' }, companyProfileId: companyProfileId ?? null },
    });
    if (existing) return duplicateRecord(res, 'Employee', 'email');

    const defaultPasswordHash = await bcrypt.hash('Password123', 10);
    const userRole = (data.role as string) || 'employee';
    const validRole = ['master', 'admin', 'manager', 'employee'].includes(userRole) ? userRole : 'employee';

    // ── ATOMIC creation: Employee + login User in ONE transaction ──
    // Previously the Employee was created first and the login User was created
    // afterwards in a separate try/catch that silently swallowed failures. If the
    // user-creation step failed (network blip, unique-constraint race, etc.) the
    // employee was VISIBLE in Workforce but had NO login account — the exact
    // "I can see them on the system but they can't log in" failure. Wrapping both
    // writes in a single transaction guarantees all-or-nothing: either the
    // employee AND their login both exist, or neither does.
    const item = await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.create({
        data: {
          ...data,
          companyProfileId,
          createdBy: authUser.id,
          updatedBy: authUser.id,
        } as unknown as Parameters<typeof prisma.employee.create>[0]['data'],
      });

      const existingUser = await tx.user.findUnique({ where: { email: emp.email.toLowerCase().trim() } });
      if (!existingUser) {
        await tx.user.create({
          data: {
            email: emp.email.toLowerCase().trim(),
            fullName: `${emp.firstName} ${emp.surname}`,
            role: validRole as 'master' | 'admin' | 'manager' | 'employee',
            passwordHash: defaultPasswordHash,
            mustChangePassword: true,
            companyProfileId,
          },
        });
      } else {
        await tx.user.update({
          where: { email: emp.email.toLowerCase().trim() },
          data: {
            fullName: `${emp.firstName} ${emp.surname}`,
            role: validRole as 'master' | 'admin' | 'manager' | 'employee',
            companyProfileId,
            passwordHash: existingUser.passwordHash || defaultPasswordHash,
          },
        });
      }
      return emp;
    });

    logAudit({
      entity: 'Employee',
      entityId: item.id,
      action: 'create',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      ipAddress: getClientIp(req),
      branch: item.branch,
      department: item.department,
    });

    broadcastScoped('employee', 'create', item, {
      companyProfileId,
      branch: item.branch,
      department: item.department,
    });

    res.status(201).json(item);
  } catch (err) {
    console.error('[employees] Create error:', err);
    internalError(res, 'creating the employee');
  }
});

// ── PUT /:id (Update employee) ──
router.put('/:id', requireAuth, validate(updateEmployeeSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;
    const data = { ...req.body } as Record<string, unknown>;
    delete data.id;

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) return notFound(res, 'Employee');

    // Employee self-update (limited fields)
    if (authUser.role === 'employee') {
      if (existing.email !== authUser.email) {
        return accessDenied(res, 'You can only update your own profile.');
      }
      const allowed = ['firstName', 'surname', 'phone', 'position', 'avatarUrl'];
      for (const key of Object.keys(data)) {
        if (!allowed.includes(key)) delete data[key];
      }
    }

    // Manager scope check
    if (authUser.role === 'manager') {
      const inScope = await isEmployeeInManagerScope(authUser, existing.email);
      if (!inScope) return outsideScope(res, 'Employee');
      delete data.role;
      delete data.companyProfileId;
      // Only admin/master can change manager assignment
      delete data.managerId;
    }

    // Only admin/master can change manager assignment (employee role already filtered above)
    if (authUser.role === 'employee') {
      delete data.managerId;
    }

    // Tenant check
    if (authUser.role !== 'master' && existing.companyProfileId && existing.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res, 'Employee belongs to a different company.');
    }

    // Optimistic locking
    if (data.version !== undefined && data.version !== existing.version) {
      return optimisticLockError(res);
    }
    delete data.version;

    // Detect manager change for employment history tracking
    const managerChanged = 'managerId' in data && data.managerId !== existing.managerId;
    const oldManagerId = existing.managerId;
    const newManagerId = (data.managerId as string | null) ?? null;

    if (typeof data.email === 'string') {
      data.email = data.email.toLowerCase().trim();
    }

    const item = await prisma.employee.update({
      where: { id },
      data: { ...data, updatedBy: authUser.id, version: { increment: 1 } },
    });

    // Invalidate the terminated-status cache so status changes (e.g.
    // termination or reactivation) are enforced immediately.
    invalidateEmployeeStatusCache(item.email, item.companyProfileId);
    if (item.email !== existing.email) {
      invalidateEmployeeStatusCache(existing.email, existing.companyProfileId);
    }

    // If the role changed, invalidate the live-role cache so elevated access
    // is revoked/granted within 30s instead of waiting for JWT expiry (8h).
    if (item.role !== existing.role) {
      try {
        const affectedUser = await prisma.user.findUnique({
          where: { email: item.email.toLowerCase() },
          select: { id: true },
        });
        if (affectedUser) invalidateLiveRoleCache(affectedUser.id);
      } catch {
        // Non-critical: 30s TTL will pick it up
      }
    }

    // Track manager change in EmploymentHistory
    if (managerChanged) {
      try {
        // Close the current open employment history record
        await prisma.employmentHistory.updateMany({
          where: { employeeId: id, endDate: null },
          data: { endDate: new Date() },
        });
        // Create a new employment history record with the new manager
        await prisma.employmentHistory.create({
          data: {
            employeeId: id,
            managerId: newManagerId,
            startDate: new Date(),
            role: item.position,
            department: item.department,
            branch: item.branch,
            notes: oldManagerId
              ? `Manager changed (previous manager ID: ${oldManagerId})`
              : 'Manager assigned',
            createdBy: authUser.id,
          },
        });
      } catch (histErr) {
        console.error('[employees] Failed to record employment history for manager change:', histErr);
      }
    }

    const changes = computeChanges(existing as unknown as Record<string, unknown>, item as unknown as Record<string, unknown>);
    logAudit({
      entity: 'Employee',
      entityId: item.id,
      action: managerChanged ? 'manager_change' : 'update',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      changes,
      ipAddress: getClientIp(req),
      branch: item.branch,
      department: item.department,
    });

    broadcastScoped('employee', 'update', item, {
      companyProfileId: item.companyProfileId,
      branch: item.branch,
      department: item.department,
    });

    res.json(item);
  } catch (err) {
    console.error('[employees] Update error:', err);
    internalError(res, 'updating the employee');
  }
});

// ── POST /:id/reset-password ──
// Admin-initiated password reset. Resets the employee's login account to the
// default password "Password123" and sets mustChangePassword so the employee
// is prompted on next login, where they can set a new password or keep it.
router.post('/:id/reset-password', requireAdminOrManager, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) return notFound(res, 'Employee');

    // Tenant check
    if (authUser.role !== 'master' && existing.companyProfileId && existing.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res, 'Employee belongs to a different company.');
    }
    // Manager scope check
    if (authUser.role === 'manager') {
      const inScope = await isEmployeeInManagerScope(authUser, existing.email);
      if (!inScope) return outsideScope(res, 'Employee');
    }

    const user = await prisma.user.findUnique({ where: { email: existing.email.toLowerCase() } });
    if (!user) {
      return notFound(res, 'Login account for this employee');
    }

    const wasTerminated = existing.status === 'terminated';

    const defaultHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await prisma.user.update({
      where: { id: user.id },
      // SECURITY: bump pwdEpoch so any pre-existing session (including a
      // potentially compromised one) is revoked on the next request.
      data: { passwordHash: defaultHash, mustChangePassword: true, pwdEpoch: { increment: 1 } },
    });
    // Drop cached session state and close live SSE streams cluster-wide.
    invalidateLiveRoleCache(user.id);
    disconnectUserClusterWide(user.id);

    // Reactivation: resetting a terminated employee's password restores their
    // account to active status — the same way a suspended tenant is brought
    // back by the master. Invalidate the status cache so access resumes
    // immediately instead of waiting for the cache to expire.
    if (wasTerminated) {
      await prisma.employee.update({
        where: { id: existing.id },
        data: { status: 'active', updatedBy: authUser.id, version: { increment: 1 } },
      });
      invalidateEmployeeStatusCache(existing.email, existing.companyProfileId);
    }

    logAudit({
      entity: 'User',
      entityId: user.id,
      action: wasTerminated ? 'password_reset_and_reactivate' : 'password_reset_by_admin',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: wasTerminated
        ? `Password reset and reactivated terminated employee: ${existing.firstName} ${existing.surname} (${existing.email})`
        : `Password reset for ${existing.firstName} ${existing.surname} (${existing.email})`,
      ipAddress: getClientIp(req),
      branch: existing.branch,
      department: existing.department,
    });

    res.json({
      success: true,
      message: wasTerminated
        ? `${existing.firstName} ${existing.surname} was terminated and has been reactivated. Temporary password: ${DEFAULT_PASSWORD}. They must set a new password on next login.`
        : `Password reset for ${existing.firstName} ${existing.surname}. Temporary password: ${DEFAULT_PASSWORD}. They must set a new password on next login (the default password cannot be kept).`,
    });
  } catch (err) {
    console.error('[employees] Reset password error:', err);
    internalError(res, 'resetting the employee password');
  }
});

// ── POST /:id/reactivate ──
// Reactivate a terminated employee. Restores their status to 'active' and
// invalidates the status cache so access resumes immediately.
router.post('/:id/reactivate', requireAdminOrManager, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) return notFound(res, 'Employee');

    // Tenant check
    if (authUser.role !== 'master' && existing.companyProfileId && existing.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res, 'Employee belongs to a different company.');
    }
    // Manager scope check
    if (authUser.role === 'manager') {
      const inScope = await isEmployeeInManagerScope(authUser, existing.email);
      if (!inScope) return outsideScope(res, 'Employee');
    }

    if (existing.status !== 'terminated') {
      return badRequest(res, 'Only terminated employees can be reactivated.');
    }

    const item = await prisma.employee.update({
      where: { id },
      data: { status: 'active', updatedBy: authUser.id, version: { increment: 1 } },
    });

    // Invalidate the status cache so access resumes immediately
    invalidateEmployeeStatusCache(existing.email, existing.companyProfileId);

    logAudit({
      entity: 'Employee',
      entityId: item.id,
      action: 'reactivate',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: `Reactivated terminated employee: ${existing.firstName} ${existing.surname} (${existing.email})`,
      ipAddress: getClientIp(req),
      branch: existing.branch,
      department: existing.department,
    });

    broadcastScoped('employee', 'update', item, {
      companyProfileId: item.companyProfileId,
      branch: item.branch,
      department: item.department,
    });

    res.json({
      success: true,
      message: `${existing.firstName} ${existing.surname} has been reactivated. Their account is now active.`,
      employee: item,
    });
  } catch (err) {
    console.error('[employees] Reactivate error:', err);
    internalError(res, 'reactivating the employee');
  }
});

// ── DELETE /:id ──
// Soft delete: marks the employee as "terminated" instead of destroying the
// record. This preserves historical time entries, shifts, and audit trails
// that reference the employee. Use ?hard=true (master only) for true removal.
router.delete('/:id', requireAdminOrManager, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;
    const hardDelete = req.query.hard === 'true' && authUser.role === 'master';

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) return notFound(res, 'Employee');

    if (authUser.role !== 'master' && existing.companyProfileId && existing.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res, 'Employee belongs to a different company.');
    }
    if (authUser.role === 'manager') {
      const inScope = await isEmployeeInManagerScope(authUser, existing.email);
      if (!inScope) return outsideScope(res, 'Employee');
    }

    if (hardDelete) {
      // Master-only permanent removal
      await prisma.employee.delete({ where: { id } });
    } else {
      // Soft delete — set status to terminated and keep the record intact
      await prisma.employee.update({
        where: { id },
        data: { status: 'terminated', updatedBy: authUser.id, version: { increment: 1 } },
      });
    }

    // Enforce termination immediately: clear the cached employee status so
    // the user's active sessions are blocked on their next request.
    invalidateEmployeeStatusCache(existing.email, existing.companyProfileId);

    // Close the terminated employee's open SSE streams so they stop
    // receiving live events immediately (matches request-path enforcement).
    try {
      const terminatedUser = await prisma.user.findUnique({
        where: { email: existing.email.toLowerCase() },
        select: { id: true },
      });
      if (terminatedUser) disconnectUserClients(terminatedUser.id);
    } catch {
      // Non-critical: request-path enforcement still blocks access
    }

    logAudit({
      entity: 'Employee',
      entityId: id,
      action: hardDelete ? 'delete' : 'soft_delete',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: hardDelete
        ? `Permanently deleted employee: ${existing.firstName} ${existing.surname}`
        : `Terminated employee (soft delete): ${existing.firstName} ${existing.surname}`,
      ipAddress: getClientIp(req),
      branch: existing.branch,
      department: existing.department,
    });

    broadcastScoped('employee', hardDelete ? 'delete' : 'update', { id, status: 'terminated' }, {
      companyProfileId: existing.companyProfileId,
      branch: existing.branch,
      department: existing.department,
    });

    res.json({ success: true, deleted: id, softDelete: !hardDelete });
  } catch (err) {
    console.error('[employees] Delete error:', err);
    internalError(res, 'deleting the employee');
  }
});

export default router;