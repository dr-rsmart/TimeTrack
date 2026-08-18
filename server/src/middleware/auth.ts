/**
 * Authentication Middleware
 * -------------------------
 * JWT verification from httpOnly cookie or Bearer header.
 * Also enforces tenant suspension: users belonging to a suspended company
 * are denied access on every request until the master reactivates it.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma.js';
import config from '../config.js';
import { runWithTenant, UNRESTRICTED } from '../tenantContext.js';

const JWT_SECRET = config.jwtSecret;

// ── Tenant suspension enforcement ──
// Short-lived cache of company active status so we don't hit the database on
// every authenticated request. Invalidation is triggered from the master
// toggle endpoint so suspension takes effect immediately.
const COMPANY_ACTIVE_CACHE_TTL_MS = 15_000;
const companyActiveCache = new Map<string, { active: boolean; expires: number }>();

export function invalidateCompanyActiveCache(companyProfileId: string): void {
  companyActiveCache.delete(companyProfileId);
}

/**
 * Returns the company's active status, or `null` if the check could not be
 * performed (e.g. transient DB error). Callers MUST treat `null` as
 * fail-closed: deny the request with 503 rather than granting access.
 */
async function isCompanyActive(companyProfileId: string): Promise<boolean | null> {
  const cached = companyActiveCache.get(companyProfileId);
  if (cached && cached.expires > Date.now()) return cached.active;

  let active: boolean;
  try {
    const company = await prisma.companyProfile.findUnique({
      where: { id: companyProfileId },
      select: { isActive: true },
    });
    active = company?.isActive ?? false;
  } catch (err) {
    console.error('[auth] Failed to check company active status (fail-closed):', err);
    // Fail-closed: we cannot verify suspension state, so refuse the request.
    return null;
  }

  companyActiveCache.set(companyProfileId, { active, expires: Date.now() + COMPANY_ACTIVE_CACHE_TTL_MS });
  return active;
}

// ── Terminated employee enforcement ──
// Mirrors the tenant suspension pattern at the individual user level: an
// employee whose status is "terminated" is denied access on every request,
// even if their login account/password still exists (e.g. after an admin
// password reset). Invalidation is triggered from the employee routes when
// the employee record is updated or deleted.
const EMPLOYEE_STATUS_CACHE_TTL_MS = 15_000;
const employeeStatusCache = new Map<string, { terminated: boolean; expires: number }>();

function employeeStatusCacheKey(email: string, companyProfileId: string | null): string {
  return `${email.toLowerCase()}|${companyProfileId ?? ''}`;
}

export function invalidateEmployeeStatusCache(email: string, companyProfileId: string | null): void {
  employeeStatusCache.delete(employeeStatusCacheKey(email, companyProfileId));
}

/**
 * Returns whether the employee is terminated, or `null` if the check could
 * not be performed. Callers MUST treat `null` as fail-closed (503).
 */
