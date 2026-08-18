/**
 * Production-Grade Circuit Breaker
 * --------------------------------
 * Protects application workflows from cascading failures when interacting
 * with third-party external APIs, webhook endpoints, or external integrations.
 *
 * States:
 *  - CLOSED: Requests pass through normally. Failures increment failure counter.
 *  - OPEN: Requests fail fast immediately without making downstream network calls.
 *  - HALF_OPEN: A trial request is permitted through to test downstream recovery.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Number of consecutive failures before opening circuit (default: 5)
  resetTimeoutMs?: number;   // Time to wait before attempting recovery (default: 30000ms)
  timeoutMs?: number;        // Call timeout in milliseconds (default: 10000ms)
  name?: string;             // Identifier for logging/metrics
}

export class CircuitBreakerError extends Error {
  constructor(message: string, public readonly circuitName: string, public readonly state: CircuitState) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private nextAttempt = Date.now();
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly timeoutMs: number;
  public readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.name = options.name ?? 'default-circuit';
  }

  public getState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() >= this.nextAttempt) {
      this.state = 'HALF_OPEN';
    }
    return this.state;
  }

  public getStats() {
    return {
      name: this.name,
      state: this.getState(),
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null,
    };
  }

  public async execute<T>(action: () => Promise<T>, fallback?: () => Promise<T> | T): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      if (fallback) {
        return fallback();
      }
      throw new CircuitBreakerError(
        `Circuit breaker "${this.name}" is OPEN. Downstream service unavailable.`,
        this.name,
        currentState
      );
    }

    try {
      // Enforce call timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Operation timed out after ${this.timeoutMs}ms in circuit "${this.name}"`));
        }, this.timeoutMs);
        timer.unref?.();
      });

      const result = await Promise.race([action(), timeoutPromise]);
      this.onSuccess();
      return result;
    } catch (err: any) {
      this.onFailure(err);
      if (fallback) {
        return fallback();
      }
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      console.log(`[circuitBreaker:${this.name}] Recovery probe succeeded. Circuit reset to CLOSED.`);
    }
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(err: any): void {
    this.failureCount++;
    console.warn(`[circuitBreaker:${this.name}] Failure recorded (${this.failureCount}/${this.failureThreshold}):`, err?.message || err);

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeoutMs;
      console.error(
        `[circuitBreaker:${this.name}] Failure threshold reached. Circuit OPEN for ${this.resetTimeoutMs}ms.`
      );
    }
  }

  public reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.nextAttempt = Date.now();
  }
}

export default CircuitBreaker;
