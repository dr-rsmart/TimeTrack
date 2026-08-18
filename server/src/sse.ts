/**
 * TimeTrack — Real-Time SSE Service & Distributed Pub/Sub Adapter
 * ---------------------------------------------------------------
 * High-performance Server-Sent Events broker tracking active clients by tenancy,
 * branch, role, and email, with periodic heartbeat and auto-pruning.
 *
 * Includes Redis Pub/Sub adapter for seamless horizontal clustering across
 * multiple load-balanced application instances, with automatic local in-memory fallback.
 */

import type { Response } from 'express';
import crypto from 'crypto';
import { Redis } from 'ioredis';
import config from './config.js';

export interface SSEClient {
  id: string;
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
  lastPing: number;
  userId: string;
  role: string;
  companyProfileId?: string | null;
  branch?: string | null;
  department?: string | null;
}

export interface BroadcastScope {
  companyProfileId?: string | null;
  branch?: string | null;
  department?: string | null;
  targetUserId?: string | null;
}

interface SSEEventMessage {
  event: {
    id: string;
    type: string;
    entity: string;
    action: string;
    payload?: any;
    timestamp: string;
  };
  scope?: BroadcastScope;
}

const SSE_REDIS_CHANNEL = 'timetrack:sse:events';
const clients = new Map<string, SSEClient>();

/** Maximum concurrent SSE connections permitted per user account (prevents tab leaks). */
const MAX_CONCURRENT_PER_USER = 10;

// ── Event Replay Buffer ──
// Monotonic sequence counter + ring buffer of recent events so reconnecting
// clients can resume from their Last-Event-ID instead of missing events.
const REPLAY_BUFFER_SIZE = 500;
const REPLAY_TTL_MS = 5 * 60 * 1000; // 5 minutes
let eventSequence = 0;

interface BufferedEvent {
  seq: number;
  message: SSEEventMessage;
  timestamp: number;
}

const replayBuffer: BufferedEvent[] = [];

function pushToReplayBuffer(message: SSEEventMessage, seq: number) {
  replayBuffer.push({ seq, message, timestamp: Date.now() });
  // Evict old entries (size cap + TTL)
  while (replayBuffer.length > REPLAY_BUFFER_SIZE) {
    replayBuffer.shift();
  }
  const cutoff = Date.now() - REPLAY_TTL_MS;
  while (replayBuffer.length > 0 && replayBuffer[0].timestamp < cutoff) {
    replayBuffer.shift();
  }
}

/**
 * Returns events after the given sequence number that are still in the
 * replay buffer. Used to resume a reconnecting client from Last-Event-ID.
 */
function getEventsSince(lastSeq: number): BufferedEvent[] {
  return replayBuffer.filter((e) => e.seq > lastSeq);
}

let redisPub: Redis | null = null;
let redisSub: Redis | null = null;

const redisUrl = config.redisUrl;

if (redisUrl) {
  try {
    redisPub = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      keepAlive: 10_000,
      connectTimeout: 10_000,
      retryStrategy: (times) => {
        const delay = Math.min(100 * Math.pow(2, Math.min(times, 5)), 3000);
        return delay + Math.floor(Math.random() * 200);
      },
      reconnectOnError: (err) => {
        if (err.message.includes('READONLY')) return 2;
        return false;
      },
    });
    redisSub = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      keepAlive: 10_000,
      connectTimeout: 10_000,
      retryStrategy: (times) => {
        const delay = Math.min(100 * Math.pow(2, Math.min(times, 5)), 3000);
        return delay + Math.floor(Math.random() * 200);
      },
      reconnectOnError: (err) => {
        if (err.message.includes('READONLY')) return 2;
        return false;
      },
    });

    redisPub.on('error', (err) => {
      console.warn('[sse] Redis Pub error (falling back to in-memory broadcast):', err.message);
    });

    redisSub.on('error', (err) => {
      console.warn('[sse] Redis Sub error (falling back to in-memory broadcast):', err.message);
    });

    redisPub.on('connect', () => {
      console.log('[sse] Redis Pub adapter connected.');
    });

    redisSub.on('connect', () => {
      console.log('[sse] Redis Sub adapter connected, subscribing to channel:', SSE_REDIS_CHANNEL);
      redisSub?.subscribe(SSE_REDIS_CHANNEL, (err) => {
        if (err) {
          console.error('[sse] Failed to subscribe to Redis events channel:', err);
        }
      });
    });

    redisSub.on('message', (channel, message) => {
      if (channel === SSE_REDIS_CHANNEL) {
        try {
          const parsed: SSEEventMessage & { seq?: number } = JSON.parse(message);
          deliverToLocalClients(parsed.event, parsed.scope, parsed.seq);
        } catch (err) {
          console.error('[sse] Failed to parse Redis SSE event message:', err);
        }
      }
    });

    // Asynchronously connect without blocking boot
    redisPub.connect().catch((err) => {
      console.warn('[sse] Redis Pub initial connection unavailable:', err.message);
    });
    redisSub.connect().catch((err) => {
      console.warn('[sse] Redis Sub initial connection unavailable:', err.message);
    });
  } catch (err) {
    console.warn('[sse] Redis Pub/Sub adapter setup warning:', err);
  }
}

