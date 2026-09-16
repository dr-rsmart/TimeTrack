/**
 * Native access-token lifetime contract (v1.3.1).
 *
 * The native shell bearer MUST share the httpOnly cookie's persistent
 * lifetime policy: getAuthToken prefers Bearer over the cookie, so any
 * `exp` minted by /native-token would silently shorten (and hijack) the
 * permanent cookie session — the v1.3.0 mobile kick-out incident.
 */
import { describe, expect, it, vi } from 'vitest';

// config.ts fails fast when required env is absent. vi.hoisted runs before
// the module imports below, so test-only placeholders exist by the time
// middleware/auth.ts evaluates config (mirrors vitest.config.ts's unit env).
vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'vitest-only-secret-0000000000000000000000000000';
  process.env.DATABASE_URL ??= 'postgresql://vitest:vitest@localhost:5432/vitest';
});

// Keep the module graph light: no generated Prisma client, no Redis fan-out.
vi.mock('@prisma/client', () => ({ PrismaClient: class {}, Prisma: {} }));
vi.mock('../../server/src/prisma.js', () => ({ default: {}, basePrisma: {} }));
vi.mock('../../server/src/invalidation.js', () => ({
  onInvalidationCommand: vi.fn(),
  publishInvalidation: vi.fn(),
}));

import { signToken, verifyToken } from '../../server/src/middleware/auth.js';

const user = {
  id: 'u1',
  email: 'lerato@timetrack.com',
  fullName: 'Lerato Employee',
  role: 'employee',
  companyProfileId: 'c1',
  pwdEpoch: 3,
} as never;

/** Decode a JWT payload WITHOUT verification (the node-env test double for jwt.decode). */
function decodePayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  expect(parts).toHaveLength(3);
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('native access token — persistent by default (v1.3.1)', () => {
  it('signs WITHOUT an exp claim when no options are passed', () => {
    const decoded = decodePayload(signToken(user));
    expect(decoded.exp).toBeUndefined();
  });

  it('round-trips the session identity through verifyToken', () => {
    const restored = verifyToken(signToken(user));
    expect(restored).toMatchObject({
      id: 'u1',
      email: 'lerato@timetrack.com',
      fullName: 'Lerato Employee',
      role: 'employee',
      companyProfileId: 'c1',
      pwdEpoch: 3,
    });
  });

  it('still honours an explicit expiresIn when a caller bounds the token', () => {
    const token = signToken(user, { expiresIn: '15m' });
    const decoded = decodePayload(token) as { exp: number; iat: number };
    expect(decoded.exp - decoded.iat).toBe(900);
    expect(verifyToken(token)).not.toBeNull();
  });

  it('rejects a bounded token once its explicit lifetime has elapsed', () => {
    const token = signToken(user, { expiresIn: '-1s' });
    expect(verifyToken(token)).toBeNull();
  });
});
