import { describe, expect, it, vi } from 'vitest';
import { csrfOriginCheck } from '../../server/src/middleware/csrf.js';

type MiddlewareArgs = Parameters<typeof csrfOriginCheck>;

function fakeReq(overrides: { method: string; origin?: string }): MiddlewareArgs[0] {
  return {
    method: overrides.method,
    headers: overrides.origin ? { origin: overrides.origin } : {},
  } as unknown as MiddlewareArgs[0];
}

function fakeRes() {
  const res: {
    statusCode: number;
    body: unknown;
    status: (code: number) => typeof res;
    json: (body: unknown) => typeof res;
  } = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res as MiddlewareArgs[1] & typeof res;
}

describe('CSRF origin-check middleware', () => {
  it('allows safe methods regardless of origin', () => {
    const res = fakeRes();
    const next = vi.fn();
    csrfOriginCheck(fakeReq({ method: 'GET', origin: 'https://evil.example' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('allows state-changing requests from an allowed origin', () => {
    const res = fakeRes();
    const next = vi.fn();
    csrfOriginCheck(fakeReq({ method: 'POST', origin: 'http://localhost:5173' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('rejects state-changing requests from a foreign origin with CSRF_REJECTED', () => {
    const res = fakeRes();
    const next = vi.fn();
    csrfOriginCheck(fakeReq({ method: 'POST', origin: 'https://evil.example' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.body as { code?: string }).code).toBe('CSRF_REJECTED');
  });
  it('passes state-changing requests with no Origin header (non-browser clients)', () => {
    const res = fakeRes();
    const next = vi.fn();
    csrfOriginCheck(fakeReq({ method: 'POST' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});
