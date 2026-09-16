import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  ApiError,
  api,
  authApi,
  registerSessionHandler,
  suppressUnauthenticatedErrors,
  type SessionErrorCode,
} from '../api';

type SessionHandler = (code: SessionErrorCode, message: string) => void;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let sessionHandler: Mock<SessionHandler>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  sessionHandler = vi.fn<SessionHandler>();
  registerSessionHandler(sessionHandler);
  sessionStorage.clear();
});

afterEach(() => {
  registerSessionHandler(null);
  vi.unstubAllGlobals();
  delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
});

describe('api client — success paths', () => {
  it('sends credentials + JSON content type and returns parsed body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const result = await api.get<{ ok: boolean }>('/thing');
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/thing');
    expect(init.credentials).toBe('include');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('returns undefined for 204 no content', async () => {
    fetchMock.mockResolvedValue(jsonResponse(204, null));
    await expect(api.delete('/thing/1')).resolves.toBeUndefined();
  });

  it('attaches the bearer token only inside the native shell', async () => {
    (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView = {};
    sessionStorage.setItem('timetrack_native_token', 'native-tok');
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await api.get('/x');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer native-tok');
  });

  it('never reads a bearer token from storage in a plain browser', async () => {
    sessionStorage.setItem('timetrack_native_token', 'native-tok');
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await api.get('/x');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });
});

describe('api client — session-state interceptor', () => {
  it('notifies UNAUTHENTICATED on 401 and throws ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Session expired' }));
    await expect(api.get('/employees')).rejects.toBeInstanceOf(ApiError);
    expect(sessionHandler).toHaveBeenCalledWith('UNAUTHENTICATED', 'Session expired');
  });

  it('does NOT treat login credential failures as session events', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Invalid credentials' }));
    await expect(authApi.login('a@b.c', 'wrong')).rejects.toBeInstanceOf(ApiError);
    expect(sessionHandler).not.toHaveBeenCalled();
  });

  it('does NOT treat change-password failures as session events', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Wrong current password' }));
    await expect(authApi.changePassword('old', 'new')).rejects.toBeInstanceOf(ApiError);
    expect(sessionHandler).not.toHaveBeenCalled();
  });

  it.each([
    ['COMPANY_SUSPENDED', 'Company suspended'],
    ['EMPLOYEE_TERMINATED', 'Employment terminated'],
    ['ROLE_REVOKED', 'Role revoked'],
  ])('notifies %s on 403', async (code, message) => {
    fetchMock.mockResolvedValue(jsonResponse(403, { code, error: message }));
    await expect(api.get('/dashboard')).rejects.toMatchObject({ status: 403, code });
    expect(sessionHandler).toHaveBeenCalledWith(code, message);
  });

  it('suppresses UNAUTHENTICATED while a voluntary logout is in flight', async () => {
    const restore = suppressUnauthenticatedErrors();
    // A fresh Response per call — body streams are single-use.
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(401, { error: 'Session expired' })),
    );
    await expect(api.get('/employees')).rejects.toBeInstanceOf(ApiError);
    expect(sessionHandler).not.toHaveBeenCalled();
    restore();
    await expect(api.get('/employees')).rejects.toBeInstanceOf(ApiError);
    expect(sessionHandler).toHaveBeenCalledWith('UNAUTHENTICATED', 'Session expired');
  });

  it('still surfaces suspension even while unauthenticated errors are suppressed', async () => {
    const restore = suppressUnauthenticatedErrors();
    fetchMock.mockResolvedValue(
      jsonResponse(403, { code: 'COMPANY_SUSPENDED', error: 'Company suspended' }),
    );
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(sessionHandler).toHaveBeenCalledWith('COMPANY_SUSPENDED', 'Company suspended');
    restore();
  });

  it('exposes validation details on ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: [{ path: 'email', message: 'required' }],
      }),
    );
    const err = (await api.post('/x', {}).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.details).toEqual([{ path: 'email', message: 'required' }]);
    expect(sessionHandler).not.toHaveBeenCalled();
  });
});

describe('api client — bridged bearer hygiene (native shell)', () => {
  function encodeSegment(value: unknown): string {
    return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Build an unsigned JWT-shaped token carrying the given payload claims. */
  function makeJwt(payload: Record<string, unknown>): string {
    return `${encodeSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeSegment(payload)}.test-sig`;
  }

  beforeEach(() => {
    (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView = {};
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
  });

  it('drops an expired legacy bearer, removes it from storage and falls back to the cookie', async () => {
    const expired = makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
    sessionStorage.setItem('timetrack_native_token', expired);
    await api.get('/x');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.credentials).toBe('include');
    expect(sessionStorage.getItem('timetrack_native_token')).toBeNull();
  });

  it('keeps and sends a persistent bearer (no exp claim)', async () => {
    const persistent = makeJwt({ id: 'u1' });
    sessionStorage.setItem('timetrack_native_token', persistent);
    await api.get('/x');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Bearer ${persistent}`);
    expect(sessionStorage.getItem('timetrack_native_token')).toBe(persistent);
  });

  it('keeps and sends a bearer whose exp is still in the future', async () => {
    const valid = makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 });
    sessionStorage.setItem('timetrack_native_token', valid);
    await api.get('/x');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Bearer ${valid}`);
    expect(sessionStorage.getItem('timetrack_native_token')).toBe(valid);
  });

  it('passes a malformed stored value through for the server to reject', async () => {
    sessionStorage.setItem('timetrack_native_token', 'not-a-jwt');
    await api.get('/x');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer not-a-jwt');
    expect(sessionStorage.getItem('timetrack_native_token')).toBe('not-a-jwt');
  });

  it('clears the stored bearer when logout settles', async () => {
    sessionStorage.setItem('timetrack_native_token', 'native-tok');
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));
    await authApi.logout();
    expect(sessionStorage.getItem('timetrack_native_token')).toBeNull();
  });
});
