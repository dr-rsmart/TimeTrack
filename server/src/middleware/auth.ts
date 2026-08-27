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
import { isTokenEpochStale } from '../passwords.js';
import { onInvalidationCommand, publishInvalidation } from '../invalidation.js';

const JWT_SECRET = config.jwtSecret;

// ── Tenant suspension enforcement ──
// Short-lived cache of company active status so we don't hit the database on
// every authenticated request. Invalidation is triggered from the master
// toggle endpoint so suspension takes effect immediately.
const COMPANY_ACTIVE_CACHE_TTL_MS = 15_000;
const companyActiveCache = new Map<string, { active: boolean; expires: number }>();

/** Local-only applier (used by the cluster invalidation handler). */
function applyInvalidateCompanyActiveCache(companyProfileId: string): void {
  companyActiveCache.delete(companyProfileId);
}

export function invalidateCompanyActiveCache(companyProfileId: string): void {
  applyInvalidateCompanyActiveCache(companyProfileId);
  // Fan out to every replica so suspension is enforced cluster-wide
  // immediately, not after the 15s TTL on the other nodes.
  publishInvalidation({ type: 'invalidate-company', companyProfileId });
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

/** Local-only applier (used by the cluster invalidation handler). */
function applyInvalidateEmployeeStatusCache(email: string, companyProfileId: string | null): void {
  employeeStatusCache.delete(employeeStatusCacheKey(email, companyProfileId));
}

export function invalidateEmployeeStatusCache(email: string, companyProfileId: string | null): void {
  applyInvalidateEmployeeStatusCache(email, companyProfileId);
  // Fan out to every replica so termination/reactivation is enforced
  // cluster-wide immediately, not after the 15s TTL on the other nodes.
  publishInvalidation({ type: 'invalidate-employee-status', email, companyProfileId });
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
  /**
   * Session revocation epoch captured at sign time. User.pwdEpoch is bumped
   * on every password change/reset; requireAuth rejects tokens whose epoch
   * is older than the stored value (revocation-on-rotation).
   */
  pwdEpoch?: number;
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
      pwdEpoch: user.pwdEpoch ?? 0,
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

  // ── Session epoch check (revocation-on-rotation) ──
  // Every password change/reset bumps User.pwdEpoch and invalidates this
  // cache cluster-wide, so a stolen token stops working on the very next
  // request after the victim rotates their password — instead of surviving
  // up to 8h at JWT expiry. Fail-closed: if the check cannot run, deny.
  const sessionState = await getUserSessionState(user.id);
  if (sessionState === null) {
    res.status(503).json({ error: 'Service temporarily unavailable. Please retry.', code: 'AUTH_CHECK_UNAVAILABLE' });
    return;
  }
  if (sessionState === 'missing') {
    res.status(401).json({ error: 'Account no longer exists.', code: 'UNAUTHORIZED' });
    return;
  }
  if (isTokenEpochStale(user.pwdEpoch, sessionState.pwdEpoch)) {
    res.status(401).json({
      error: 'Your session was revoked because your password changed. Please sign in again.',
      code: 'SESSION_REVOKED',
    });
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

// ── Live session-state re-verification (privilege-lag + revocation fix) ──
// The JWT carries the role and pwdEpoch assigned at login for up to 8h. If a
// master demotes an admin (or an admin changes a user's role), or ANY user's
// password is changed/reset, the stale JWT would otherwise keep granting its
// original access until expiry. We re-verify the live DB state (role +
// pwdEpoch in one query), cached for 30s to bound DB load, and invalidate the
// cache cluster-wide on every such event.
const ROLE_CACHE_TTL_MS = 30_000;
interface SessionStateEntry {
  role: string;
  pwdEpoch: number;
  expires: number;
}
const sessionStateCache = new Map<string, SessionStateEntry>();

/**
 * Live session state for a user:
 *  - { role, pwdEpoch } — current DB values,
 *  - 'missing'          — the user record no longer exists,
 *  - null               — check could not run (transient DB error); callers
 *                         MUST treat this as fail-closed (503).
 */
async function getUserSessionState(
  userId: string,
): Promise<{ role: string; pwdEpoch: number } | 'missing' | null> {
  const cached = sessionStateCache.get(userId);
  if (cached && cached.expires > Date.now()) {
    return { role: cached.role, pwdEpoch: cached.pwdEpoch };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, pwdEpoch: true },
    });
    if (!user) return 'missing';
    sessionStateCache.set(userId, {
      role: user.role,
      pwdEpoch: user.pwdEpoch,
      expires: Date.now() + ROLE_CACHE_TTL_MS,
    });
    return { role: user.role, pwdEpoch: user.pwdEpoch };
  } catch (err) {
    console.error('[auth] Failed to verify session state (fail-closed):', err);
    return null;
  }
}

async function getLiveRole(userId: string): Promise<string | null> {
  const state = await getUserSessionState(userId);
  return state && state !== 'missing' ? state.role : null;
}

/** Local-only applier (used by the cluster invalidation handler). */
function applyInvalidateLiveRoleCache(userId: string): void {
  sessionStateCache.delete(userId);
}

/**
 * Invalidate the session-state cache for a user. Call on any role change AND
 * any password change/reset. Fans out cluster-wide so demotions and
 * revocations apply on every replica immediately (not after the 30s TTL).
 */
export function invalidateLiveRoleCache(userId: string): void {
  applyInvalidateLiveRoleCache(userId);
  publishInvalidation({ type: 'invalidate-user', userId });
}

// ── Cluster invalidation subscriber ──
// Other replicas publish cache-invalidation commands here; apply them to the
// local caches. (SSE stream closures are handled by sse.ts's own handler.)
onInvalidationCommand((cmd) => {
  switch (cmd.type) {
    case 'invalidate-user':
      applyInvalidateLiveRoleCache(cmd.userId);
      break;
    case 'invalidate-company':
      applyInvalidateCompanyActiveCache(cmd.companyProfileId);
      break;
    case 'invalidate-employee-status':
      applyInvalidateEmployeeStatusCache(cmd.email, cmd.companyProfileId);
      break;
    default:
      break;
  }
});

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
