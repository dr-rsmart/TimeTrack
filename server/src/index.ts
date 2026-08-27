/**
 * TimeTrack API Server
 * -----------------------
 * Express 5 + Prisma + PostgreSQL + Server-Sent Events Real-time
 */

// config must be imported first: it validates required secrets and fails fast
// before any other module touches the environment.
import config from './config.js';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';

import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './errorResponse.js';
import { addClient, getClientCount, closeAllClients } from './sse.js';
import { startCron, stopCron } from './cron.js';
import { getRedis, isRedisConfigured, checkRedisHealth } from './redis.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { recordHttpRequest } from './metrics.js';
import { DEFAULT_PASSWORD } from './passwords.js';
import prisma from './prisma.js';

import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employees.js';
import shiftRoutes from './routes/shifts.js';
import timeEntryRoutes from './routes/timeEntries.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';
import auditRoutes from './routes/audit.js';
import masterRoutes from './routes/master.js';
import healthRoutes from './routes/health.js';
import metricsRoutes from './routes/metrics.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const app = express();
// Railway's edge terminates TLS and proxies to this container. Trust exactly
// one hop so req.secure / req.protocol / req.ip reflect the real client
// instead of the edge proxy (required for HTTPS enforcement below and for
// correct per-client rate limiting).
app.set('trust proxy', 1);
const server = http.createServer(app);
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
const PORT = config.port;
const CORS_ORIGIN = config.corsOrigin;

// ── Middleware ──
app.use(requestIdMiddleware);

// ── Request metrics (Prometheus counters at GET /metrics) ──
app.use((_req, res, next) => {
  res.on('finish', () => recordHttpRequest(res.statusCode));
  next();
});

// ── Canonical Domain Redirect (www → apex) ──
// Both time-track.tech and www.time-track.tech are attached to this service
// in Railway. Redirect www to the apex so session cookies and CORS stay
// bound to a single canonical origin.
app.use((req, res, next) => {
  if (req.hostname === 'www.time-track.tech') {
    return res.redirect(301, `https://time-track.tech${req.originalUrl}`);
  }
  next();
});

// ── HTTPS Enforcement ──
// Defense-in-depth on top of Railway's edge "Force HTTPS" setting: any request
// that traversed the public edge with X-Forwarded-Proto: http (i.e. the client
// used plain HTTP) is permanently redirected to HTTPS. 301 for GET/HEAD, 308
// for all other methods so POST bodies/method are preserved on upgrade.
// Requests WITHOUT X-Forwarded-Proto never passed through the public edge
// (Railway healthchecks, localhost dev, internal probes) and are left alone.
app.use((req, res, next) => {
  if (req.secure) return next();
  if (!req.headers['x-forwarded-proto']) return next();

  // Open-redirect guard: never echo an arbitrary Host header back as a
  // redirect target. Only redirect hosts we serve publicly. The www variant
  // is already canonicalized to the apex above and never reaches here.
  const host = req.hostname;
  if (host !== 'time-track.tech' && !host.endsWith('.up.railway.app')) {
    return next();
  }

  const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308;
  return res.redirect(status, `https://${host}${req.originalUrl}`);
});

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ── Security Headers (helmet-equivalent without extra dependency) ──
// Defense-in-depth: CSP, HSTS, clickjacking, MIME sniffing, XSS filter.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=()');
  if (config.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Mixed-content safety net: over an HTTPS page the browser silently
    // upgrades any stray http:// subresource URL. Deliberately minimal — the
    // SPA and API are same-origin, so no source restrictions are needed yet.
    // Extend this policy explicitly before adding any third-party asset.
    // Not sent in dev: on a http://localhost page it would try to upgrade
    // same-origin requests to https and break local development.
    res.setHeader('Content-Security-Policy', 'upgrade-insecure-requests');
  }
  next();
});

