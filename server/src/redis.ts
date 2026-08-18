/**
 * Redis Client — Shared Connection for Rate Limiting & Caching
 * -------------------------------------------------------------
 * Provides a lazily-connected Redis client with graceful degradation:
 * if REDIS_URL is not set or the connection fails, callers fall back
 * to in-memory behavior (single-instance mode).
 *
 * Used by:
 *   - middleware/rateLimit.ts  (distributed sliding-window rate limiting)
 *   - sse.ts                   (pub/sub fan-out — has its own connections)
 *
 * Multi-instance deployments MUST set REDIS_URL so rate limits and
 * caches are shared across all API replicas.
 */

import { Redis } from 'ioredis';
import config from './config.js';

const redisUrl = config.redisUrl;

let client: Redis | null = null;
let connected = false;

if (redisUrl) {
  try {
    client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      keepAlive: 10_000,
      connectTimeout: 10_000,
      commandTimeout: 5_000,
      enableOfflineQueue: false, // fail fast instead of queueing
      retryStrategy: (times) => {
        // Exponential backoff with jitter: min 100ms, max 3000ms
        const delay = Math.min(100 * Math.pow(2, Math.min(times, 5)), 3000);
        return delay + Math.floor(Math.random() * 200);
      },
      reconnectOnError: (err) => {
        // Automatically reconnect on AWS ElastiCache / Redis Sentinel failover
        if (err.message.includes('READONLY')) {
          return 2; // Reconnect and retry failed command
        }
        return false;
      },
    });

    client.on('connect', () => {
      connected = true;
      console.log('[redis] Connected — distributed rate limiting active.');
    });

    client.on('error', (err) => {
      if (connected) {
        console.warn('[redis] Connection error (falling back to in-memory):', err.message);
      }
      connected = false;
    });

    client.on('close', () => {
      connected = false;
    });

    // Non-blocking connect
    client.connect().catch((err) => {
      console.warn('[redis] Initial connection unavailable (in-memory fallback):', err.message);
    });
  } catch (err) {
    console.warn('[redis] Setup failed (in-memory fallback):', err);
    client = null;
  }
} else {
  console.log('[redis] REDIS_URL not set — using in-memory rate limiting (single-instance mode).');
}

/** Returns the Redis client if connected, otherwise null (caller falls back). */
export function getRedis(): Redis | null {
  if (client && (client.status === 'ready' || client.status === 'connect')) {
    return client;
  }
  return null;
}

/** Whether Redis is configured (regardless of current connection state). */
export function isRedisConfigured(): boolean {
  return client !== null;
}

/**
 * Health probe for Redis.
 * Returns response latency if connected, or failure diagnostics.
 */
export async function checkRedisHealth(): Promise<{
  configured: boolean;
  status: 'healthy' | 'degraded' | 'not_configured';
  latencyMs?: number;
  error?: string;
}> {
  if (!client) {
    return { configured: false, status: 'not_configured' };
  }

  const start = Date.now();
  try {
    const pingPromise = client.ping();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Redis ping timed out after 2000ms')), 2000)
    );
    await Promise.race([pingPromise, timeoutPromise]);
    return {
      configured: true,
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      configured: true,
      status: 'degraded',
      latencyMs: Date.now() - start,
      error: err?.message || 'Redis ping failed',
    };
  }
}

export default getRedis;
