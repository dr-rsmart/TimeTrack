/**
 * Pagination helpers — Phase 2 (2026-09-14)
 * ------------------------------------------
 * Standardizes collection-endpoint pagination:
 *   - `parsePagination` clamps limit/offset from the query string
 *     (no unchecked `parseInt(req.query.limit as string)` casts);
 *   - `sendPage` emits the `{ items, total, limit, offset }` envelope and
 *     X-Total-Count / X-Limit / X-Offset headers so both human and
 *     machine clients can page without guessing.
 */

import type { Request, Response } from 'express';

export interface PageMeta {
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function parsePagination(req: Request, defaults: { defaultLimit?: number } = {}): PageMeta {
  return {
    limit: clampInt(req.query.limit, defaults.defaultLimit ?? DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

/** Set X-Total-Count / X-Limit / X-Offset so clients can page without guessing. */
export function setPageHeaders(res: Response, total: number, meta: PageMeta): void {
  res.setHeader('X-Total-Count', String(total));
  res.setHeader('X-Limit', String(meta.limit));
  res.setHeader('X-Offset', String(meta.offset));
}

export function sendPage<T>(
  req: Request,
  res: Response,
  items: T[],
  total: number,
  meta: PageMeta,
): void {
  setPageHeaders(res, total, meta);
  res.json({ items, total, limit: meta.limit, offset: meta.offset });
}
