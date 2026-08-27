/**
 * Prometheus Metrics Route
 * ------------------------
 * GET /metrics — text exposition format for Prometheus scraping.
 * Unauthenticated by design (scraper endpoint); deploy behind the platform
 * edge / internal network only. No secrets are exposed — counters and
 * resource gauges only.
 */

import { Router } from 'express';
import { renderMetrics } from '../metrics.js';
import { getClientCount } from '../sse.js';
import { isRedisConfigured, getRedis } from '../redis.js';

export const metricsRouter = Router();

metricsRouter.get('/', (_req, res) => {
  const body = renderMetrics([
    {
      name: 'sse_active_clients',
      help: 'Currently connected SSE clients on this instance.',
      type: 'gauge',
      value: getClientCount(),
    },
    {
      name: 'redis_configured',
      help: 'Whether a Redis URL is configured (1) or not (0).',
      type: 'gauge',
      value: isRedisConfigured() ? 1 : 0,
    },
    {
      name: 'redis_connected',
      help: 'Whether the shared Redis client is currently usable (1) or not (0).',
      type: 'gauge',
      value: getRedis() ? 1 : 0,
    },
  ]);
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
});

export default metricsRouter;
