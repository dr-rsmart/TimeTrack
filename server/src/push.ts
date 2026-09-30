import prisma from './prisma.js';
import { logger } from './logger.js';
import { recordPushSent, recordPushFailed, recordPushTokensDeactivated } from './metrics.js';
import { deliverWebPush } from './webPush.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Best-effort push delivery; attendance persistence never depends on Expo.
 *
 * Spec §2/§8 — tenant isolation on notifications:
 *   - Tokens are looked up scoped to `companyProfileId` when the caller knows it,
 *     so an employee who once worked for company A cannot receive company B's
 *     shift reminders from a stale registration. (Email alone is NOT a tenant
 *     key: the same person can legitimately hold accounts in two companies.)
 *   - `companyId` is injected into the Expo `data` payload so the native client
 *     can discard a notification that does not match the profile the user is
 *     currently signed into — defence in depth for the multi-company manager
 *     switcher.
 */
export async function notifyEmployeePush(
  employeeEmail: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  companyProfileId?: string | null,
  options: { skipExpo?: boolean } = {},
): Promise<void> {
  // Never let a caller-supplied `companyId` be silently overwritten, and never
  // send a payload without one when we know the tenant.
  const payload: Record<string, unknown> =
    companyProfileId && data.companyId === undefined
      ? { ...data, companyId: companyProfileId }
      : data;

  // Browser Web Push (web-version users) — independent, best-effort.
  void deliverWebPush({ employeeEmail, companyProfileId }, title, body, payload).catch((err) =>
    logger.warn('[push] Web push fan-out failed:', err),
  );

  // skipExpo: the originating phone already raised a LOCAL notification for
  // this event (native background punch) — avoid a duplicate on that device.
  if (options.skipExpo) return;

  const devices = await prisma.devicePushToken.findMany({
    where: {
      employeeEmail: { equals: employeeEmail, mode: 'insensitive' },
      isActive: true,
      // Only constrain by tenant when we actually know it. Legacy rows and the
      // master cross-tenant path pass null and keep the previous behaviour.
      ...(companyProfileId ? { companyProfileId } : {}),
    },
    select: { id: true, token: true },
  });
  if (devices.length === 0) return;

  await deliverPush(devices, title, body, payload);
}

/**
 * Spec §3 "real-time push to managers (closed app)" — fan out a notification to
 * every active device registered by an admin or manager of ONE company. Used by
 * the cron attendance-alert digest so a manager who has closed the app still
 * learns about a duplicate punch or no-show the moment it is flagged.
 *
 * Tenant isolation (spec §8): `companyProfileId` is a hard filter on the token
 * lookup, and `companyId` is always stamped onto the Expo payload so the native
 * client can discard a notification that does not match the profile currently
 * signed in.
 */
export async function notifyCompanyManagersPush(
  companyProfileId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const payload: Record<string, unknown> = {
    ...data,
    companyId: companyProfileId,
    type: 'attendance_alert',
  };
  void deliverWebPush(
    { companyProfileId, roles: ['admin', 'manager'] },
    title,
    body,
    payload,
  ).catch((err) => logger.warn('[push] Manager web push fan-out failed:', err));

  const devices = await prisma.devicePushToken.findMany({
    where: {
      companyProfileId,
      isActive: true,
      user: { role: { in: ['admin', 'manager'] } },
    },
    select: { id: true, token: true },
  });
  if (devices.length === 0) return;
  await deliverPush(devices, title, body, payload);
}

/** Shared Expo delivery: send, then deactivate tokens Expo reports as invalid. */
async function deliverPush(
  devices: Array<{ id: string; token: string }>,
  title: string,
  body: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const invalidIds: string[] = [];

  // Expo's hard ceiling is 100 messages per request. Chunk at 90 to leave
  // headroom, and send chunks SEQUENTIALLY (not Promise.all) to respect Expo
  // rate limits and keep deterministic ordering.
  const CHUNK_SIZE = 90;
  for (let start = 0; start < devices.length; start += CHUNK_SIZE) {
    const chunk = devices.slice(start, start + CHUNK_SIZE);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          chunk.map((device) => ({
            to: device.token,
            title,
            body,
            data: payload,
            sound: 'default',
          })),
        ),
      });
      if (!response.ok) throw new Error(`Expo returned HTTP ${response.status}`);

      const result = (await response.json()) as {
        data?: Array<{ status?: string; details?: { error?: string } }>;
        errors?: Array<{ code?: string; message?: string }>;
      };

      // Top-level `errors[]` (batch-level rejection) — no per-message receipts,
      // so nothing can be mapped to a specific token. Surface and stop.
      if (result.errors?.length) {
        recordPushFailed();
        logger.warn(
          '[push] Expo batch error:',
          result.errors.map((e) => e.code ?? e.message ?? 'unknown').join(', '),
        );
        continue;
      }

      recordPushSent(chunk.length);

      // Per-message receipts. Guard on length so a short/malformed receipt list
      // can never be mis-mapped to the wrong device via index.
      const receipts = result.data ?? [];
      for (let i = 0; i < chunk.length && i < receipts.length; i += 1) {
        if (receipts[i]?.details?.error === 'DeviceNotRegistered') {
          invalidIds.push(chunk[i].id);
        }
      }
    } catch (error) {
      recordPushFailed();
      logger.warn('[push] Delivery failed:', error);
    }
  }

  if (invalidIds.length > 0) {
    await prisma.devicePushToken.updateMany({
      where: { id: { in: invalidIds } },
      data: { isActive: false },
    });
    recordPushTokensDeactivated(invalidIds.length);
  }
}