async function isEmployeeTerminated(email: string, companyProfileId: string | null): Promise<boolean | null> {
  const key = employeeStatusCacheKey(email, companyProfileId);
  const cached = employeeStatusCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.terminated;

  let terminated: boolean;
  try {
    const employee = await prisma.employee.findFirst({
      where: { email: email.toLowerCase(), companyProfileId: companyProfileId ?? undefined },
      select: { status: true },
    });
    terminated = employee?.status === 'terminated';
  } catch (err) {
    console.error('[auth] Failed to check employee status (fail-closed):', err);
    // Fail-closed: cannot verify termination state, refuse the request.
    return null;
  }

  employeeStatusCache.set(key, { terminated, expires: Date.now() + EMPLOYEE_STATUS_CACHE_TTL_MS });
  return terminated;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  companyProfileId: string | null;
  branch?: string | null;
  department?: string | null;
  originalRole?: string | null;
  /**
   * Present only during a Master "demo" session. Carries the email of the
   * persona being simulated so /auth/me can resolve that persona's real
   * identity (name, branch, department, position) while the JWT `id` still
   * points at the Master operator (enabling "Return to Master Console").
   */
  demoEmail?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      companyProfileId: user.companyProfileId,
      branch: user.branch ?? null,
      department: user.department ?? null,
      originalRole: user.originalRole ?? null,
      demoEmail: user.demoEmail ?? null,
    },
    JWT_SECRET,
    { expiresIn: '8h' },
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    return decoded;
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Accept the JWT via Bearer header or httpOnly cookie only.
  // SECURITY: query-string tokens are intentionally NOT supported — they leak
  // into access logs, proxy logs and Referer headers. The SSE endpoint uses
  // the same httpOnly cookie (EventSource withCredentials), so no query
  // fallback is needed.
  let token: string | undefined;

  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  } else if (req.cookies?.tt_token) {
    token = req.cookies.tt_token;
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }

  // ── Tenant suspension check ──
  // Deny access for users whose company has been suspended by the platform
  // master. Master operators (companyProfileId = null) are unaffected, and a
  // master impersonating a tenant (originalRole = 'master') retains access so
  // they can still administer/inspect a suspended tenant.
  if (user.companyProfileId && user.originalRole !== 'master') {
    const active = await isCompanyActive(user.companyProfileId);
    if (active === null) {
      // Fail-closed: cannot verify suspension state.
      res.status(503).json({ error: 'Service temporarily unavailable. Please retry.', code: 'AUTH_CHECK_UNAVAILABLE' });
      return;
    }
    if (!active) {
      res.status(403).json({
        error: 'Your company account has been suspended. Please contact your administrator or support.',
        code: 'COMPANY_SUSPENDED',
      });
      return;
    }
  }

  // ── Terminated employee check ──
  // Same enforcement as company suspension, but per user: a terminated
  // employee cannot use the app even if their login account still exists
  // (e.g. an admin reset their password after termination).
  if (user.role !== 'master' && user.originalRole !== 'master') {
    const terminated = await isEmployeeTerminated(user.email, user.companyProfileId);
    if (terminated === null) {
      // Fail-closed: cannot verify termination state.
      res.status(503).json({ error: 'Service temporarily unavailable. Please retry.', code: 'AUTH_CHECK_UNAVAILABLE' });
      return;
    }
    if (terminated) {
      res.status(403).json({
        error: 'Your account has been terminated. Please contact your administrator.',
        code: 'EMPLOYEE_TERMINATED',
      });
      return;
    }
  }

  req.authUser = user;

  // ── Tenant context (defense-in-depth) ──
  // Run the rest of the middleware/handler chain inside this user's tenant
  // context so the Prisma extension can auto-stamp companyProfileId on
  // creates and assertTenantMatch can block cross-tenant reads.
  // Master operators (and masters impersonating a tenant for admin purposes)
  // run UNRESTRICTED; tenant users are pinned to their companyProfileId.
  const tenantId =
    user.role === 'master' || user.originalRole === 'master'
      ? UNRESTRICTED
      : (user.companyProfileId ?? UNRESTRICTED);
  runWithTenant(tenantId, () => next());
}

// ── Live role re-verification (privilege-lag fix) ──
// The JWT carries the role assigned at login for up to 8h. If a master
// demotes an admin (or an admin changes a user's role), the stale JWT would
// otherwise keep granting elevated access until expiry. We re-verify the
// live DB role for elevated operations, cached for 30s to bound DB load.
const ROLE_CACHE_TTL_MS = 30_000;
const liveRoleCache = new Map<string, { role: string; expires: number }>();

async function getLiveRole(userId: string): Promise<string | null> {
  const cached = liveRoleCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.role;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) return null;
    liveRoleCache.set(userId, { role: user.role, expires: Date.now() + ROLE_CACHE_TTL_MS });
    return user.role;
  } catch (err) {
    console.error('[auth] Failed to verify live role (fail-closed):', err);
    return null;
  }
}

/** Invalidate the live-role cache for a user (call on any role change). */
export function invalidateLiveRoleCache(userId: string): void {
  liveRoleCache.delete(userId);
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  // Fast path: JWT says not elevated → deny without DB hit
  if (req.authUser.role !== 'admin' && req.authUser.role !== 'master') {
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }
  // SECURITY: re-verify live role to close the privilege-lag window where a
  // demoted admin's stale JWT (up to 8h) would still grant admin access.
  // Master operators (companyProfileId = null) are platform-level and exempt.
  if (req.authUser.role === 'admin' && req.authUser.originalRole !== 'master') {
    const liveRole = await getLiveRole(req.authUser.id);
    if (liveRole === null) {
      res.status(503).json({ error: 'Service temporarily unavailable. Please retry.', code: 'AUTH_CHECK_UNAVAILABLE' });
      return;
    }
    if (liveRole !== 'admin' && liveRole !== 'master') {
      res.status(403).json({ error: 'Admin access required.', code: 'ROLE_REVOKED' });
      return;
    }
  }
  next();
}

export async function requireAdminOrManager(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  // Fast path: JWT says not elevated → deny without DB hit
  if (!['admin', 'master', 'manager'].includes(req.authUser.role)) {
    res.status(403).json({ error: 'Admin or manager access required.' });
    return;
  }
  // SECURITY: re-verify live role for non-master users to close the
  // privilege-lag window (demoted admin/manager with stale JWT).
  if (req.authUser.role !== 'master' && req.authUser.originalRole !== 'master') {
    const liveRole = await getLiveRole(req.authUser.id);
    if (liveRole === null) {
      res.status(503).json({ error: 'Service temporarily unavailable. Please retry.', code: 'AUTH_CHECK_UNAVAILABLE' });
      return;
    }
    if (!['admin', 'master', 'manager'].includes(liveRole)) {
      res.status(403).json({ error: 'Admin or manager access required.', code: 'ROLE_REVOKED' });
      return;
    }
  }
  next();
}
