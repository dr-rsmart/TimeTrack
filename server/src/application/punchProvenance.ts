/**
 * Punch Provenance & Corrective Duplicate Flagging (Feature Spec §7)
 * ==================================================================
 * Runs immediately AFTER a clock-in row is committed. It does two jobs that
 * deliberately do not belong inside the attendance transaction:
 *
 *  1. PROVENANCE — persist where the device actually was (`punchLatitude` /
 *     `punchLongitude`) and which install took the punch (`deviceId`). The
 *     pre-existing `geofence*` columns record the FENCE that matched, which is
 *     not the same fact: an employee can be inside a 200 m fence while standing
 *     180 m from the door. Disputes need the raw coordinates.
 *
 *  2. CORRECTIVE DUPLICATE FLAG — `reclockGuard.ts` PREVENTS most double
 *     punches, but it is bypassed for manager/admin proxy punches and cannot
 *     see offline-outbox replays that arrive out of order. Those land a second
 *     row; instead of rejecting them (losing a legitimate punch) we flag the
 *     NEWER row with `isFlaggedDuplicate` and point `duplicateOfId` at the
 *     surviving earlier entry. Payroll and the Notification Centre surface the
 *     pair for one-tap resolution.
 *
 * Both jobs are best-effort: a failure here must never fail a punch that has
 * already been persisted and audited. Errors are logged and swallowed.
 */

import prisma from '../prisma.js';
import { logger } from '../logger.js';
import {
  getDuplicateWindowSeconds,
  isDuplicatePunch,
  pickSurvivingEntry,
  describeDuplicateGap,
} from '../domain/duplicatePunch.js';

export interface PunchProvenanceInput {
  /** The freshly created entry. */
  entry: {
    id: string;
    employeeId: string | null;
    employeeEmail: string;
    companyProfileId: string;
    clockIn: Date;
  };
  /** Device coordinates captured with the punch, if the client supplied them. */
  position: { latitude: number; longitude: number } | null;
  /** Stable client install id, if the client supplied one. */
  deviceId?: string | null;
}

export interface PunchProvenanceResult {
  /** True when this entry was flagged as a duplicate of an earlier punch. */
  flaggedDuplicate: boolean;
  /** Seconds between the two punches, when a duplicate was detected. */
  gapSeconds: number | null;
}

const NO_FLAG: PunchProvenanceResult = { flaggedDuplicate: false, gapSeconds: null };

/**
 * Stamp provenance and flag corrective duplicates for a new clock-in.
 * Never throws — see the module header for why.
 */
export async function stampPunchProvenance(
  input: PunchProvenanceInput,
): Promise<PunchProvenanceResult> {
  const { entry, position, deviceId } = input;

  const data: Record<string, unknown> = {};
  if (position && Number.isFinite(position.latitude) && Number.isFinite(position.longitude)) {
    data.punchLatitude = position.latitude;
    data.punchLongitude = position.longitude;
  }
  if (deviceId && deviceId.trim().length > 0) {
    data.deviceId = deviceId.trim().slice(0, 128);
  }

  // ── Corrective duplicate detection ──
  const windowSeconds = getDuplicateWindowSeconds();
  let result: PunchProvenanceResult = NO_FLAG;

  if (windowSeconds > 0 && entry.employeeId) {
    try {
      // Look back far enough to cover the window on either side of this punch.
      const from = new Date(entry.clockIn.getTime() - windowSeconds * 1000);
      const to = new Date(entry.clockIn.getTime() + windowSeconds * 1000);

      const neighbours = await prisma.timeEntry.findMany({
        where: {
          companyProfileId: entry.companyProfileId,
          employeeId: entry.employeeId,
          id: { not: entry.id },
          clockIn: { gte: from, lte: to },
        },
        select: { id: true, clockIn: true },
        orderBy: { clockIn: 'asc' },
      });

      const twin = neighbours.find((n) =>
        isDuplicatePunch(n.clockIn, entry.clockIn, windowSeconds),
      );
      if (twin) {
        // The EARLIER clock-in survives; this newer row is the artefact.
        const { keepId } = pickSurvivingEntry(
          'clock_in',
          { id: twin.id, at: twin.clockIn },
          { id: entry.id, at: entry.clockIn },
        );
        data.isFlaggedDuplicate = true;
        data.duplicateOfId = keepId === entry.id ? twin.id : keepId;
        result = {
          flaggedDuplicate: true,
          gapSeconds: describeDuplicateGap(twin.clockIn, entry.clockIn),
        };
      }
    } catch (err) {
      logger.warn('[provenance] duplicate scan failed (punch already saved):', err);
    }
  }

  if (Object.keys(data).length === 0) return result;

  try {
    await prisma.timeEntry.update({ where: { id: entry.id }, data });
  } catch (err) {
    logger.warn('[provenance] stamp failed (punch already saved):', err);
    return NO_FLAG;
  }

  if (result.flaggedDuplicate) {
    logger.info(
      `[provenance] flagged duplicate clock-in entry=${entry.id} employee=${entry.employeeEmail} gap=${result.gapSeconds}s`,
    );
  }
  return result;
}
