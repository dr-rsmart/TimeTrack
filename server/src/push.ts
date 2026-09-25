import prisma from './prisma.js';
import { logger } from './logger.js';

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
): Promise<void> {
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

  // Never let a caller-supplied `companyId` be silently overwritten, and never
  // send a payload without one when we know the tenant.
  const payload: Record<string, unknown> =
    companyProfileId && data.companyId === undefined
      ? { ...data, companyId: companyProfileId }
      : data;

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
  const devices = await prisma.devicePushToken.findMany({
    where: {
      companyProfileId,
      isActive: true,
      user: { role: { in: ['admin', 'manager'] } },
    },
    select: { id: true, token: true },
  });
  if (devices.length === 0) return;

  const payload: Record<string, unknown> = {
    ...data,
    companyId: companyProfileId,
    type: 'attendance_alert',
  };
  await deliverPush(devices, title, body, payload);
}

/** Shared Expo delivery: send, then deactivate tokens Expo reports as invalid. */
async function deliverPush(
  devices: Array<{ id: string; token: string }>,
  title: string,
  body: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        devices.map((device) => ({
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
    };
    const invalidIds = devices
      .filter((_, index) => result.data?.[index]?.details?.error === 'DeviceNotRegistered')
      .map((device) => device.id);
    if (invalidIds.length > 0) {
      await prisma.devicePushToken.updateMany({
        where: { id: { in: invalidIds } },
        data: { isActive: false },
      });
    }
  } catch (error) {
    logger.warn('[push] Delivery failed:', error);
  }
}