export function addClient(
  res: Response,
  info: {
    id: string;
    role: string;
    companyProfileId: string | null;
    branch: string | null;
    department: string | null;
  },
  lastEventId?: string | null
) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // ── Event replay on reconnect ──
  // The browser's EventSource automatically sends the Last-Event-ID header
  // when reconnecting. Replay any buffered events after that sequence so
  // short disconnects do not lose events (at-least-once within the buffer
  // window: 500 events / 5 minutes). Scope filtering is applied per event.
  if (lastEventId) {
    const lastSeq = parseInt(lastEventId, 10);
    if (!Number.isNaN(lastSeq)) {
      const missed = getEventsSince(lastSeq);
      for (const buffered of missed) {
        const scope = buffered.message.scope;
        // Scope check: only replay events this client is authorized to see
        if (info.role !== 'master') {
          if (scope?.companyProfileId && info.companyProfileId !== scope.companyProfileId) continue;
          if (scope?.targetUserId && info.id !== scope.targetUserId) continue;
          if (scope?.branch && info.branch && info.branch !== scope.branch) continue;
          if (scope?.department && info.department && info.department !== scope.department) continue;
        }
        try {
          res.write(`id: ${buffered.seq}\ndata: ${JSON.stringify(buffered.message.event)}\n\n`);
        } catch {
          break;
        }
      }
      if (missed.length > 0) {
        console.log(`[sse] Replayed ${missed.length} buffered event(s) to reconnecting client ${info.id}.`);
      }
    }
  }

  // ── Connection limit protection: prune excess connections for this user ──
  let userConnectionCount = 0;
  let oldestClientForUser: { id: string; client: SSEClient } | null = null;
  for (const [id, c] of clients.entries()) {
    if (c.userId === info.id) {
      userConnectionCount++;
      if (!oldestClientForUser || c.lastPing < oldestClientForUser.client.lastPing) {
        oldestClientForUser = { id, client: c };
      }
    }
  }

  if (userConnectionCount >= MAX_CONCURRENT_PER_USER && oldestClientForUser) {
    console.warn(`[sse] User ${info.id} exceeded max concurrent connections (${MAX_CONCURRENT_PER_USER}). Pruning oldest stream.`);
    removeClient(oldestClientForUser.id);
  }

  const clientId = crypto.randomUUID();
  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
      // Refresh lastPing on every heartbeat so pruneStaleConnections()
      // only removes truly dead connections (where writes fail).
      const c = clients.get(clientId);
      if (c) c.lastPing = Date.now();
    } catch {
      removeClient(clientId);
    }
  }, 30000);

  const client: SSEClient = {
    id: clientId,
    res,
    heartbeat,
    lastPing: Date.now(),
    userId: info.id,
    role: info.role,
    companyProfileId: info.companyProfileId,
    branch: info.branch,
    department: info.department,
  };

  clients.set(clientId, client);

  res.on('close', () => {
    removeClient(clientId);
  });
}

export function removeClient(id: string) {
  const client = clients.get(id);
  if (client) {
    clearInterval(client.heartbeat);
    try {
      client.res.end();
    } catch {}
    clients.delete(id);
  }
}

