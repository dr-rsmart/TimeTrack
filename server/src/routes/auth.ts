/**
 * Auth Routes
 * -----------
 * POST /api/auth/login  — authenticate and issue JWT cookie
 * POST /api/auth/logout — clear session
 * GET  /api/auth/me     — return current user profile
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/rateLimit.js';
import { validate, loginSchema, changePasswordSchema } from '../validation.js';
import { logAudit, getClientIp } from '../audit.js';
import {
  badRequest,
  unauthorized,
  accessDenied,
  notFound,
  internalError,
  sendError,
} from '../errorResponse.js';

const router = Router();

/**
 * Known default password assigned to auto-created accounts.
 * Users still on this password are flagged and forced to change it.
 */
const DEFAULT_PASSWORD = 'Password123';

/**
 * Determine if the user must change their password.
 * Relies solely on the schema flag so that users who choose to "keep"
 * their current password are not re-prompted on every login.
 */
async function resolveMustChangePassword(user: { mustChangePassword: boolean; passwordHash: string | null }): Promise<boolean> {
  return user.mustChangePassword;
}

const COOKIE_NAME = 'tt_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 8 * 60 * 60 * 1000, // 8 hours
  path: '/',
};

// ── POST /login ── (rate-limited to slow brute-force attempts)
router.post('/login', loginRateLimit, validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.passwordHash) {
      return unauthorized(res, 'Invalid email or password.');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return unauthorized(res, 'Invalid email or password.');
    }

    // ── Tenant suspension check ──
    // Users belonging to a company suspended by the platform master cannot
    // log in until the company is reactivated. Master operators (no company)
    // are unaffected.
    if (user.companyProfileId) {
      const company = await prisma.companyProfile.findUnique({
        where: { id: user.companyProfileId },
        select: { isActive: true, name: true },
      });
      if (company && !company.isActive) {
        logAudit({
          entity: 'User',
          entityId: user.id,
          action: 'login_denied_suspended',
          actorId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
          justification: `Login denied — company "${company.name}" is suspended`,
          ipAddress: getClientIp(req),
          companyProfileId: user.companyProfileId,
        });
        return sendError(
          res,
          403,
          'Your company account has been suspended. Please contact your administrator or support.',
          { code: 'COMPANY_SUSPENDED' },
        );
      }
    }

    // ── Terminated employee check ──
    // Same enforcement as company suspension, but per user: a terminated
    // employee cannot log in even if their password was reset afterwards.
    // Master operators have no employee record and are unaffected.
    if (user.role !== 'master') {
      const employee = await prisma.employee.findFirst({
        where: { email: user.email, companyProfileId: user.companyProfileId ?? undefined },
        select: { status: true },
      });
      if (employee?.status === 'terminated') {
        logAudit({
          entity: 'User',
          entityId: user.id,
          action: 'login_denied_terminated',
          actorId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
          justification: 'Login denied — employee account is terminated',
          ipAddress: getClientIp(req),
          companyProfileId: user.companyProfileId,
        });
        return sendError(
          res,
          403,
          'Your account has been terminated. Please contact your administrator.',
          { code: 'EMPLOYEE_TERMINATED' },
        );
      }
    }

    // Flag accounts that must change their password (schema flag).
    const mustChangePassword = await resolveMustChangePassword(user);

    // Look up employee record for branch/department context
    const employee = await prisma.employee.findFirst({
      where: { email: user.email, companyProfileId: user.companyProfileId ?? undefined },
      select: { branch: true, department: true },
    });

    const token = signToken({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      companyProfileId: user.companyProfileId,
      branch: employee?.branch ?? null,
      department: employee?.department ?? null,
    });

    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

    logAudit({
      entity: 'User',
      entityId: user.id,
      action: 'login',
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      ipAddress: getClientIp(req),
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        companyProfileId: user.companyProfileId,
        branch: employee?.branch ?? null,
        department: employee?.department ?? null,
        mustChangePassword,
      },
      token,
    });
  } catch (err) {
    console.error('[auth] Login error:', err);
    internalError(res, 'logging in');
  }
});

// ── POST /logout ──
router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

// ── POST /forgot-password ──
// Returns the company admin contact email so the user can reach out for a
// password reset. The admin then resets the password via Workforce → Edit →
// Reset Password, which sets it to the default "Password123".
router.post('/forgot-password', loginRateLimit, async (req, res) => {
  try {
    const { email } = req.body as { email?: string };

    if (!email || typeof email !== 'string') {
      return badRequest(res, 'Email is required.');
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        companyProfile: {
          include: {
            owner: { select: { email: true, fullName: true } },
          },
        },
      },
    });

    // Always return success to prevent email enumeration attacks
    if (!user) {
      return res.json({
        success: true,
        message: 'If an account exists with that email, please contact your company administrator to reset your password.',
        adminEmail: null,
        adminName: null,
      });
    }

    // Resolve the company admin email (the email the company was registered with)
    const adminEmail = user.companyProfile?.owner?.email ?? null;
    const adminName = user.companyProfile?.owner?.fullName ?? null;

    logAudit({
      entity: 'User',
      entityId: user.id,
      action: 'password_reset_requested',
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      justification: 'Self-service forgot password — directed to contact admin',
      ipAddress: getClientIp(req),
    });

    res.json({
      success: true,
      message: adminEmail
        ? `Please reach out to your company administrator (${adminEmail}) to reset your password.`
        : 'Please reach out to your company administrator to reset your password.',
      adminEmail,
      adminName,
    });
  } catch (err) {
    console.error('[auth] Forgot password error:', err);
    internalError(res, 'processing forgot-password request');
  }
});

