/**
 * Authentication session cookie policy.
 *
 * Sessions do not have a product expiration. The signed JWT is persistent and
 * is revoked by incrementing User.pwdEpoch on explicit logout or password
 * rotation. Account suspension, termination, and role checks remain enforced by
 * requireAuth on every request.
 *
 * Browsers may impose their own maximum cookie lifetime. The far-future expiry
 * plus the server-side revocation epoch means TimeTrack itself will not sign a
 * user out on a timer.
 */

export const AUTH_COOKIE_NAME = 'tt_token';

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  expires: new Date('9999-12-31T23:59:59.999Z'),
  path: '/',
};

export function getAuthToken(req: {
  headers: { authorization?: string | string[] };
  cookies?: Record<string, string | undefined>;
}): string | undefined {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7);
  }
  return req.cookies?.[AUTH_COOKIE_NAME];
}
