import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stub @prisma/client so importing server/src/prisma.ts builds the REAL
// AsyncLocalStorage proxy against a fake client — no generated Prisma client
// and no live database required. vi.hoisted runs before the module imports
// below, so the stub exists by the time prisma.ts evaluates.
const { PrismaClientStub, transactionMock, executeRawMock } = vi.hoisted(() => {
  const executeRawMock = vi.fn();
  const transactionMock = vi.fn();
  const delegate = () => ({ findMany: vi.fn(), findUnique: vi.fn() });
  class PrismaClientStub {
    $transaction = transactionMock;
    $executeRaw = executeRawMock;
    $disconnect = vi.fn();
    user = delegate();
    // $extends returns the "extended" client the proxy wraps; it exposes the
    // same client methods plus a model delegate.
    $extends() {
      return {
        $transaction: transactionMock,
        $executeRaw: executeRawMock,
        $disconnect: vi.fn(),
        user: delegate(),
      };
    }
  }
  return { PrismaClientStub, transactionMock, executeRawMock };
});

vi.mock('@prisma/client', () => ({ PrismaClient: PrismaClientStub, Prisma: {} }));

import prisma, {
  basePrisma,
  getAmbientTransaction,
  withAmbientTransaction,
} from '../../server/src/prisma.js';
import {
  runUnrestricted,
  setRequestTenantContext,
  tenantBridgeMiddleware,
} from '../../server/src/tenantDatabase.js';

type AnyFn = (...args: unknown[]) => unknown;

/** Minimal fake transaction client carrying the tenant-context raw call. */
function fakeTx() {
  return { $executeRaw: executeRawMock };
}

/** Make basePrisma.$transaction invoke its callback with a fake tx client. */
function stubTransaction(): void {
  transactionMock.mockImplementation(((cb: (tx: unknown) => unknown) => cb(fakeTx())) as never);
  // The Prisma test double exposes the mock as an instance field. Re-assign it
  // explicitly so the bridge test remains stable across Prisma client proxy
  // implementations and generated-client upgrades.
  (basePrisma as unknown as { $transaction: typeof transactionMock }).$transaction =
    transactionMock;
}

/** True when one of the $executeRaw calls carried `value` as a bound param. */
function rawCallWith(value: string): boolean {
  const contains = (candidate: unknown): boolean => {
    if (candidate === value) return true;
    return Array.isArray(candidate) && candidate.some(contains);
  };
  return executeRawMock.mock.calls.some((call: unknown[]) => call.some(contains));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ambient transaction store (prisma.ts)', () => {
  it('publishes and reads back the tx inside withAmbientTransaction only', () => {
    expect(getAmbientTransaction()).toBeUndefined();
    const tx = fakeTx();
    const seen = withAmbientTransaction(tx as never, () => getAmbientTransaction());
    expect(seen).toBe(tx);
    // The store is scoped to the callback — nothing leaks afterwards.
    expect(getAmbientTransaction()).toBeUndefined();
  });
});

describe('prisma proxy delegation', () => {
  it('routes model access to the ambient transaction when one is active', () => {
    const tx = { ...fakeTx(), user: { findMany: 'tx-user' } };
    withAmbientTransaction(tx as never, () => {
      expect((prisma as unknown as { user: unknown }).user).toBe(tx.user);
    });
  });

  it('falls back to the extended client when no transaction is active', () => {
    expect(getAmbientTransaction()).toBeUndefined();
    expect((prisma as unknown as { user: unknown }).user).toBeDefined();
  });

  it('runs $transaction callback form against the ambient transaction', () => {
    const tx = fakeTx();
    withAmbientTransaction(tx as never, () => {
      const cb = vi.fn();
      (prisma as unknown as { $transaction: (arg: unknown) => unknown }).$transaction(cb);
      expect(cb).toHaveBeenCalledWith(tx);
    });
  });

  it('awaits $transaction array form against the ambient transaction', async () => {
    const tx = fakeTx();
    await withAmbientTransaction(tx as never, async () => {
      const result = await (
        prisma as unknown as { $transaction: (arg: unknown) => Promise<unknown> }
      ).$transaction([Promise.resolve(1), Promise.resolve(2)]);
      expect(result).toEqual([1, 2]);
    });
  });
});

describe('runUnrestricted', () => {
  it("applies the '*' master/system tenant value and publishes the tx", async () => {
    stubTransaction();
    const result = await runUnrestricted(async (tx) => {
      // The ambient tx is published so the prisma proxy delegates to it.
      expect(getAmbientTransaction()).toBe(tx);
      return 'ok';
    });
    expect(result).toBe('ok');
    // set_config('app.current_tenant', '*', true) was issued on the tx.
    expect(rawCallWith('*')).toBe(true);
  });
});

describe('setRequestTenantContext', () => {
  it('is a no-op outside a bridged request', async () => {
    await setRequestTenantContext({ kind: 'tenant', tenantId: 'tenant-1' });
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('switches the ambient transaction to the caller tenant', async () => {
    const tx = fakeTx();
    await withAmbientTransaction(tx as never, () =>
      setRequestTenantContext({ kind: 'tenant', tenantId: 'tenant-42' }),
    );
    expect(rawCallWith('tenant-42')).toBe(true);
  });
});

describe('tenantBridgeMiddleware', () => {
  function mockRes() {
    const handlers: Record<string, AnyFn[]> = {};
    const res = {
      once: vi.fn((event: string, fn: AnyFn) => {
        (handlers[event] ||= []).push(fn);
      }),
    };
    return { res: res as never, handlers };
  }

  it('exempts the SSE /events path (no transaction opened)', () => {
    const next = vi.fn();
    tenantBridgeMiddleware({ path: '/events' } as never, {} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('passes through when a transaction is already active (re-entrancy guard)', () => {
    // The bridge is mounted on both /api and /api/v1; a /api/v1/* request
    // matches both. The inner invocation must NOT open a second transaction.
    const next = vi.fn();
    withAmbientTransaction(fakeTx() as never, () => {
      tenantBridgeMiddleware({ path: '/employees' } as never, {} as never, next);
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('wraps the request chain in an unrestricted transaction', async () => {
    stubTransaction();
    const next = vi.fn();
    const { res, handlers } = mockRes();
    tenantBridgeMiddleware({ path: '/employees' } as never, res, next);
    // The bridge opens the transaction asynchronously; wait for next().
    await vi.waitFor(() => {
      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    });
    // Settle the chain (response finished) so the transaction commits and no
    // promise is left dangling.
    handlers.finish?.forEach((fn) => fn());
    expect(basePrisma).toBeDefined();
  });
});
