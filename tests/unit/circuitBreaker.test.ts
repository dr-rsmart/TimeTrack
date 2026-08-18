import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerError } from '../../server/src/circuitBreaker.js';

describe('CircuitBreaker', () => {
  it('allows successful executions in CLOSED state', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000, name: 'test-service' });
    const fn = vi.fn().mockResolvedValue('ok');

    const res = await breaker.execute(fn);
    expect(res).toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getStats().failureCount).toBe(0);
  });

  it('trips to OPEN state after reaching failure threshold', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 500, name: 'test-service' });
    const failingFn = vi.fn().mockRejectedValue(new Error('Network error'));

    // Attempt 1: failure 1
    await expect(breaker.execute(failingFn)).rejects.toThrow('Network error');
    expect(breaker.getState()).toBe('CLOSED');

    // Attempt 2: failure 2 -> opens circuit
    await expect(breaker.execute(failingFn)).rejects.toThrow('Network error');
    expect(breaker.getState()).toBe('OPEN');

    // Attempt 3: fast-fails with CircuitBreakerError without invoking target function
    failingFn.mockClear();
    await expect(breaker.execute(failingFn)).rejects.toThrow(CircuitBreakerError);
    expect(failingFn).not.toHaveBeenCalled();
  });

  it('uses fallback when provided in OPEN state', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, name: 'test-service' });
    const failingFn = vi.fn().mockRejectedValue(new Error('Failure'));

    await expect(breaker.execute(failingFn)).rejects.toThrow('Failure');
    expect(breaker.getState()).toBe('OPEN');

    const fallback = vi.fn().mockReturnValue('fallback-response');
    const res = await breaker.execute(failingFn, fallback);
    expect(res).toBe('fallback-response');
    expect(fallback).toHaveBeenCalled();
  });

  it('transitions from OPEN to HALF_OPEN and recovers upon successful probe', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50, name: 'test-service' });
    const failingFn = vi.fn().mockRejectedValue(new Error('Fail'));

    await expect(breaker.execute(failingFn)).rejects.toThrow();
    expect(breaker.getState()).toBe('OPEN');

    // Wait for reset timeout to elapse
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(breaker.getState()).toBe('HALF_OPEN');

    // Successful probe execution restores CLOSED state
    const successFn = vi.fn().mockResolvedValue('recovered');
    const res = await breaker.execute(successFn);
    expect(res).toBe('recovered');
    expect(breaker.getState()).toBe('CLOSED');
  });
});
