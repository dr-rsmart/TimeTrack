import { useEffect, useState } from 'react';
import {
  AUTO_CLOCK_STATUS_STALE_MS,
  NATIVE_AUTO_CLOCK_EVENT,
  parseNativeAutoClockStatus,
  type NativeAutoClockStatus,
} from '../utils/autoClockStatus';

export const AUTO_CLOCK_SESSION_ENDED_EVENT = 'timetrack:auto-clock-session-ended';
let nextRequest = 0;

/** Read-only handshake, also supported when the Time tab mounts after onLoadEnd.
 * Correlation prevents a late reply from a previous session reaching this one.
 * Older shells ignore the request: show unavailable, never invent a diagnosis.
 */
export function useNativeAutoClockStatus(
  nativeShell: boolean,
  sessionKey: string | undefined,
  postMessage: (message: Record<string, unknown>) => void,
): NativeAutoClockStatus | null {
  const [snapshot, setSnapshot] = useState<{
    sessionKey: string | undefined;
    status: NativeAutoClockStatus;
  } | null>(null);

  useEffect(() => {
    setSnapshot(null);
    if (!nativeShell) return;
    const requestId = `auto-clock-${Date.now()}-${++nextRequest}`;
    let ended = false;
    const receive = (event: Event) => {
      if (ended) return;
      const status = parseNativeAutoClockStatus((event as CustomEvent<unknown>).detail);
      if (!status || status.requestId !== requestId) return;
      setSnapshot((previous) =>
        previous && previous.status.at > status.at ? previous : { sessionKey, status },
      );
    };
    const request = () => {
      setSnapshot((previous) =>
        previous && Date.now() - previous.status.at > AUTO_CLOCK_STATUS_STALE_MS ? null : previous,
      );
      if (!ended && document.visibilityState !== 'hidden') {
        postMessage({ type: 'AUTO_CLOCK_STATUS_REQUEST', requestId });
      }
    };
    const endSession = () => {
      ended = true;
      setSnapshot(null);
    };
    window.addEventListener(NATIVE_AUTO_CLOCK_EVENT, receive);
    window.addEventListener(AUTO_CLOCK_SESSION_ENDED_EVENT, endSession);
    document.addEventListener('visibilitychange', request);
    request();
    const timer = window.setInterval(request, 15_000);
    return () => {
      ended = true;
      window.clearInterval(timer);
      window.removeEventListener(NATIVE_AUTO_CLOCK_EVENT, receive);
      window.removeEventListener(AUTO_CLOCK_SESSION_ENDED_EVENT, endSession);
      document.removeEventListener('visibilitychange', request);
    };
  }, [nativeShell, sessionKey, postMessage]);

  return nativeShell && snapshot?.sessionKey === sessionKey ? (snapshot?.status ?? null) : null;
}
