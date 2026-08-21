/**
 * Centralized Configuration
 * -------------------------
 * Fail-fast environment validation. The server refuses to boot if any
 * required secret is missing or still set to a known-insecure default.
 *
 * This eliminates the previous pattern of hardcoded fallback secrets
 * (e.g. `process.env.JWT_SECRET || 'TimeTrack-dev-secret...'`), which
 * allowed the app to silently run with a publicly-known signing key.
 */

import 'dotenv/config';

/** Known-insecure values that must never reach production. */
const INSECURE_DEFAULTS = [
  'TimeTrack-dev-secret-change-in-production',
  'change-me-in-production',
  'tt_perf_bench_2026',
];

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function fail(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[config] FATAL: ${msg}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    fail(`Missing required environment variable "${name}". Set it in server/.env before starting.`);
  }
  return value;
}

function rejectInsecure(name: string, value: string): void {
  if (INSECURE_DEFAULTS.includes(value)) {
    if (isProduction()) {
      fail(`Environment variable "${name}" is set to a known-insecure default. Rotate it before running in production.`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[config] WARNING: "${name}" uses a known-insecure default. This is only acceptable for local development.`);
    }
  }
}

function validateJwtSecret(secret: string): void {
  rejectInsecure('JWT_SECRET', secret);
  if (isProduction()) {
    if (secret.length < 32) {
      fail('JWT_SECRET must be at least 32 characters (256-bit entropy) in production.');
    }
  }
}

function validateCorsOrigin(origin: string): string {
  if (isProduction()) {
    const origins = origin.split(',').map((o) => o.trim());
    for (const o of origins) {
      if (!o.startsWith('https://')) {
        fail(`Production CORS_ORIGIN "${o}" must use HTTPS protocol.`);
      }
      if (o.includes('localhost') || o === '*') {
        fail(`Production CORS_ORIGIN cannot be localhost or wildcard '*'.`);
      }
    }
  }
  return origin;
}

// ── Required secrets (fail fast if absent) ──
const JWT_SECRET = requireEnv('JWT_SECRET');
validateJwtSecret(JWT_SECRET);

const DATABASE_URL = requireEnv('DATABASE_URL');
if (!DATABASE_URL.startsWith('postgresql://') && !DATABASE_URL.startsWith('postgres://')) {
  fail('DATABASE_URL must be a valid PostgreSQL connection string starting with postgresql:// or postgres://');
}

// ── Port & CORS configuration ──
const PORT = parseInt(process.env.PORT || '4000', 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  fail(`Invalid PORT: ${process.env.PORT}`);
}

// In production, CORS_ORIGIN must be explicitly set to prevent unintended cross-origin access.
const rawCorsOrigin = isProduction()
  ? requireEnv('CORS_ORIGIN')
  : (process.env.CORS_ORIGIN || 'http://localhost:5173');
const CORS_ORIGIN = validateCorsOrigin(rawCorsOrigin);

// ── Redis configuration ──
function resolveRedisUrl(): string | null {
  if (process.env.REDIS_URL) {
    const url = process.env.REDIS_URL.trim();
    if (!url.startsWith('redis://') && !url.startsWith('rediss://')) {
      fail('REDIS_URL must start with redis:// or rediss://');
    }
    return url;
  }
  if (process.env.REDIS_HOST) {
    const host = process.env.REDIS_HOST.trim();
    const port = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379;
    if (isNaN(port) || port < 1 || port > 65535) {
      fail(`Invalid REDIS_PORT: ${process.env.REDIS_PORT}`);
    }
    return `redis://${host}:${port}`;
  }
  return null;
}
const REDIS_URL = resolveRedisUrl();

// ── Performance-test bypass ──
// Only honored outside production. In production the bypass is disabled
// entirely so rate limiting cannot be switched off via a header.
const PERF_TEST_SECRET = isProduction() ? null : process.env.PERF_TEST_SECRET || null;

export const config = {
  isProduction: isProduction(),
  jwtSecret: JWT_SECRET,
  databaseUrl: DATABASE_URL,
  port: PORT,
  corsOrigin: CORS_ORIGIN,
  redisUrl: REDIS_URL,
  perfTestSecret: PERF_TEST_SECRET,
} as const;

export default config;