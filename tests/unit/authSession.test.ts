import { describe, expect, it } from 'vitest';
import {
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_OPTIONS,
  getAuthToken,
} from '../../server/src/authSession.js';

describe('authentication session policy', () => {
  it('uses a persistent far-future cookie without a product max-age', () => {
    expect(AUTH_COOKIE_NAME).toBe('tt_token');
    expect(AUTH_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(AUTH_COOKIE_OPTIONS.expires.getUTCFullYear()).toBe(9999);
    expect('maxAge' in AUTH_COOKIE_OPTIONS).toBe(false);
  });

  it('prefers a bearer token and falls back to the httpOnly cookie', () => {
    expect(
      getAuthToken({
        headers: { authorization: 'Bearer bearer-token' },
        cookies: { tt_token: 'cookie-token' },
      }),
    ).toBe('bearer-token');
    expect(getAuthToken({ headers: {}, cookies: { tt_token: 'cookie-token' } })).toBe(
      'cookie-token',
    );
    expect(getAuthToken({ headers: {}, cookies: {} })).toBeUndefined();
  });
});