export function getClientCount(): number {
  return clients.size;
}

/**
 * Delivers an event to all locally connected SSE clients on this process instance
 * after evaluating tenant isolation, targeted user, and branch/department filters.
 * Writes the SSE `id:` field (monotonic sequence) so clients can resume via
 * Last-Event-ID after a disconnect.
 */
function deliverToLocalClients(event: SSEEventMessage['event'], scope?: BroadcastScope, seq?: number) {
  const payloadStr = JSON.stringify(event);
  const frame = seq !== undefined ? `id: ${seq}\ndata: ${payloadStr}\n\n` : `data: ${payloadStr}\n\n`;

  for (const client of clients.values()) {
    // Check master role (sees everything across all tenants)
    if (client.role === 'master') {
      try {
        client.res.write(frame);
      } catch {
        removeClient(client.id);
      }
      continue;
    }

    // Tenant isolation check
    if (scope?.companyProfileId && client.companyProfileId !== scope.companyProfileId) {
      continue;
    }

    // Targeted user check
    if (scope?.targetUserId && client.userId !== scope.targetUserId) {
      continue;
    }

    // Branch matching (optional scoped filter)
    if (scope?.branch && client.branch && client.branch !== scope.branch) {
      continue;
    }

    // Department matching (optional scoped filter)
    if (scope?.department && client.department && client.department !== scope.department) {
      continue;
    }

    try {
      client.res.write(frame);
    } catch {
      removeClient(client.id);
    }
  }
}

/**
 * Scoped broadcast: publishes to Redis cluster if connected,
 * or delivers directly to local clients if running in standalone mode.
 */
export function broadcastScoped(
  entity: string,
  action: string,
  payload?: any,
  scope?: BroadcastScope
) {
  const mappedEntity =
    entity === 'employee'
      ? 'Employee'
      : entity === 'shift'
      ? 'Shift'
      : entity === 'timeEntry'
      ? 'TimeEntry'
      : entity;

  const event = {
    id: `${mappedEntity}-${action}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    type: 'entity_event',
    entity: mappedEntity,
    action,
    payload,
    timestamp: new Date().toISOString(),
  };

  const message: SSEEventMessage = { event, scope };

  // Assign a monotonic sequence number and buffer the event for replay.
  // Reconnecting clients send Last-Event-ID; missed events within the
  // buffer window (500 events / 5 minutes) are re-delivered on connect.
  const seq = ++eventSequence;
  pushToReplayBuffer(message, seq);

  if (redisPub && (redisPub.status === 'ready' || redisPub.status === 'connect')) {
    redisPub.publish(SSE_REDIS_CHANNEL, JSON.stringify({ ...message, seq })).catch((err) => {
      console.warn('[sse] Redis publish failed, falling back to local dispatch:', err.message);
      deliverToLocalClients(event, scope, seq);
    });
  } else {
    deliverToLocalClients(event, scope, seq);
  }
}

export function broadcastAll(entity: string, action: string, payload?: unknown): void {
  broadcastScoped(entity, action, payload, undefined);
}

export function pruneStaleConnections(): void {
  const now = Date.now();
  for (const [id, client] of clients.entries()) {
    if (now - client.lastPing > 60000) {
      removeClient(id);
    }
  }
}

/**
 * Disconnect all SSE clients belonging to a suspended tenant.
 * Called from the master toggle endpoint so suspended users stop
 * receiving events immediately (matches request-path enforcement).
 */
export function disconnectTenantClients(companyProfileId: string): number {
  let removed = 0;
  for (const [id, client] of clients.entries()) {
    if (client.companyProfileId === companyProfileId) {
      removeClient(id);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[sse] Disconnected ${removed} client(s) for suspended tenant ${companyProfileId}.`);
  }
  return removed;
}

/**
 * Disconnect all SSE clients for a specific user (by userId).
 * Called on termination / role demotion / password reset so the
 * affected session's live stream is revoked immediately.
 */
export function disconnectUserClients(userId: string): number {
  let removed = 0;
  for (const [id, client] of clients.entries()) {
    if (client.userId === userId) {
      removeClient(id);
      removed++;
    }
  }
  return removed;
}
