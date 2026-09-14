/**
 * CSRF Origin-Check Middleware
 * -----------------------------
 * Cookie-authenticated sessions are protected against cross-site request
 * forgery by validating the Origin header on state-changing requests:
 *
 *   - Browsers attach `Origin` to cross-origin requests AND to same-origin
 *     fetch POSTs (credentials: include), so the SPA's own requests always
 *     carry an allowed origin.
 *   - A hostile page on another origin cannot forge an allowed Origin — the
 *     browser owns that header — so a mismatched Origin is rejected.
 *   - Requests WITHOUT an Origin header (native mobile shell, non-browser
 *     clients using Bearer tokens) pass: CSRF requires a browser cookie jar,
 *     and the mobile shell authenticates with tokens, not cookies.
 *
 * This complements the SameSite=Lax cookie attribute as defense-in-depth.
 */

import type { Request, Response, NextFunction } from 'express';
import config from '../config.js';
import { sendError } from '../errorResponse.js';

const ALLOWED_ORIGINS = config.corsOrigin
  .split(',')
  .map((origin) => origin.trim().toLowerCase())
  .filter(Boolean);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfOriginCheck(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (SAFE_METHODS.has(method)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (!origin || typeof origin !== 'string') {
    // Non-browser client (no cookie jar, typically Bearer-authenticated).
    next();
    return;
  }

  if (ALLOWED_ORIGINS.includes(origin.toLowerCase())) {
    next();
    return;
  }

  sendError(res, 403, 'Cross-origin request rejected (CSRF protection).', {
    code: 'CSRF_REJECTED',
  });
}
