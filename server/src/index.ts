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
import { addClient, getClientCount } from './sse.js';
import { startCron, stopCron } from './cron.js';
import { getRedis, isRedisConfigured, checkRedisHealth } from './redis.js';
import { requestIdMiddleware } from './middleware/requestId.js';
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
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const app = express();
const server = http.createServer(app);
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
const PORT = config.port;
const CORS_ORIGIN = config.corsOrigin;

// ── Middleware ──
app.use(requestIdMiddleware);
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

// ── Startup: ensure every employee has a login User account (default Password123) ──
async function syncEmployeeUserAccounts() {
  try {
    const employees = await prisma.employee.findMany({
      select: { id: true, email: true, firstName: true, surname: true, role: true, companyProfileId: true }
    });
    const emails = employees.map((e) => e.email.toLowerCase());
    const existingUsers = await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } });
    const existingSet = new Set(existingUsers.map((u) => u.email.toLowerCase()));

    const missing = employees.filter((e) => !existingSet.has(e.email.toLowerCase()));
    if (missing.length === 0) {
      console.log('[server] User account sync: all employees have login accounts.');
      return;
    }

    const passwordHash = await bcrypt.hash('Password123', 10);
    // High-performance batch insertion. Accounts provisioned with the default
    // password are flagged mustChangePassword so login forces a rotation.
    await prisma.user.createMany({
      data: missing.map((emp) => ({
        email: emp.email.toLowerCase(),
        fullName: `${emp.firstName} ${emp.surname}`,
        role: (['master', 'admin', 'manager', 'employee'].includes(emp.role) ? emp.role : 'employee') as 'master' | 'admin' | 'manager' | 'employee',
        passwordHash,
        mustChangePassword: true,
        companyProfileId: emp.companyProfileId,
      })),
      skipDuplicates: true,
    });
    console.log(`[server] User account sync: batch created ${missing.length} login account(s) with default password "Password123".`);
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
  
  // Run seed script in production if SEED_ON_START is set
  if (process.env.SEED_ON_START === 'true') {
    console.log('[server] Running seed script...');
    try {
      const { stdout, stderr } = await execAsync('cd server && npm run seed');
      console.log('[server] Seed output:', stdout);
      if (stderr) console.error('[server] Seed errors:', stderr);
    } catch (err) {
      console.error('[server] Seed failed:', err);
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
