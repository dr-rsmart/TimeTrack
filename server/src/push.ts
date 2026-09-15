import prisma from './prisma.js';
import { logger } from './logger.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Best-effort push delivery; attendance persistence never depends on Expo. */
export async function notifyEmployeePush(
  employeeEmail: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const devices = await prisma.devicePushToken.findMany({
    where: { employeeEmail: { equals: employeeEmail, mode: 'insensitive' }, isActive: true },
    select: { id: true, token: true },
  });
  if (devices.length === 0) return;

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        devices.map((device) => ({ to: device.token, title, body, data, sound: 'default' })),
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
