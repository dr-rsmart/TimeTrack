/**
 * TimeTrack API Server
 * -----------------------
 * Express 5 + Prisma + PostgreSQL + Server-Sent Events Real-time
 */

// config must be imported first: it validates required secrets and fails fast
// before any other module touches the environment.
import config from './config.js';
import { logger } from './logger.js';
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
import { csrfOriginCheck } from './middleware/csrf.js';
import { tenantBridgeMiddleware, runUnrestricted } from './tenantDatabase.js';
import { buildOpenApiDocument } from './openapi.js';
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
// CSRF origin validation for state-changing requests (browser cookie
// sessions only — Origin-less clients pass through).
app.use(csrfOriginCheck);

// ── Tenant transaction bridge (DB-level tenant enforcement) ──
// Every /api request runs inside a transaction whose `app.current_tenant`
// setting drives the PostgreSQL RLS policies (migration 6). The transaction
// starts unrestricted for the pre-auth phase; requireAuth switches it to the
// caller's tenant. See tenantDatabase.ts.
app.use('/api', tenantBridgeMiddleware);
app.use('/api/v1', tenantBridgeMiddleware);

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
    // Real content-security policy for the SPA (Phase 4, 2026-09-14).
    // The app ships no third-party assets: scripts/styles/fonts are
    // same-origin, images additionally allow data:/blob:/https (avatars),
    // and connect-src allows the same-origin API/SSE plus future HTTPS
    // endpoints. style-src 'unsafe-inline' is required for framer-motion
    // and component-level inline style attributes.
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' https: wss:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
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

// Rate limiting is applied to the API routers below (authLimiter on the auth
// subtree's CREDENTIAL endpoints only, apiLimiter on everything else, for
// BOTH /api and /api/v1).

// ── Health, Liveness & Readiness Probes (mounted on root & /api) ──
app.use('/health', healthRoutes);
app.use('/api/health', healthRoutes);
app.use('/ready', (req, res, next) => {
  req.url = '/ready';
  healthRoutes(req, res, next);
});
app.use('/api/ready', (req, res, next) => {
  req.url = '/ready';
  healthRoutes(req, res, next);
});
app.use('/live', (req, res, next) => {
  req.url = '/live';
  healthRoutes(req, res, next);
});
app.use('/api/live', (req, res, next) => {
  req.url = '/live';
  healthRoutes(req, res, next);
});
app.use('/ping', (req, res, next) => {
  req.url = '/ping';
  healthRoutes(req, res, next);
});
app.use('/api/ping', (req, res, next) => {
  req.url = '/ping';
  healthRoutes(req, res, next);
});

// ── Prometheus metrics (scraper endpoint; counters/gauges only, no secrets) ──
app.use('/metrics', metricsRoutes);

// ── OpenAPI document (machine-readable API contract) ──
const openApiDocument = buildOpenApiDocument();
app.get('/api/docs', (_req, res) => {
  res.json(openApiDocument);
});
app.get('/api/v1/docs', (_req, res) => {
  res.json(openApiDocument);
});

// ── SSE endpoint ──
// The browser's EventSource automatically sends the Last-Event-ID header on
// reconnect. We forward it to addClient so missed events within the replay
// buffer window (500 events / 5 minutes) are re-delivered (at-least-once).
//
// Handshake-scoped bridge: requireAuth + the stream attach run inside an
// unrestricted tenant transaction that commits right after the handshake,
// so the long-lived stream itself never holds a database transaction
// (tenantBridgeMiddleware exempts /events).
app.get('/api/events', (req, res, next) => {
  const handshake = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => () => {
        if (settled) return;
        settled = true;
        fn();
      };
      // requireAuth sends its own 4xx responses WITHOUT calling next —
      // settle on response finish/close so the bridge transaction always
      // commits (or rolls back) promptly.
      res.once('finish', done(resolve));
      res.once('close', done(resolve));
      try {
        requireAuth(req, res, (err?: unknown) => done(err ? () => reject(err) : resolve)());
      } catch (err) {
        done(() => reject(err))();
      }
    });

    // Attach the stream client only when authentication actually succeeded.
    if (!req.authUser) return;

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
      lastEventId,
    );
  };

  runUnrestricted(handshake).catch((err) => next(err as Error));
});

// ── API routes (mounted on BOTH the legacy /api surface and the versioned
// /api/v1 surface). /api/v1 is the contract surface: pagination envelopes,
// OpenAPI docs and future breaking changes land there; /api stays
// backward-compatible for existing clients. ──
const apiRouter = express.Router();
// The strict auth limiter is IP-keyed and runs BEFORE authentication, so
// applying it to the whole /auth subtree let login abuse from a shared
// work-site NAT lock the ENTIRE site out of session traffic (/me, /logout,
// /native-token). Scope it to the credential-verification endpoints; the
// rest of the auth subtree stays protected by the general apiLimiter
// mounted at /api.
const CREDENTIAL_ENDPOINTS = new Set(['/login', '/forgot-password', '/native-token/refresh']);
const credentialAuthLimiter = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void => {
  const path = req.path.replace(/\/+$/, '') || '/';
  if (CREDENTIAL_ENDPOINTS.has(path)) {
    authLimiter(req, res, next);
    return;
  }
  next();
};
apiRouter.use('/auth', credentialAuthLimiter, authRoutes);
apiRouter.use('/employees', employeeRoutes);
apiRouter.use('/shifts', shiftRoutes);
apiRouter.use('/time-entries', timeEntryRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/reports', reportRoutes);
apiRouter.use('/settings', settingsRoutes);
apiRouter.use('/audit', auditRoutes);
apiRouter.use('/master', masterRoutes);

app.use('/api', apiLimiter, apiRouter);
app.use('/api/v1', apiLimiter, apiRouter);

// Versioned health probes for /api/v1 parity.
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/ready', (req, res, next) => {
  req.url = '/ready';
  healthRoutes(req, res, next);
});
app.use('/api/v1/live', (req, res, next) => {
  req.url = '/live';
  healthRoutes(req, res, next);
});
app.use('/api/v1/ping', (req, res, next) => {
  req.url = '/ping';
  healthRoutes(req, res, next);
});

