/**
 * Browser Web Push (VAPID) delivery — migration 25.
 * --------------------------------------------------
 * Delivers the same notifications as Expo push (push.ts) to users of the WEB
 * version, even when the TimeTrack tab is closed (service worker `push`).
 *
 * Configuration (server env):
 *   VAPID_PUBLIC_KEY   — base64url public key (also served to the browser)
 *   VAPID_PRIVATE_KEY  — base64url private key (secret)
 *   VAPID_SUBJECT      — mailto: or https: contact, e.g. mailto:support@time-track.tech
 * Generate a pair with:  npx web-push generate-vapid-keys
 *
 * When unconfigured the module is a silent no-op: attendance never depends on
 * push delivery.
 */

import webpush from 'web-push';
import prisma from './prisma.js';
import { logger } from './logger.js';

let configured: boolean | null = null;

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = getVapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:support@time-track.tech';
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (err) {
    logger.warn('[web-push] Invalid VAPID configuration — web push disabled:', err);
    configured = false;
  }
  return configured;
}

export function isWebPushConfigured(): boolean {
  return ensureConfigured();
}

export interface WebPushTarget {
  employeeEmail?: string;
  companyProfileId?: string | null;
  /** Restrict to users holding one of these roles (manager fan-out). */
  roles?: string[];
}

/** Best-effort fan-out to every active browser subscription matching the target. */
export async function deliverWebPush(
  target: WebPushTarget,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  if (!ensureConfigured()) return;
  const subs = await prisma.webPushSubscription.findMany({
    where: {
      isActive: true,
      ...(target.employeeEmail
        ? { employeeEmail: { equals: target.employeeEmail, mode: 'insensitive' } }
        : {}),
      ...(target.companyProfileId ? { companyProfileId: target.companyProfileId } : {}),
      ...(target.roles ? { user: { role: { in: target.roles as never } } } : {}),
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subs.length === 0) return;

  const payload = JSON.stringify({ title, body, data });
  const gone: string[] = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 60 * 60 },
      );
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      // 404/410 = subscription expired or revoked by the browser.
      if (status === 404 || status === 410) gone.push(sub.id);
      else logger.warn('[web-push] Delivery failed:', status ?? err);
    }
  }
  if (gone.length > 0) {
    await prisma.webPushSubscription.updateMany({
      where: { id: { in: gone } },
      data: { isActive: false },
    });
  }
}