// ── POST /keep-password ──
// Allows a user who is flagged with mustChangePassword to keep their current
// password instead of setting a new one. Clears the flag so they are not
// re-prompted on subsequent logins.
// SECURITY: users still on the known default password can NEVER keep it —
// they must rotate to a new credential.
router.post('/keep-password', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;

    const user = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (!user) {
      return notFound(res, 'User');
    }

    // Block keeping the known default password.
    if (user.passwordHash) {
      const isDefault = await bcrypt.compare(DEFAULT_PASSWORD, user.passwordHash);
      if (isDefault) {
        return sendError(
          res,
          400,
          'You are using a temporary default password and must set a new one.',
          { code: 'DEFAULT_PASSWORD_MUST_ROTATE' },
        );
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { mustChangePassword: false },
    });

    logAudit({
      entity: 'User',
      entityId: user.id,
      action: 'password_change_skipped',
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      justification: 'User chose to keep their current password',
      ipAddress: getClientIp(req),
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[auth] Keep password error:', err);
    internalError(res, 'updating password status');
  }
});

// ── POST /change-password ──
// Authenticated password change with complexity enforcement (see changePasswordSchema).
router.post('/change-password', requireAuth, validate(changePasswordSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };

    const user = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (!user || !user.passwordHash) {
      return notFound(res, 'User');
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return unauthorized(res, 'Current password is incorrect.');
    }

    if (newPassword === DEFAULT_PASSWORD) {
      return badRequest(res, 'New password cannot be the default password.');
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, mustChangePassword: false },
    });

    logAudit({
      entity: 'User',
      entityId: user.id,
      action: 'password_change',
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      ipAddress: getClientIp(req),
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[auth] Change password error:', err);
    internalError(res, 'changing password');
  }
});

// ── GET /me ──
router.get('/me', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        companyProfileId: true,
        companyProfile: { select: { id: true, name: true } },
      },
    });

    if (!user) return notFound(res, 'User');

    // Detect impersonation: JWT carries the effective role and companyProfileId.
    // When a master impersonates a tenant admin, the JWT has:
    //   role: 'admin', companyProfileId: <tenant id>, originalRole: 'master'
    // The DB record still has role: 'master', companyProfileId: null.
    const isImpersonating = authUser.originalRole === 'master' && authUser.role !== 'master';
    const isDemoSession = Boolean(authUser.demoEmail);
    const effectiveRole = isImpersonating ? authUser.role : user.role;
    const effectiveCompanyProfileId = isImpersonating ? authUser.companyProfileId : user.companyProfileId;

    // Resolve company profile for impersonated session (DB user has null companyProfileId)
    let companyProfile = user.companyProfile;
    if (isImpersonating && effectiveCompanyProfileId) {
      const impersonatedCompany = await prisma.companyProfile.findUnique({
        where: { id: effectiveCompanyProfileId },
        select: { id: true, name: true },
      });
      companyProfile = impersonatedCompany;
    }

    // During a demo session the JWT email is the persona's email (the DB user
    // is the Master operator), so resolve the employee record for the persona.
    const identityEmail = isDemoSession ? authUser.email : user.email;
    const identityFullName = isDemoSession ? authUser.fullName : user.fullName;

    const employee = await prisma.employee.findFirst({
      where: { email: identityEmail, companyProfileId: effectiveCompanyProfileId ?? undefined },
      select: { id: true, branch: true, department: true, position: true, firstName: true, surname: true, employeeNumber: true },
    });

    // Flag accounts that must change their password on every session check so the UI can force a reset.
    // During a Master demo session (demoEmail set) we never force a password
    // change — the session belongs to the Master operator, not the persona.
    const fullUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { passwordHash: true, mustChangePassword: true },
    });
    const mustChangePassword = isDemoSession
      ? false
      : fullUser
        ? await resolveMustChangePassword(fullUser)
        : false;

    res.json({
      id: user.id,
      email: identityEmail,
      fullName: identityFullName,
      role: effectiveRole,
      companyProfileId: effectiveCompanyProfileId,
      companyProfile,
      branch: employee?.branch ?? null,
      department: employee?.department ?? null,
      position: employee?.position ?? null,
      employeeId: employee?.id ?? null,
      // Human-readable staff number for display on the dashboard
      employeeNumber: employee?.employeeNumber ?? null,
      mustChangePassword,
      // Impersonation state — allows the frontend to show the impersonation banner
      originalRole: authUser.originalRole ?? null,
      // Demo session marker — lets the UI show "Return to Master Console" for demos
      demoEmail: authUser.demoEmail ?? null,
    });
  } catch (err) {
    console.error('[auth] Me error:', err);
    internalError(res, 'fetching profile');
  }
});

export default router;