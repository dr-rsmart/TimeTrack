/**
 * Audit Service
 * -------------
 * Immutable audit logging with before/after diff tracking.
 */

import type { Request } from 'express';
import { logger } from './logger.js';
import { Prisma } from '@prisma/client';
import prisma, { getAmbientTransaction } from './prisma.js';
import { runUnrestricted } from './tenantDatabase.js';
import { recordAuditWriteFailure } from './metrics.js';

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/** Redact IP for non-admin viewers (GDPR/POPIA compliance). */
export function redactIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(':')) {
    // IPv6: keep first group
    const parts = ip.split(':');
    return `${parts[0]}...`;
  }
  // IPv4: keep first octet
  const parts = ip.split('.');
  return `${parts[0]}...`;
}

/** Compute a before/after diff between two objects. */
export function computeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> | null {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (['createdAt', 'updatedAt', 'version'].includes(key)) continue;
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes[key] = { before: b ?? null, after: a ?? null };
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

export interface AuditEntry {
  entity: string;
  entityId: string;
  action: string;
  actorId: string;
  actorEmail: string;
  actorRole: string;
  changes?: Record<string, { before: unknown; after: unknown }> | null;
  justification?: string | null;
  ipAddress?: string | null;
  branch?: string | null;
  department?: string | null;
  /**
   * Tenant scope for the audit event. When omitted, it is resolved from the
   * actor's company so that every audit row is tenant-isolated. Platform-level
   * events (master operators) intentionally remain null.
   */
  companyProfileId?: string | null;
  /** Compliance-critical callers emit an operationally visible failure metric. */
  required?: boolean;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  const doWrite = async (): Promise<void> => {
    let companyProfileId = entry.companyProfileId ?? null;

    // Fallback: resolve the tenant from the actor so audit rows are always
    // scoped to the company the actor belongs to (tenant isolation).
    if (companyProfileId === null && entry.actorId) {
      const actor = await prisma.user.findUnique({
        where: { id: entry.actorId },
        select: { companyProfileId: true },
      });
      companyProfileId = actor?.companyProfileId ?? null;
    }

    await prisma.auditLog.create({
      data: {
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        actorId: entry.actorId,
        actorEmail: entry.actorEmail,
        actorRole: entry.actorRole,
        changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
        justification: entry.justification ?? undefined,
        ipAddress: entry.ipAddress ?? undefined,
        branch: entry.branch ?? undefined,
        department: entry.department ?? undefined,
        companyProfileId: companyProfileId ?? undefined,
      },
    });
  };

  try {
    // RLS-aware write: inside a bridged request the ambient transaction
    // carries the tenant context; otherwise (fire-and-forget calls that
    // outlive the request, cron, scripts) run in a dedicated unrestricted
    // transaction so the append-only audit row can never be silently
    // dropped by row-level security.
    if (getAmbientTransaction()) {
      await doWrite();
    } else {
      await runUnrestricted(() => doWrite());
    }
  } catch (err) {
    logger.error({ err }, '[audit] Failed to write audit log:');
    if (entry.required) recordAuditWriteFailure();
  }
}
