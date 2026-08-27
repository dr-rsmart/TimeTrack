/**
 * Master Platform Routes
 * ----------------------
 * Endpoints for Platform Master actions (cross-tenant statistics, listing tenants, registering new companies, etc.)
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma.js';
import { requireAuth, signToken, invalidateCompanyActiveCache, invalidateLiveRoleCache } from '../middleware/auth.js';
import { logAudit, getClientIp, computeChanges } from '../audit.js';
import { disconnectTenantClients } from '../sse.js';
import { DEFAULT_PASSWORD } from '../passwords.js';
import { isMasterAuthorized } from '../masterAuth.js';
import { disconnectUserClusterWide } from '../invalidation.js';
import { getBusinessTimezone, businessNow } from '../timezone.js';
import { parseDate } from '../overlap.js';
import {
  notFound,
  accessDenied,
  badRequest,
  internalError,
  duplicateRecord,
} from '../errorResponse.js';

const router = Router();

const COOKIE_NAME = 'tt_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 8 * 60 * 60 * 1000, // 8 hours
  path: '/',
};

// Middleware helper to ensure user is a platform master.
// SECURITY (least privilege): impersonation/demo sessions carry
// originalRole === 'master' but must NOT retain the full master governance
// surface while simulating a tenant persona — they are only permitted to
// call /stop-impersonation to restore the real master session. Every other
// master endpoint requires the live role to actually be 'master'.
// Decision logic lives in masterAuth.ts (unit-tested).
function requireMaster(req: any, res: any, next: any) {
  if (isMasterAuthorized(req.authUser, req.path)) {
    return next();
  }
  return accessDenied(res, 'Platform Master access required.');
}

router.use(requireAuth);
router.use(requireMaster);

// ── GET /master/stats ──
// Platform-wide aggregate counts. These are full-table counts, so the result
// is cached for 30s to avoid hammering the DB on master dashboard refreshes.
// 30s staleness is acceptable for platform-level KPIs.
const STATS_TTL_MS = 30_000;
let statsCache: { data: Record<string, number>; expiresAt: number } | null = null;

router.get('/stats', async (req, res) => {
  try {
    if (statsCache && Date.now() < statsCache.expiresAt) {
      return res.json(statsCache.data);
    }

    const [totalCompanies, activeCompanies, totalEmployees, totalUsers, activeClockIns, completedToday] = await Promise.all([
      prisma.companyProfile.count(),
      prisma.companyProfile.count({ where: { isActive: true } }),
      prisma.employee.count(),
      prisma.user.count(),
      prisma.timeEntry.count({ where: { status: 'active' } }),
      prisma.timeEntry.findMany({
        where: {
          status: 'completed',
          // Business-timezone "today" using the UTC-noon DATE convention so
          // the comparison is stable regardless of host timezone.
          date: parseDate(businessNow(getBusinessTimezone()).dateStr)
        },
        select: { totalHours: true }
      })
    ]);

    const totalHoursToday = completedToday.reduce((sum, e) => sum + (e.totalHours ?? 0), 0);

    const data = {
      totalCompanies,
      activeCompanies,
      totalEmployees,
      totalUsers,
      activeClockIns,
      totalHoursToday: Math.round(totalHoursToday * 100) / 100,
    };

    statsCache = { data, expiresAt: Date.now() + STATS_TTL_MS };

    res.json(data);
  } catch (err) {
    console.error('[master] stats error:', err);
    internalError(res, 'retrieving platform statistics');
  }
});

// ── GET /master/companies ──
router.get('/companies', async (req, res) => {
  try {
    const companies = await prisma.companyProfile.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { employees: true }
        },
        owner: {
          select: {
            id: true,
            email: true,
            fullName: true,
          }
        }
      }
    });

    const items = companies.map(c => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      employeeCount: c._count.employees,
      billingTier: c.billingTier,
      phone: c.phone || '',
      address: c.address || '',
      vatNumber: c.vatNumber || '',
      registrationNumber: c.registrationNumber || '',
      primaryContactName: c.primaryContactName || '',
      createdAt: c.createdAt.toISOString(),
      ownerUserId: c.ownerUserId,
      adminEmail: c.owner?.email || 'N/A',
      adminFullName: c.owner?.fullName || 'N/A'
    }));

    res.json({ items });
  } catch (err) {
    console.error('[master] companies error:', err);
    internalError(res, 'retrieving companies');
  }
});

// ── POST /master/companies (Onboard Tenant) ──
router.post('/companies', async (req, res) => {
  try {
    const {
      name,
      phone,
      address,
      vatNumber,
      registrationNumber,
      billingTier,
      primaryContactName,
      adminEmail,
      adminFirstName,
      adminSurname,
    } = req.body;

    if (!name || !adminEmail || !adminFirstName || !adminSurname) {
      return badRequest(res, 'Company Name, Admin Email, First Name and Surname are required.', {
        fields: ['name', 'adminEmail', 'adminFirstName', 'adminSurname'],
      });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: adminEmail.toLowerCase() }
    });
    if (existingUser) {
      return duplicateRecord(res, 'Administrator', 'email');
    }

    // Default password (user must change on first login via mustChangePassword flag)
    const generatedPassword = DEFAULT_PASSWORD;
    const passwordHash = await bcrypt.hash(generatedPassword, 10);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create company profile
      const company = await tx.companyProfile.create({
        data: {
          name,
          phone,
          address,
          vatNumber,
          registrationNumber,
          billingTier: billingTier || 'standard',
          primaryContactName,
          isActive: true,
        },
      });

      // 2. Create the admin user (must change password on first login)
      const user = await tx.user.create({
        data: {
          email: adminEmail.toLowerCase(),
          fullName: `${adminFirstName} ${adminSurname}`.trim(),
          role: 'admin',
          passwordHash,
          mustChangePassword: true,
          companyProfileId: company.id,
        }
      });

      // 3. Link user as owner of the company
      const updatedCompany = await tx.companyProfile.update({
        where: { id: company.id },
        data: { ownerUserId: user.id },
      });

      // 4. Create default company settings
      await tx.companySettings.create({
        data: {
          companyProfileId: company.id,
          ordinaryHoursPerDay: 8,
          overtimeThresholdHours: 8,
        }
      });

      // 5. Create default Employee record for admin
      await tx.employee.create({
        data: {
          firstName: adminFirstName,
          surname: adminSurname,
          email: adminEmail.toLowerCase(),
          role: 'admin',
          status: 'active',
          position: 'Administrator',
          companyProfileId: company.id,
        }
      });

      return { company: updatedCompany, user };
    });

    // Audit log for company onboarding
    logAudit({
      entity: 'CompanyProfile',
      entityId: result.company.id,
      action: 'onboard',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      justification: `Onboarded new tenant: ${name} with admin ${adminEmail.toLowerCase()}`,
      ipAddress: getClientIp(req),
      companyProfileId: result.company.id,
      changes: {
        company_name: { before: null, after: name },
        admin_email: { before: null, after: adminEmail.toLowerCase() },
        billing_tier: { before: null, after: billingTier || 'standard' },
      } as any,
    });

    res.status(201).json({
      success: true,
      companyId: result.company.id,
      message: 'Tenant company successfully onboarded.',
      temporaryPassword: generatedPassword,
      note: 'Admin must change password on first login.',
    });
  } catch (err) {
    console.error('[master] onboard error:', err);
    internalError(res, 'onboarding tenant company');
  }
});

// ── PUT /master/companies/:id (Edit Profile) ──
router.put('/companies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      phone,
      address,
      vatNumber,
      registrationNumber,
      billingTier,
      primaryContactName,
      adminEmail,
      adminFirstName,
      adminSurname,
    } = req.body;

    // Validate required fields so the master gets a clear message instead of a 500
    if (!name || !adminEmail || !adminFirstName || !adminSurname) {
      return badRequest(res, 'Company Name, Admin Email, Admin First Name and Admin Surname are required.', {
        fields: ['name', 'adminEmail', 'adminFirstName', 'adminSurname'],
      });
    }

    const normalizedAdminEmail = String(adminEmail).toLowerCase().trim();

    // Check company existence
    const company = await prisma.companyProfile.findUnique({
      where: { id },
      include: { owner: true }
    });

    if (!company) {
      return notFound(res, 'Company profile');
    }

    // Email conflict check: the target admin email may belong to an existing
    // user in THIS company (promote them), but must not belong to a user in
    // another company or a platform operator (unique constraint conflict).
    const emailOwner = await prisma.user.findUnique({ where: { email: normalizedAdminEmail } });
    if (emailOwner && emailOwner.id !== company.ownerUserId && emailOwner.companyProfileId !== id) {
      return duplicateRecord(res, 'Administrator email', 'email');
    }

    // Capture before state for audit
    const beforeState = {
      name: company.name,
      phone: company.phone,
      address: company.address,
      vatNumber: company.vatNumber,
      registrationNumber: company.registrationNumber,
      billingTier: company.billingTier,
      primaryContactName: company.primaryContactName,
    };

    const adminFullName = `${adminFirstName} ${adminSurname}`.trim();

    // A reassignment occurs when the admin email changes (e.g. the current
    // admin left for another company and a new admin is appointed).
    const isReassignment = company.owner
      ? company.owner.email.toLowerCase() !== normalizedAdminEmail
      : true;

    let createdTempPassword: string | null = null;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update company profile
      const updatedCompany = await tx.companyProfile.update({
        where: { id },
        data: {
          name,
          phone,
          address,
          vatNumber,
          registrationNumber,
          billingTier: billingTier || 'standard',
          primaryContactName,
        }
      });

      // 2. Reconcile the admin owner user
      let newOwnerId = company.ownerUserId;

      if (company.owner && !isReassignment) {
        // Same admin — refresh name/company link only
        await tx.user.update({
          where: { id: company.owner.id },
          data: { fullName: adminFullName, companyProfileId: id }
        });
      } else {
        // ── Admin reassignment ──
        // Demote the outgoing admin: their account and history are kept,
        // but admin rights are revoked so they can no longer manage the
        // tenant after handing over.
        if (company.owner) {
          await tx.user.update({
            where: { id: company.owner.id },
            data: { role: 'employee' }
          });
          // Invalidate live-role cache so the demoted admin's elevated
          // access is revoked within 30s (not 8h at JWT expiry).
          invalidateLiveRoleCache(company.owner.id);
          const oldEmp = await tx.employee.findFirst({
            where: { companyProfileId: id, email: company.owner.email }
          });
          if (oldEmp && oldEmp.role === 'admin') {
            await tx.employee.update({
              where: { id: oldEmp.id },
              data: { role: 'employee' }
            });
          }
        }

        // Promote an existing user in this company, or create a fresh
        // admin account for the newly appointed administrator.
        if (emailOwner) {
          await tx.user.update({
            where: { id: emailOwner.id },
            data: {
              fullName: adminFullName,
              role: 'admin',
              companyProfileId: id,
            }
          });
          newOwnerId = emailOwner.id;
        } else {
          const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
          const newUser = await tx.user.create({
            data: {
              email: normalizedAdminEmail,
              fullName: adminFullName,
              role: 'admin',
              passwordHash,
              mustChangePassword: true,
              companyProfileId: id,
            }
          });
          newOwnerId = newUser.id;
          createdTempPassword = DEFAULT_PASSWORD;
        }

        await tx.companyProfile.update({
          where: { id },
          data: { ownerUserId: newOwnerId }
        });
      }

      // 3. Reconcile the NEW admin's employee record. The outgoing admin's
      //    employee record is intentionally left intact (their attendance
      //    history is preserved; terminate via Workforce if required).
      const newEmp = await tx.employee.findFirst({
        where: { companyProfileId: id, email: normalizedAdminEmail }
      });
      if (newEmp) {
        await tx.employee.update({
          where: { id: newEmp.id },
          data: {
            firstName: adminFirstName,
            surname: adminSurname,
            role: 'admin',
          }
        });
      } else {
        await tx.employee.create({
          data: {
            firstName: adminFirstName,
            surname: adminSurname,
            email: normalizedAdminEmail,
            role: 'admin',
            status: 'active',
            position: 'Administrator',
            companyProfileId: id,
          }
        });
      }

      return updatedCompany;
    });

    // Audit log for company profile update
    const afterState = {
      name: result.name,
      phone: result.phone,
      address: result.address,
      vatNumber: result.vatNumber,
      registrationNumber: result.registrationNumber,
      billingTier: result.billingTier,
      primaryContactName: result.primaryContactName,
    };
    const changes = computeChanges(beforeState as Record<string, unknown>, afterState as Record<string, unknown>);

    logAudit({
      entity: 'CompanyProfile',
      entityId: id,
      action: isReassignment && company.owner ? 'admin_reassigned' : 'update',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      justification: isReassignment && company.owner
        ? `Tenant admin reassigned: ${company.owner.email} -> ${normalizedAdminEmail} (${company.name})`
        : undefined,
      changes: {
        ...(changes ?? {}),
        ...(isReassignment && company.owner
          ? {
              admin_email: { before: company.owner.email, after: normalizedAdminEmail },
              admin_name: { before: company.owner.fullName, after: adminFullName },
            }
          : {}),
      } as any,
      ipAddress: getClientIp(req),
      companyProfileId: id,
    });

    res.json({
      success: true,
      company: result,
      ...(createdTempPassword
        ? {
            temporaryPassword: createdTempPassword,
            adminEmail: normalizedAdminEmail,
            note: 'New admin must change password on first login.',
          }
        : {}),
    });
  } catch (err) {
    console.error('[master] edit profile error:', err);
    internalError(res, 'updating company profile');
  }
});

// ── POST /master/companies/:id/toggle (Suspend/Unsuspend) ──
router.post('/companies/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const company = await prisma.companyProfile.findUnique({
      where: { id },
      include: { _count: { select: { employees: true, users: true } } },
    });
    if (!company) {
      return notFound(res, 'Company profile');
    }

    const updated = await prisma.companyProfile.update({
      where: { id },
      data: { isActive: !company.isActive }
    });

    // Invalidate the suspension-status cache so the new state is enforced
    // immediately on the next authenticated request from this tenant.
    invalidateCompanyActiveCache(id);

    // Close all open SSE streams for this tenant when suspending, so
    // suspended users stop receiving live events immediately (matches
    // request-path enforcement). On activation there is nothing to restore —
    // clients reconnect naturally.
    if (!updated.isActive) {
      disconnectTenantClients(id);
    }

    // Audit log with impact analysis
    logAudit({
      entity: 'CompanyProfile',
      entityId: id,
      action: updated.isActive ? 'activate' : 'suspend',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      justification: updated.isActive
        ? `Activated tenant: ${company.name}`
        : `Suspended tenant: ${company.name} (${company._count.employees} employees, ${company._count.users} users affected)`,
      ipAddress: getClientIp(req),
      companyProfileId: id,
      changes: {
        isActive: { before: company.isActive, after: updated.isActive },
        affected_employees: { before: null, after: company._count.employees },
        affected_users: { before: null, after: company._count.users },
      } as any,
    });

    res.json({
      success: true,
      isActive: updated.isActive,
      message: updated.isActive ? 'Tenant successfully activated.' : 'Tenant successfully suspended.',
      impact: {
        employeesAffected: company._count.employees,
        usersAffected: company._count.users,
      },
    });
  } catch (err) {
    console.error('[master] toggle active error:', err);
    internalError(res, 'toggling tenant status');
  }
});

// ── DELETE /master/companies/:id (Delete Tenant) ──
router.delete('/companies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const company = await prisma.companyProfile.findUnique({
      where: { id },
      include: { _count: { select: { employees: true, users: true, timeEntries: true, shifts: true } } },
    });
    if (!company) {
      return notFound(res, 'Company profile');
    }

    // Capture counts before deletion for audit
    const impactSummary = {
      employees: company._count.employees,
      users: company._count.users,
      timeEntries: company._count.timeEntries,
      shifts: company._count.shifts,
    };

    // Cascade deletes within a transaction to clear foreign key constraints safely
    await prisma.$transaction(async (tx) => {
      // Delete time entries, shifts, geofences, settings, employees, users, and finally company profile
      await tx.timeEntry.deleteMany({ where: { companyProfileId: id } });
      await tx.shift.deleteMany({ where: { companyProfileId: id } });
      await tx.geofence.deleteMany({ where: { companyProfileId: id } });
      await tx.companySettings.deleteMany({ where: { companyProfileId: id } });
      await tx.employee.deleteMany({ where: { companyProfileId: id } });
      await tx.user.deleteMany({ where: { companyProfileId: id } });
      await tx.companyProfile.delete({ where: { id } });
    });

    // Audit log for permanent deletion with impact summary
    logAudit({
      entity: 'CompanyProfile',
      entityId: id,
      action: 'delete',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      justification: `Permanently deleted tenant: ${company.name}`,
      ipAddress: getClientIp(req),
      companyProfileId: id,
      changes: {
        company_name: { before: company.name, after: null },
        deleted_records: { before: null, after: impactSummary },
      } as any,
    });

    res.json({ success: true, message: 'Tenant company and all associated records permanently deleted.' });
  } catch (err) {
    console.error('[master] delete company error:', err);
    internalError(res, 'deleting tenant company');
  }
});

// ── GET /master/operators (List Master Accounts) ──
router.get('/operators', async (req, res) => {
  try {
    const operators = await prisma.user.findMany({
      where: { role: 'master' },
      orderBy: { createdAt: 'desc' }
    });

    const items = operators.map(o => {
      const names = o.fullName.split(' ');
      const firstName = names[0] || '';
      const surname = names.slice(1).join(' ') || '';
      return {
        id: o.id,
        email: o.email,
        fullName: o.fullName,
        firstName,
        surname,
        role: o.role,
        createdAt: o.createdAt.toISOString()
      };
    });

    res.json({ items });
  } catch (err) {
    console.error('[master] get operators error:', err);
    internalError(res, 'retrieving master accounts');
  }
});

// ── POST /master/operators (Add Master Account) ──
router.post('/operators', async (req, res) => {
  try {
    const { fullName, email, firstName, surname, role } = req.body;

    if (!email || !fullName) {
      return badRequest(res, 'Full Name and Email are required.', { fields: ['fullName', 'email'] });
    }

    // Check user existence
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return duplicateRecord(res, 'User', 'email');
    }

    // Default password for new master operators
    const generatedPassword = DEFAULT_PASSWORD;
    const passwordHash = await bcrypt.hash(generatedPassword, 10);
    const resolvedFullName = fullName || `${firstName} ${surname}`.trim();

    const operator = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        fullName: resolvedFullName,
        role: role || 'master',
        passwordHash,
        mustChangePassword: true,
      }
    });

    // Audit log for operator creation
    logAudit({
      entity: 'User',
      entityId: operator.id,
      action: 'create_operator',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      justification: `Created master operator: ${operator.email}`,
      ipAddress: getClientIp(req),
      changes: {
        email: { before: null, after: operator.email },
        role: { before: null, after: operator.role },
      } as any,
    });

    res.status(201).json({
      success: true,
      operator: {
        id: operator.id,
        email: operator.email,
        fullName: operator.fullName,
        role: operator.role,
      },
      temporaryPassword: generatedPassword,
      note: 'Operator must change password on first login.',
    });
  } catch (err) {
    console.error('[master] create operator error:', err);
    internalError(res, 'creating master account');
  }
});

// ── POST /master/operators/:id/reset-password ──
router.post('/operators/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;

    const operator = await prisma.user.findUnique({ where: { id } });
    if (!operator) {
      return notFound(res, 'Master operator');
    }
    if (operator.role !== 'master') {
      return badRequest(res, 'Only master operator accounts can be reset here.');
    }

    const generatedPassword = DEFAULT_PASSWORD;
    const passwordHash = await bcrypt.hash(generatedPassword, 10);

    await prisma.user.update({
      where: { id },
      // SECURITY: bump pwdEpoch so any pre-existing session for this
      // operator is revoked on the next request (revocation-on-rotation).
      data: { passwordHash, mustChangePassword: true, pwdEpoch: { increment: 1 } },
    });
    invalidateLiveRoleCache(id);
    disconnectUserClusterWide(id);

    logAudit({
      entity: 'User',
      entityId: id,
      action: 'reset_password',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      justification: `Reset password for master operator: ${operator.email}`,
      ipAddress: getClientIp(req),
    });

    res.json({
      success: true,
      temporaryPassword: generatedPassword,
      note: 'Operator must change password on first login.',
    });
  } catch (err) {
    console.error('[master] reset operator password error:', err);
    internalError(res, 'resetting operator password');
  }
});

// ── POST /master/demo-login (Launch Demo Persona) ──
// Works like impersonation but targets any persona by email (master, admin,
// manager, employee). The JWT keeps the Master operator's `id` so the session
// can be restored via /master/stop-impersonation, while carrying the persona's
// role/company so the app renders exactly as that persona would see it.
// `demoEmail` marks the session as a demo so the UI can show a "Return to
// Master Console" bar and /auth/me can resolve the persona's real identity.
router.post('/demo-login', async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email || typeof email !== 'string') {
      return badRequest(res, 'Persona email is required.');
    }

    const persona = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!persona) {
      return notFound(res, 'Demo persona');
    }

    // Resolve the persona's employee record for branch/department context
    const employee = await prisma.employee.findFirst({
      where: { email: persona.email, companyProfileId: persona.companyProfileId ?? undefined },
      select: { branch: true, department: true },
    });

    logAudit({
      entity: 'Impersonation',
      entityId: persona.id,
      action: 'demo_login',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      justification: `Launched demo persona: ${persona.email} (${persona.role})`,
      ipAddress: getClientIp(req),
      companyProfileId: persona.companyProfileId,
    });

    const token = signToken({
      id: req.authUser!.id, // master operator id — enables restore
      email: persona.email,
      fullName: persona.fullName,
      role: persona.role,
      companyProfileId: persona.companyProfileId,
      branch: employee?.branch ?? null,
      department: employee?.department ?? null,
      originalRole: 'master',
      demoEmail: persona.email,
      pwdEpoch: req.authUser!.pwdEpoch ?? 0,
    });

    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    res.json({
      success: true,
      token,
      message: `Now simulating ${persona.fullName} (${persona.role})`,
    });
  } catch (err) {
    console.error('[master] demo-login error:', err);
    internalError(res, 'launching demo persona');
  }
});

// ── POST /master/impersonate/:id (Start Impersonation) ──
router.post('/impersonate/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const company = await prisma.companyProfile.findUnique({
      where: { id },
      include: { owner: true }
    });

    if (!company) {
      return notFound(res, 'Tenant company');
    }

    // Audit log for impersonation start
    logAudit({
      entity: 'Impersonation',
      entityId: company.id,
      action: 'impersonate_start',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      justification: `Started impersonating as admin of ${company.name}`,
      ipAddress: getClientIp(req),
      companyProfileId: company.id,
    });

    // We can impersonate as admin of this company.
    // The JWT will carry:
    // id: the master operator user ID (so we can restore later!)
    // email: master email (or target email)
    // role: 'admin' (to grant standard tenant admin control)
    // companyProfileId: the target company profile id
    // originalRole: 'master' (the crucial flag to detect impersonation state)
    const token = signToken({
      id: req.authUser!.id,
      email: req.authUser!.email,
      fullName: req.authUser!.fullName,
      role: 'admin',
      companyProfileId: company.id,
      originalRole: 'master',
      pwdEpoch: req.authUser!.pwdEpoch ?? 0,
    });

    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    res.json({
      success: true,
      token,
      message: `Now impersonating ${company.name}`
    });
  } catch (err) {
    console.error('[master] impersonate error:', err);
    internalError(res, 'initiating impersonation');
  }
});

// ── POST /master/stop-impersonation (Exit Impersonation) ──
router.post('/stop-impersonation', async (req, res) => {
  try {
    // Stop impersonation by finding the actual user record for the logged-in user and ensuring they are master
    const user = await prisma.user.findUnique({
      where: { id: req.authUser!.id }
    });

    if (!user || user.role !== 'master') {
      return accessDenied(res, 'You do not have master permissions to restore role.');
    }

    // Audit log for impersonation end
    logAudit({
      entity: 'Impersonation',
      entityId: user.id,
      action: 'impersonation_stop',
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      justification: 'Exited impersonation and restored master session',
      ipAddress: getClientIp(req),
    });

    const token = signToken({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: 'master',
      companyProfileId: null,
      originalRole: null,
      pwdEpoch: user.pwdEpoch,
    });

    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    res.json({
      success: true,
      token,
      message: 'Exited impersonation. Restored Master Session.'
    });
  } catch (err) {
    console.error('[master] stop-impersonation error:', err);
    internalError(res, 'stopping impersonation');
  }
});

export default router;
