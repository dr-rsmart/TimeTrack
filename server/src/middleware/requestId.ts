/**
 * Request Correlation ID & Structured Logging Middleware
 * --------------------------------------------------------
 * Assigns a unique X-Request-Id to every HTTP request, exposes it
 * on the request context and response headers, and logs structured
 * access logs with duration, status code, and tenant context.
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface RequestWithId extends Request {
  id?: string;
  startTime?: number;
}

export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const incomingId = req.header('x-request-id') || req.header('x-correlation-id');
  const requestId = (incomingId && typeof incomingId === 'string' && incomingId.length <= 128)
    ? incomingId
    : crypto.randomUUID();

  req.id = requestId;
  req.startTime = Date.now();
  res.setHeader('X-Request-Id', requestId);

  // Structured logging on response finish (skips health check noise in development)
  res.on('finish', () => {
    const duration = req.startTime ? Date.now() - req.startTime : 0;
    const isHealthCheck = req.path === '/health' || req.path === '/api/health';
    
    if (isHealthCheck && res.statusCode === 200 && process.env.NODE_ENV !== 'production') {
      return;
    }

    const authUser = (req as any).authUser;
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: req.socket.remoteAddress || 'unknown',
      userId: authUser?.id || undefined,
      tenantId: authUser?.companyProfileId || undefined,
      role: authUser?.role || undefined,
    };

    if (process.env.NODE_ENV === 'production') {
      // Production: structured single-line JSON output for log collectors (Loki, Datadog, CloudWatch)
      console.log(JSON.stringify(logEntry));
    } else if (res.statusCode >= 400 || duration > 500) {
      console.log(`[http] ${req.method} ${req.originalUrl || req.url} ${res.statusCode} in ${duration}ms (req: ${requestId.slice(0, 8)})`);
    }
  });

  next();
}

export default requestIdMiddleware;
