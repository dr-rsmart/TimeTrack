/**
 * Stable Client Install Identifier (Feature Spec §7 device logging)
 * =================================================================
 * Punches are persisted with a `deviceId` so a disputed entry can be traced to
 * the device/install that captured it — e.g. to spot a colleague clocking in on
 * someone else's phone.
 *
 * Deliberately NOT a hardware identifier:
 *   - The mobile shell is a WebView of time-track.tech, so there is no native
 *     device API to reach for without a new Expo module and a fresh store
 *     review. A persisted random id gives the same forensic value for the
 *     "which install did this?" question.
 *   - It survives reloads and app restarts (localStorage), which is what makes
 *     it useful for correlating a series of punches.
 *   - It is per-install, not per-person: clearing site data rotates it. That is
 *     acceptable and is why the audit trail also records the authenticated user.
 *
 * Falls back to a per-session id when storage is unavailable (private browsing,
 * disabled cookies) so provenance degrades gracefully instead of throwing.
 */

const STORAGE_KEY = 'tt-device-id';

let cached: string | null = null;

/** Generate a reasonably-unique id without pulling in a dependency. */
function generateId(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) return `web-${cryptoObj.randomUUID()}`;
  // Fallback: timestamp + random, base36. Collisions are implausible for this use.
  const rand = Math.random().toString(36).slice(2, 10);
  return `web-${Date.now().toString(36)}-${rand}`;
}

/**
 * Return this install's stable identifier, creating and persisting it on first
 * call. Never throws — provenance must not be able to break a punch.
 */
export function getDeviceId(): string {
  if (cached) return cached;

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length > 0 && existing.length <= 128) {
      cached = existing;
      return cached;
    }
    const created = generateId().slice(0, 128);
    try {
      window.localStorage.setItem(STORAGE_KEY, created);
    } catch {
      // Storage write blocked — still return the id for this session.
    }
    cached = created;
  } catch {
    // No window/localStorage at all (SSR, tests): session-only id.
    cached = generateId().slice(0, 128);
  }
  return cached;
}

/** Test helper: drop the memo so the next call re-reads storage. */
export function __resetDeviceIdCache(): void {
  cached = null;
}
