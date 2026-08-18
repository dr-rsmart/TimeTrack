/**
 * Central Health & Observability Routes
 * -------------------------------------
 * Dedicated load-balancer and monitoring endpoints:
 *  - /health (or /api/health): Deep health check (DB, Redis, memory, SSE clients)
 *  - /ping (or /api/ping): Lightweight keep-alive probe
 *  - /ready (or /api/ready): Kubernetes readiness probe (PostgreSQL connectivity)
 *  - /live (or /api/live): Kubernetes liveness probe (Process uptime)
 */

import { Router, type Request, type Response } from 'express';
import prisma from '../prisma.js';
import config from '../config.js';
import { checkRedisHealth } from '../redis.js';
import { getClientCount } from '../sse.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const dbLatency = Date.now() - startTime;
    const redisHealth = await checkRedisHealth();

    const mem = process.memoryUsage();
    const payload = {
      status: 'ok',
      version: '1.0.0',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database: {
        status: 'healthy',
        latencyMs: dbLatency,
      },
      redis: {
        configured: redisHealth.configured,
        status: redisHealth.configured
          ? redisHealth.status === 'healthy'
            ? 'connected'
            : 'degraded'
          : 'standalone_in_memory',
        latencyMs: redisHealth.latencyMs,
        ...(redisHealth.error && !config.isProduction ? { error: redisHealth.error } : {}),
      },
      realtime: {
        activeClients: getClientCount(),
      },
      system: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      },
    };

    res.status(200).json(payload);
  } catch (err: any) {
    res.status(503).json({
      status: 'degraded',
      error: 'Database unavailable',
      details: config.isProduction ? 'Database ping failed' : (err?.message || 'Database ping failed'),
      timestamp: new Date().toISOString(),
    });
  }
});

healthRouter.get('/ping', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'pong', timestamp: new Date().toISOString() });
});

healthRouter.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ ready: true, status: 'ready', timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(503).json({
      ready: false,
      status: 'unhealthy',
      error: config.isProduction ? 'Database connection not ready' : (err?.message || 'Database connection not ready'),
      timestamp: new Date().toISOString(),
    });
  }
});

healthRouter.get('/live', (_req: Request, res: Response): void => {
  res.status(200).json({
    live: true,
    status: 'alive',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default healthRouter;