// Rate limiting. The performance-testing bypass is only available outside
// production (config.perfTestSecret is null in prod), so rate limiting can
// never be disabled via a header in a production deployment.
const isPerfBypass = (req: express.Request) => {
  return Boolean(config.perfTestSecret && req.headers['x-perf-bypass'] === config.perfTestSecret);
};

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isPerfBypass,
  message: { error: 'Too many requests, please try again later.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isPerfBypass,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// ── Health, Liveness & Readiness Probes (mounted on root & /api) ──
app.use('/health', healthRoutes);
app.use('/api/health', healthRoutes);
app.use('/ready', (req, res, next) => { req.url = '/ready'; healthRoutes(req, res, next); });
app.use('/api/ready', (req, res, next) => { req.url = '/ready'; healthRoutes(req, res, next); });
app.use('/live', (req, res, next) => { req.url = '/live'; healthRoutes(req, res, next); });
app.use('/api/live', (req, res, next) => { req.url = '/live'; healthRoutes(req, res, next); });
app.use('/ping', (req, res, next) => { req.url = '/ping'; healthRoutes(req, res, next); });
app.use('/api/ping', (req, res, next) => { req.url = '/ping'; healthRoutes(req, res, next); });

// ── Prometheus metrics (scraper endpoint; counters/gauges only, no secrets) ──
app.use('/metrics', metricsRoutes);

// ── SSE endpoint ──
// The browser's EventSource automatically sends the Last-Event-ID header on
// reconnect. We forward it to addClient so missed events within the replay
// buffer window (500 events / 5 minutes) are re-delivered (at-least-once).
app.get('/api/events', requireAuth, (req, res) => {
  const authUser = req.authUser!;
  const lastEventId = (req.headers['last-event-id'] as string | undefined) ?? null;
  addClient(
    res,
    {
      id: authUser.id,
      role: authUser.role,
      companyProfileId: authUser.companyProfileId,
      branch: authUser.branch ?? null,
      department: authUser.department ?? null,
    },
    lastEventId
  );
});

// ── API routes ──
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/time-entries', timeEntryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/master', masterRoutes);

// ── Static Frontend & SPA Fallback ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDistPath = path.resolve(__dirname, '../../dist');

if (fs.existsSync(staticDistPath)) {
  app.use(express.static(staticDistPath));
  app.use((req, res, next) => {
    if (
      req.method !== 'GET' ||
      req.path.startsWith('/api') ||
      req.path.startsWith('/health') ||
      req.path.startsWith('/ready') ||
      req.path.startsWith('/live') ||
      req.path.startsWith('/ping')
    ) {
      return next();
    }
    res.sendFile(path.join(staticDistPath, 'index.html'));
  });
}

// ── 404 handler ──
app.use('/api', notFoundHandler);

// ── Central Error handler ──
app.use(errorHandler);

