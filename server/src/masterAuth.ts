/**
 * Master Route Authorization — Pure Logic Module
 * ===============================================
 * Least-privilege rule for the /master route surface, extracted from
 * routes/master.ts for unit testability.
 *
 * SECURITY: impersonation/demo sessions carry originalRole === 'master' but
 * must NOT retain the full master governance surface while simulating a
 * tenant persona — they are only permitted to exit impersonation. Every
 * other master endpoint requires the live role to actually be 'master'.
 */

export interface MasterAuthUserLike {
  role?: string | null;
  originalRole?: string | null;
}

/** Router-relative path that impersonation sessions are still allowed to call. */
export const IMPERSONATION_EXIT_PATH = '/stop-impersonation';

/**
 * Decide whether a request may proceed on the master router.
 * @param authUser  Decoded JWT auth user (may be absent).
 * @param routerPath Request path relative to the /master router mount
 *                   (e.g. '/stop-impersonation', '/companies', '/stats').
 */
export function isMasterAuthorized(
  authUser: MasterAuthUserLike | null | undefined,
  routerPath: string,
): boolean {
  if (!authUser) return false;

  // Platform masters keep the full surface.
  if (authUser.role === 'master') return true;

  // Impersonation/demo sessions may only restore the master session.
  return authUser.originalRole === 'master' && routerPath === IMPERSONATION_EXIT_PATH;
}
