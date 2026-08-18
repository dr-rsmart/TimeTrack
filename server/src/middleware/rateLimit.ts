/**
 * Rate Limit Middleware — Redis-Backed Distributed Sliding Window
 * ----------------------------------------------------------------
 * Protects clock-in/clock-out and login endpoints from rapid-fire abuse.
 *
 * Storage strategy (automatic, zero-config):
 *   • REDIS_URL set + reachable → Redis sorted-set sliding window.
 *     Shared across ALL API instances → correct limits behind a load
 *     balancer, survives restarts, bounded memory (ZREMRANGEBYSCORE).
 *   • Otherwise → in-memory Map fallback (single-instance mode).
 *
 * Emits standard IETF RateLimit and Retry-After HTTP headers on all responses.
 */

import type { Request, Response, NextFunction } from 'express';
import config from '../config.js';
import { getRedis } from '../redis.js';

// ── In-memory fallback store ──
interface WindowEntry {
  timestamps: number[];
}

const buckets = new Map<string, WindowEntry>();

// Periodic cleanup of stale buckets (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets.entries()) {
    if (entry.timestamps.length === 0 || now - entry.timestamps[entry.timestamps.length - 1] > 10 * 60_000) {
      buckets.delete(key);
    }
  }
}, 5 * 60_000).unref();

function checkMemory(
  key: string,
  maxRequests: number,
  windowMs: number,
  now: number
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  let entry = buckets.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    buckets.set(key, entry);
  }
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
  if (entry.timestamps.length >= maxRequests) {
    const retryAfterSec = Math.ceil((windowMs - (now - entry.timestamps[0])) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  entry.timestamps.push(now);
  const remaining = Math.max(0, maxRequests - entry.timestamps.length);
  return { allowed: true, remaining, retryAfterSec: 0 };
}

async function checkRedis(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  key: string,
  maxRequests: number,
  windowMs: number,
  now: number
): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }> {
  const redisKey = `tt:rl:${key}`;
  const windowStart = now - windowMs;

  // Atomic sliding window via pipeline
  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(redisKey, 0, windowStart);
  pipeline.zcard(redisKey);
  const results = await pipeline.exec();

  const count = (results?.[1]?.[1] as number) ?? 0;
  if (count >= maxRequests) {
    // Find oldest timestamp in window for retry-after
    const oldest = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
    const oldestTs = oldest.length >= 2 ? parseInt(oldest[1], 10) : now;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldestTs)) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  // Record this request + set expiry so idle keys self-clean
  const addPipeline = redis.pipeline();
  addPipeline.zadd(redisKey, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);
  addPipeline.pexpire(redisKey, windowMs);
  await addPipeline.exec();

  const remaining = Math.max(0, maxRequests - (count + 1));
  return { allowed: true, remaining, retryAfterSec: 0 };
}

/**
 * Create a rate limiter middleware.
 * @param maxRequests Maximum requests allowed within the window
 * @param windowMs  Sliding window size in milliseconds
 * @param label     Human-friendly label for error messages
 */
export function rateLimit(maxRequests: number, windowMs: number, label = 'Too many requests') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Optional bypass header for distributed load testing runs.
    // DISABLED entirely in production (config.perfTestSecret is null there),
    // so rate limiting can never be switched off via a header in prod.
    if (config.perfTestSecret && req.headers['x-perf-bypass'] === config.perfTestSecret) {
      return next();
    }

    const authUser = (req as Request & { authUser?: { id: string } }).authUser;
    const identity = authUser?.id ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${req.method}:${req.path}:${identity}`;
    const now = Date.now();

    let result: { allowed: boolean; remaining: number; retryAfterSec: number };
    const redis = getRedis();

    if (redis) {
      try {
        result = await checkRedis(redis, key, maxRequests, windowMs, now);
      } catch (err: any) {
        // Redis failure → degrade gracefully to in-memory (never block requests)
        console.warn(`[rateLimit] Redis error on ${key}, degrading to in-memory:`, err?.message);
        result = checkMemory(key, maxRequests, windowMs, now);
      }
    } else {
      result = checkMemory(key, maxRequests, windowMs, now);
    }

    // Standard HTTP Rate Limit Headers
    res.setHeader('RateLimit-Limit', maxRequests);
    res.setHeader('RateLimit-Remaining', result.remaining);
    res.setHeader('RateLimit-Reset', Math.ceil(windowMs / 1000));

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfterSec);
      res.status(429).json({
        error: `${label}. Please try again in ${result.retryAfterSec}s.`,
        code: 'RATE_LIMITED',
        retryAfter: result.retryAfterSec,
      });
      return;
    }

    next();
  };
}

/** Clock-in/out limiter: 10 punches per minute per user. */
export const clockRateLimit = rateLimit(10, 60_000, 'Clock-in/out requests are too frequent');

/** Login limiter: 10 attempts per 5 minutes per identity (brute-force protection). */
export const loginRateLimit = rateLimit(10, 5 * 60_000, 'Too many login attempts');
