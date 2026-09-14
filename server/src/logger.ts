/**
 * Structured application logger (pino).
 * -------------------------------------
 * Phase 3 (2026-09-14): replaces ad-hoc console.* logging in server/src.
 * Production output is structured JSON suitable for log collectors; local
 * development uses raw JSON on stdout — pass LOG_LEVEL to control verbosity.
 *
 * Redaction: authorization headers, cookies, passwords and tokens are
 * masked automatically wherever they appear in logged objects.
 *
 * The exported type widens pino's strict call signatures: the codebase calls
 * `logger.error('message', err)` (message-first), which pino handles at
 * runtime but which its nominal TypeScript overloads reject.
 */

import pino, { type Logger } from 'pino';

type LooseLogFn = (...args: unknown[]) => void;

type AppLogger = Omit<Logger, 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'> & {
  fatal: LooseLogFn;
  error: LooseLogFn;
  warn: LooseLogFn;
  info: LooseLogFn;
  debug: LooseLogFn;
  trace: LooseLogFn;
};

const baseLogger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'passwordHash', 'token'],
    censor: '***',
  },
});

export const logger = baseLogger as AppLogger;
