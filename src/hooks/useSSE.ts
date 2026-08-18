/**
 * useSSE Hook
 * -----------
 * Subscribes to the server's SSE event stream and invokes
 * a callback on entity events. Auto-reconnects with backoff.
 * Also exports useSSEStatus for connection state display.
 *
 * Uses a singleton EventSource with reference counting so that
 * page navigation does not tear down / re-create the connection,
 * which previously caused the status indicator to briefly (or
 * permanently) show "Offline" while the user was still online.
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export interface SSEEvent {
  type: string;
  entity?: string;
  action?: string;
  payload?: unknown;
  timestamp?: string;
  clientId?: string;
}

export type SSEStatus = 'connected' | 'connecting' | 'disconnected';

// ── Module-level status listeners for cross-component sync ──
type StatusListener = (status: SSEStatus) => void;
const statusListeners = new Set<StatusListener>();
let currentStatus: SSEStatus = 'disconnected';

function setGlobalStatus(status: SSEStatus) {
  if (status === currentStatus) return;
  currentStatus = status;
  statusListeners.forEach((listener) => listener(status));
}

// ── Singleton SSE connection manager ──
type EventCallback = (event: SSEEvent) => void;
const subscribers = new Set<EventCallback>();

let es: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let connectionDisposed = false;

function connect() {
  if (connectionDisposed || subscribers.size === 0) return;
  if (es) return; // already connected / connecting

  setGlobalStatus('connecting');
  es = new EventSource('/api/events', { withCredentials: true });

  es.onopen = () => {
    attempts = 0;
    setGlobalStatus('connected');
  };

  es.onmessage = (msg) => {
    attempts = 0;
    try {
      const event = JSON.parse(msg.data) as SSEEvent;
      subscribers.forEach((cb) => {
        try {
          cb(event);
        } catch {
          // subscriber error should not break the stream
        }
      });
    } catch {
      // ignore malformed events
    }
  };

  es.onerror = () => {
    es?.close();
    es = null;
    if (connectionDisposed || subscribers.size === 0) return;
    setGlobalStatus('disconnected');
    // Exponential backoff: 1s, 2s, 4s, ... max 30s
    const delay = Math.min(1000 * 2 ** attempts, 30_000);
    attempts++;
    reconnectTimer = setTimeout(connect, delay);
  };
}

function disconnect() {
  connectionDisposed = true;
  es?.close();
  es = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  setGlobalStatus('disconnected');
}

function addSubscriber(cb: EventCallback) {
  subscribers.add(cb);
  if (subscribers.size === 1) {
    // First subscriber — open the connection
    connectionDisposed = false;
    attempts = 0;
    connect();
  }
}

function removeSubscriber(cb: EventCallback) {
  subscribers.delete(cb);
  if (subscribers.size === 0) {
    disconnect();
  }
}

// ── Browser online/offline awareness ──
// Reconnect immediately when the browser regains connectivity instead of
// waiting for the next backoff tick, and mark disconnected as soon as the
// browser reports it is offline. This keeps the indicator truthful.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (subscribers.size > 0 && !es && !connectionDisposed) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      attempts = 0;
      connect();
    }
  });

  window.addEventListener('offline', () => {
    es?.close();
    es = null;
    setGlobalStatus('disconnected');
  });
}

/**
 * Hook to get current SSE connection status.
 */
export function useSSEStatus(): SSEStatus {
  const [status, setStatus] = useState<SSEStatus>(currentStatus);

  useEffect(() => {
    const listener: StatusListener = (newStatus) => setStatus(newStatus);
    statusListeners.add(listener);
    // Sync in case status changed between render and effect
    setStatus(currentStatus);
    return () => {
      statusListeners.delete(listener);
    };
  }, []);

  return status;
}

export function useSSE(onEvent: (event: SSEEvent) => void, enabled = true) {
  const { user } = useAuth();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!user || !enabled) return;

    const cb: EventCallback = (event) => onEventRef.current(event);
    addSubscriber(cb);

    return () => {
      removeSubscriber(cb);
    };
  }, [user?.id, enabled]);
}

/**
 * Hook to subscribe to SSE with automatic status tracking.
 */
export function useSSEWithStatus(onEvent: (event: SSEEvent) => void, enabled = true) {
  useSSE(onEvent, enabled);
  return useSSEStatus();
}

/**
 * Keeps the shared SSE connection alive without handling events.
 * Mount this once at the app layout level so the connection (and the
 * status indicator) persists on pages that don't subscribe to events.
 */
export function useSSEConnection(enabled = true) {
  const { user } = useAuth();

  useEffect(() => {
    if (!user || !enabled) return;

    const cb: EventCallback = () => {
      /* keep-alive subscriber only */
    };
    addSubscriber(cb);

    return () => {
      removeSubscriber(cb);
    };
  }, [user?.id, enabled]);
}
