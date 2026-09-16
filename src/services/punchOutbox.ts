/**
 * Offline Punch Outbox (web)
 * --------------------------
 * When an AUTOMATIC punch cannot reach the server (offline / network error),
 * it is queued in localStorage with its capture timestamp and an idempotency
 * key, then replayed when connectivity returns. Replays carry `offline: true`
 * and `capturedAt` so the server stamps the entry at the ORIGINAL capture
 * instant within its bounded acceptance window (422 OFFLINE_PUNCH_EXPIRED
 * beyond it — see server/src/application/attendance.ts).
 *
 * Terminal server responses (expired window, already clocked, reclock guard,
 * geofence violation, no active session) DROP the queued punch; only network
 * failures and 5xx keep it queued. Mirrors the native shell outbox
 * (mobile/App.js PUNCH_OUTBOX_KEY) so both punch paths survive dead zones.
 * Server-side dedupe (idempotency keys + 409 ALREADY_CLOCKED_IN) makes the
 * replay safe even when the original request actually committed.
 */

import { useSyncExternalStore } from 'react';
import { ApiError, timeEntryApi } from './api';

const OUTBOX_KEY = 'timetrack_web_punch_outbox';
const OUTBOX_MAX_ITEMS = 20;
/** Mirrors the server OFFLINE_PUNCH_WINDOW_HOURS default (4h). */
const OUTBOX_TTL_MS = 4 * 60 * 60_000;
const OUTBOX_EVENT = 'timetrack:punch-outbox';

/** Server error codes that make a queued punch non-retryable (dropped). */
const TERMINAL_ERROR_CODES = new Set([
  'OFFLINE_PUNCH_EXPIRED',
  'ALREADY_CLOCKED_IN',
  'RECLOCK_GUARD',
  'GEOFENCE_VIOLATION',
  'NO_ACTIVE_SESSION',
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'ACCESS_DENIED',
  'OUT_OF_SCOPE',
  'NOT_FOUND',
]);

export interface QueuedPunch {
  kind: 'in' | 'out';
  latitude?: number;
  longitude?: number;
  breakMinutes?: number;
  /** Device capture instant (epoch ms). */
  capturedAt: number;
  /** Idempotency key reused on replay so the server dedupes safely. */
  key: string;
}

function read(): QueuedPunch[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    const items: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? (items as QueuedPunch[]) : [];
  } catch {
    return [];
  }
}

function notifyChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(OUTBOX_EVENT));
  } catch {
    /* ignore */
  }
}

function write(items: QueuedPunch[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    /* storage failures must never break the app */
  }
  notifyChange();
}

/** Queue an automatic punch that failed with a NETWORK error. */
export function enqueueOfflinePunch(punch: Omit<QueuedPunch, 'key'> & { key?: string }): void {
  const items = read();
  const key =
    punch.key ?? `web-${punch.kind}-${punch.capturedAt}-${Math.random().toString(36).slice(2)}`;
  if (items.some((i) => i.key === key)) return; // already queued
  items.push({ ...punch, key });
  while (items.length > OUTBOX_MAX_ITEMS) items.shift();
  write(items);
}

/** Number of punches currently waiting to sync. */
export function pendingPunchCount(): number {
  return read().length;
}

/** Subscribe to outbox-count changes (used by usePunchOutboxCount). */
export function subscribePunchOutbox(listener: () => void): () => void {
  window.addEventListener(OUTBOX_EVENT, listener);
  return () => window.removeEventListener(OUTBOX_EVENT, listener);
}

/** React hook: reactive count of queued offline punches. */
export function usePunchOutboxCount(): number {
  return useSyncExternalStore(subscribePunchOutbox, pendingPunchCount, () => 0);
}

let draining = false;

/**
 * Replay queued punches oldest-first. Runs automatically on `online` and tab
 * focus; safe to call at any time (serialized via `draining`).
 */
export async function drainPunchOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const queued = read();
    if (queued.length === 0) return;
    const now = Date.now();
    const fresh = queued.filter((p) => now - p.capturedAt <= OUTBOX_TTL_MS);
    const remaining: QueuedPunch[] = [];
    for (const punch of fresh) {
      const opts = { capturedAt: punch.capturedAt, idempotencyKey: punch.key };
      try {
        if (punch.kind === 'in') {
          await timeEntryApi.clockIn(punch.latitude, punch.longitude, undefined, undefined, opts);
        } else {
          await timeEntryApi.clockOut(
            punch.breakMinutes ?? 0,
            punch.latitude,
            punch.longitude,
            undefined,
            opts,
          );
        }
        // Success → dropped from the queue.
      } catch (err) {
        if (err instanceof ApiError && err.status < 500) {
          // Terminal 4xx (known or unknown) → drop; a poison pill must never
          // loop forever. The outcome stays explainable via attendance state.
          if (!TERMINAL_ERROR_CODES.has(String(err.code))) {
            console.warn('[punchOutbox] Dropping queued punch with code', err.code);
          }
          continue;
        }
        // Network failure or 5xx → keep queued for the next drain.
        remaining.push(punch);
      }
    }
    write(remaining);
  } finally {
    draining = false;
  }
}

// Auto-drain as soon as the browser regains connectivity or the tab refocuses.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void drainPunchOutbox();
  });
  window.addEventListener('focus', () => {
    void drainPunchOutbox();
  });
}