// ── Ensure PostgreSQL Partial Unique Indexes for Concurrency Guarantees ──
async function ensureDatabaseIndexes() {
  try {
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_time_entry_employee"
      ON "TimeEntry"("employeeEmail")
      WHERE status = 'active';
    `;
    console.log('[server] Database constraint: active time-entry partial unique index verified.');
  } catch (err) {
    console.warn('[server] Notice on partial index check:', err);
  }
}

// ── Startup: ensure every employee has a login User account (default password) ──
// Efficient single-query variant: a LEFT JOIN finds ONLY employees that do
// not yet have a login account, instead of loading both full tables on every
// boot (O(missing) instead of O(employees + users)). Chunked inserts keep
// memory flat for large backfills. Set AUTO_PROVISION_ACCOUNTS=false to
// disable provisioning entirely.
async function syncEmployeeUserAccounts() {
  if (process.env.AUTO_PROVISION_ACCOUNTS === 'false') {
    console.log('[server] User account sync disabled (AUTO_PROVISION_ACCOUNTS=false).');
    return;
  }

  const syncStartedAt = Date.now();
  try {
    // ── 0. Boot-time Email Normalization & Tenant Auto-Healing ──
    // Standardize all employee and user emails to trimmed lowercase to ensure
    // zero case-mismatch 404s on clock-in and profile lookups.
    await prisma.$executeRawUnsafe(`
      UPDATE "Employee" SET "email" = LOWER(TRIM("email")) WHERE "email" IS NOT NULL AND "email" != LOWER(TRIM("email"));
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE "User" SET "email" = LOWER(TRIM("email")) WHERE "email" IS NOT NULL AND "email" != LOWER(TRIM("email"));
    `);
    // Heal any Employee records with null companyProfileId if matching User has a companyProfileId
    await prisma.$executeRawUnsafe(`
      UPDATE "Employee" e
      SET "companyProfileId" = u."companyProfileId"
      FROM "User" u
      WHERE LOWER(TRIM(e."email")) = LOWER(TRIM(u."email"))
        AND e."companyProfileId" IS NULL
        AND u."companyProfileId" IS NOT NULL;
    `);

    const missing = await prisma.$queryRaw<
      Array<{
        id: string;
        email: string;
        firstName: string;
        surname: string;
        role: string;
        companyProfileId: string | null;
      }>
    >`
      SELECT e."id", e."email", e."firstName", e."surname", e."role", e."companyProfileId"
      FROM "Employee" e
      LEFT JOIN "User" u ON u."email" = lower(trim(e."email"))
      WHERE u."id" IS NULL
    `;

    if (missing.length === 0) {
      console.log(`[server] User account sync: all employees have login accounts (${Date.now() - syncStartedAt}ms).`);
      return;
    }

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    // Chunked batch insertion. Accounts provisioned with the default password
    // are flagged mustChangePassword; the server additionally rejects
    // keep-password for default hashes, so login forces a real rotation.
    const CHUNK_SIZE = 500;
    let created = 0;
    for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
      const batch = missing.slice(i, i + CHUNK_SIZE);
      const result = await prisma.user.createMany({
        data: batch.map((emp) => ({
          email: emp.email.toLowerCase(),
          fullName: `${emp.firstName} ${emp.surname}`,
          role: (['master', 'admin', 'manager', 'employee'].includes(emp.role) ? emp.role : 'employee') as 'master' | 'admin' | 'manager' | 'employee',
          passwordHash,
          mustChangePassword: true,
          companyProfileId: emp.companyProfileId,
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }
    console.log(
      `[server] User account sync: created ${created} login account(s) with temporary password in ${Date.now() - syncStartedAt}ms.`
    );
  } catch (err) {
    console.error('[server] User account sync failed:', err);
  }
}

// ── Start server ──
server.listen(PORT, async () => {
  console.log(`[server] TimeTrack API running on port ${PORT}`);
  await ensureDatabaseIndexes();
  await syncEmployeeUserAccounts();
  startCron();
  
  // Optional convenience seeding for LOCAL DEVELOPMENT only.
  // SECURITY: the seed script is fully destructive — it deletes every table
  // and recreates demo data — so it must NEVER run in production, even if the
  // SEED_ON_START variable is accidentally carried over from a dev config.
  if (process.env.SEED_ON_START === 'true') {
    if (config.isProduction) {
      console.error(
        '[server] SEED_ON_START=true is IGNORED in production: the seed script deletes all data. ' +
          'Remove this variable from the production environment.'
      );
    } else {
      console.log('[server] Running seed script (development only)...');
      try {
        // Resolve the server directory relative to this module so the seed
        // runs correctly whether executing from src/ (tsx) or dist/ (build).
        const serverDir = path.resolve(__dirname, '..');
        const { stdout, stderr } = await execAsync('npm run seed', {
          cwd: serverDir,
          timeout: 300_000,
        });
        console.log('[server] Seed output:', stdout);
        if (stderr) console.error('[server] Seed errors:', stderr);
      } catch (err) {
        console.error('[server] Seed failed:', err);
      }
    }
  }
});

// ── Graceful shutdown ──
// On SIGTERM/SIGINT (deploy, Ctrl+C): stop cron, stop accepting new
// connections, drain in-flight requests, then exit. This prevents
// interrupted transactions and orphaned SSE streams during deploys.
let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received — starting graceful shutdown...`);

  stopCron();

  // Close all SSE streams immediately — long-lived event-stream connections
  // would otherwise hold the HTTP server open until the 10s force-exit timer
  // and delay zero-downtime deploys.
  closeAllClients();

  // Stop accepting new connections; existing in-flight requests get 10s to finish.
  server.close(() => {
    console.log('[server] HTTP server closed.');
  });

  // Force-exit after 10s if connections refuse to drain.
  const forceExit = setTimeout(() => {
    console.warn('[server] Forcing exit after 10s drain timeout.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await prisma.$disconnect();
    console.log('[server] Database disconnected.');
  } catch (err) {
    console.error('[server] Error disconnecting database:', err);
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('[server] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught Exception:', err);
  // Uncaught exceptions leave the process in an undefined state; initiate shutdown
  gracefulShutdown('uncaughtException').catch(() => process.exit(1));
});
