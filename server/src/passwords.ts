/**
 * Password & Session-Epoch Rules — Pure Logic Module
 * ===================================================
 * Extracted for unit testability and shared enforcement:
 * - DEFAULT_PASSWORD: the well-known temporary password assigned to
 *   provisioned/reset accounts (mustChangePassword forces rotation).
 * - isDefaultPasswordHash: bcrypt comparison against the default — used to
 *   block "keep current password" for default-password accounts.
 * - isTokenEpochStale: JWT revocation-on-rotation rule. Every password
 *   change bumps User.pwdEpoch; tokens carrying an older epoch are rejected.
 *
 * IMPORTANT: this module must stay dependency-light (no config/prisma
 * imports) so unit tests can import it without environment side effects.
 */

import bcrypt from 'bcryptjs';

/**
 * Known default password assigned to auto-created accounts and admin/master
 * password resets. Users on this password are flagged mustChangePassword.
 */
export const DEFAULT_PASSWORD = 'Password123';

/**
 * Returns true when the stored bcrypt hash matches the default password.
 * Safe against null/undefined hashes and malformed hash inputs.
 */
export async function isDefaultPasswordHash(
  passwordHash: string | null | undefined,
): Promise<boolean> {
  if (!passwordHash) return false;
  try {
    return await bcrypt.compare(DEFAULT_PASSWORD, passwordHash);
  } catch {
    return false;
  }
}

/**
 * Session-epoch revocation rule (JWT rotation-on-password-change).
 *
 * The JWT carries the user's `pwdEpoch` at sign time. Whenever a password is
 * changed or reset, the stored epoch is bumped and the user's session cache
 * is invalidated. Tokens with an older epoch are rejected on the next
 * request.
 *
 * Backwards compatibility: tokens signed before this feature existed carry
 * no `pwdEpoch` claim — that is treated as epoch 0, which matches the schema
 * default (0), so rollout does not force a platform-wide logout.
 */
export function isTokenEpochStale(
  tokenEpoch: number | null | undefined,
  currentEpoch: number | null | undefined,
): boolean {
  const token = typeof tokenEpoch === 'number' && Number.isFinite(tokenEpoch) ? tokenEpoch : 0;
  const current = typeof currentEpoch === 'number' && Number.isFinite(currentEpoch) ? currentEpoch : 0;
  return token !== current;
}