// ── Static Frontend & SPA Fallback ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDistPath = path.resolve(__dirname, '../../dist');

if (fs.existsSync(staticDistPath)) {
  app.use(
    express.static(staticDistPath, {
      immutable: true,
      maxAge: config.isProduction ? '1y' : 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    }),
  );
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
app.use('/api/v1', notFoundHandler);

// ── Central Error handler ──
app.use(errorHandler);

// ── Startup: ensure every employee has a login User account (default password) ──
// Efficient single-query variant: a LEFT JOIN finds ONLY employees that do
// not yet have a login account, instead of loading both full tables on every
// boot (O(missing) instead of O(employees + users)). Chunked inserts keep
// memory flat for large backfills. Set AUTO_PROVISION_ACCOUNTS=false to
// disable provisioning entirely.
//
// NOTE (Phase 2, 2026-09-14): boot-time data mutation was removed here —
// the email-normalization and tenant auto-heal UPDATE statements now live in
// `npm run maintenance:normalize` (dry-run by default), and the partial
// unique index moved to migration 8_active_entry_partial_unique_index.
async function syncEmployeeUserAccounts() {
  if (process.env.AUTO_PROVISION_ACCOUNTS === 'false') {
    logger.info('[server] User account sync disabled (AUTO_PROVISION_ACCOUNTS=false).');
    return;
  }

  const syncStartedAt = Date.now();
  try {
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
      logger.info(
        `[server] User account sync: all employees have login accounts (${Date.now() - syncStartedAt}ms).`,
      );
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
          role: (['master', 'admin', 'manager', 'employee'].includes(emp.role)
            ? emp.role
            : 'employee') as 'master' | 'admin' | 'manager' | 'employee',
          passwordHash,
          mustChangePassword: true,
          companyProfileId: emp.companyProfileId,
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }
    logger.info(
      `[server] User account sync: created ${created} login account(s) with temporary password in ${Date.now() - syncStartedAt}ms.`,
    );
  } catch (err) {
    logger.error({ err }, '[server] User account sync failed:');
  }
}

// ── Start server ──
server.listen(PORT, async () => {
  logger.info(`[server] TimeTrack API running on port ${PORT}`);
  // Boot-time provisioning is a system concern: run it in an unrestricted
  // tenant transaction (RLS bridge).
  await runUnrestricted(() => syncEmployeeUserAccounts());
  startCron();

  // Optional convenience seeding for LOCAL DEVELOPMENT only.
  // SECURITY: the seed script is fully destructive — it deletes every table
  // and recreates demo data — so it must NEVER run in production, even if the
  // SEED_ON_START variable is accidentally carried over from a dev config.
  if (process.env.SEED_ON_START === 'true') {
    if (config.isProduction) {
      logger.error(
        '[server] SEED_ON_START=true is IGNORED in production: the seed script deletes all data. ' +
          'Remove this variable from the production environment.',
      );
    } else {
      logger.info('[server] Running seed script (development only)...');
      try {
        // Resolve the server directory relative to this module so the seed
        // runs correctly whether executing from src/ (tsx) or dist/ (build).
        const serverDir = path.resolve(__dirname, '..');
        const { stdout, stderr } = await execAsync('npm run seed', {
          cwd: serverDir,
          timeout: 300_000,
        });
        logger.info('[server] Seed output:', stdout);
        if (stderr) logger.error('[server] Seed errors:', stderr);
      } catch (err) {
        logger.error('[server] Seed failed:', err);
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
  logger.info(`[server] ${signal} received — starting graceful shutdown...`);

  stopCron();

  // Close all SSE streams immediately — long-lived event-stream connections
  // would otherwise hold the HTTP server open until the 10s force-exit timer
  // and delay zero-downtime deploys.
  closeAllClients();

  // Stop accepting new connections; existing in-flight requests get 10s to finish.
  server.close(() => {
    logger.info('[server] HTTP server closed.');
  });

  // Force-exit after 10s if connections refuse to drain.
  const forceExit = setTimeout(() => {
    logger.warn('[server] Forcing exit after 10s drain timeout.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await prisma.$disconnect();
    logger.info('[server] Database disconnected.');
  } catch (err) {
    logger.error('[server] Error disconnecting database:', err);
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[server] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, '[server] Uncaught Exception:');
  // Uncaught exceptions leave the process in an undefined state; initiate shutdown
  gracefulShutdown('uncaughtException').catch(() => process.exit(1));
});
