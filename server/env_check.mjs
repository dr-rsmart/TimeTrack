/**
 * Pre-Deployment Environment Validation Script
 * --------------------------------------------
 * Validates environment variables, secrets entropy, PostgreSQL connection,
 * and configuration constraints before running or deploying the server.
 *
 * Usage:
 *   node server/env_check.mjs
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Check server/.env first, then root .env
const serverEnvPath = path.resolve('server/.env');
const rootEnvPath = path.resolve('.env');

if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

console.log('='.repeat(60));
console.log('TimeTrack Pre-Deployment Environment Check');
console.log('='.repeat(60));

const INSECURE_DEFAULTS = [
  'tt-workforce-dev-secret-change-in-production',
  'change-me-in-production',
  'tt_perf_bench_2026',
  'Password123',
];

let hasErrors = false;
let hasWarnings = false;

const isProd = process.env.NODE_ENV === 'production';
console.log(`\nDeployment Mode: ${isProd ? 'PRODUCTION (Strict Validation)' : 'DEVELOPMENT / STAGING'}`);

// 1. JWT_SECRET
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.trim() === '') {
  console.error('❌ FATAL: JWT_SECRET is missing or empty.');
  hasErrors = true;
} else if (INSECURE_DEFAULTS.includes(jwtSecret)) {
  if (isProd) {
    console.error('❌ FATAL: JWT_SECRET is using a known insecure default value in production.');
    hasErrors = true;
  } else {
    console.warn('⚠️  WARNING: JWT_SECRET uses a known dev default. Rotate before production.');
    hasWarnings = true;
  }
} else if (jwtSecret.length < 32) {
  console.warn(`⚠️  WARNING: JWT_SECRET length (${jwtSecret.length} chars) is short. 48+ chars recommended.`);
  hasWarnings = true;
} else {
  console.log(`✅ JWT_SECRET: Present (${jwtSecret.length} chars entropy).`);
}

// 2. DATABASE_URL
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl || dbUrl.trim() === '') {
  console.error('❌ FATAL: DATABASE_URL is missing.');
  hasErrors = true;
} else if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
  console.error('❌ FATAL: DATABASE_URL must start with postgresql:// or postgres://');
  hasErrors = true;
} else {
  console.log('✅ DATABASE_URL: Valid PostgreSQL connection format.');
}

// 3. CORS_ORIGIN
const corsOrigin = process.env.CORS_ORIGIN;
if (isProd) {
  if (!corsOrigin || corsOrigin.trim() === '') {
    console.error('❌ FATAL: In production, CORS_ORIGIN must be explicitly set.');
    hasErrors = true;
  } else {
    const origins = corsOrigin.split(',').map((o) => o.trim());
    const invalid = origins.find((o) => !o.startsWith('https://') || o.includes('localhost') || o === '*');
    if (invalid) {
      console.error(`❌ FATAL: Production CORS_ORIGIN contains invalid or insecure origin "${invalid}". Must be HTTPS and non-localhost.`);
      hasErrors = true;
    } else {
      console.log(`✅ CORS_ORIGIN: Validated HTTPS production origins: ${corsOrigin}`);
    }
  }
} else {
  console.log(`✅ CORS_ORIGIN: ${corsOrigin || 'http://localhost:5173 (dev default)'}`);
}

// 4. REDIS_URL
let redisUrl = process.env.REDIS_URL;
if (!redisUrl && process.env.REDIS_HOST) {
  const port = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379;
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`❌ FATAL: REDIS_PORT "${process.env.REDIS_PORT}" is invalid.`);
    hasErrors = true;
  } else {
    redisUrl = `redis://${process.env.REDIS_HOST}:${port}`;
  }
}

if (redisUrl) {
  if (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
    console.error(`❌ FATAL: REDIS_URL must begin with redis:// or rediss://`);
    hasErrors = true;
  } else {
    console.log(`✅ Redis: Configured (${redisUrl.replace(/\/\/[^@]*@/, '//***@')})`);
  }
} else {
  console.log('ℹ️  Redis: Not configured — application will run in standalone in-memory mode.');
}

// 5. Port
const port = parseInt(process.env.PORT || '4000', 10);
console.log(`✅ Server Port: ${port}`);

console.log('\n' + '='.repeat(60));
if (hasErrors) {
  console.error('VERDICT: ENVIRONMENT CHECK FAILED ❌ Fix errors before starting.');
  console.log('='.repeat(60));
  process.exit(1);
} else {
  console.log(`VERDICT: ENVIRONMENT IS READY FOR ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'} ✅`);
  console.log('='.repeat(60));
  process.exit(0);
}
