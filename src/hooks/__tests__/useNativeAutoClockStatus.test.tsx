import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_CLOCK_SESSION_ENDED_EVENT,
  useNativeAutoClockStatus,
} from '../useNativeAutoClockStatus';
import { NATIVE_AUTO_CLOCK_EVENT, AUTO_CLOCK_STATUS_STALE_MS } from '../../utils/autoClockStatus';

afterEach(() => vi.useRealTimers());

function reply(requestId: unknown, at = Date.now()) {
  act(() =>
    window.dispatchEvent(
      new CustomEvent(NATIVE_AUTO_CLOCK_EVENT, {
        detail: { requestId, suppressed: false, at, backgroundStarted: true },
      }),
    ),
  );
}

describe('native read-only status handshake', () => {
  it('requests a snapshot on late mount instead of depending on a missed load event', () => {
    reply('before-mount');
    const post = vi.fn();
    const { result } = renderHook(() => useNativeAutoClockStatus(true, 'employee-1', post));
    expect(result.current).toBeNull();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'AUTO_CLOCK_STATUS_REQUEST' }),
    );
    reply(post.mock.calls[0][0].requestId);
    expect(result.current?.backgroundStarted).toBe(true);
  });

  it('clears on session change and ignores late previous-session replies', () => {
    const post = vi.fn();
    const { result, rerender } = renderHook(
      ({ session }) => useNativeAutoClockStatus(true, session, post),
      { initialProps: { session: 'first' } },
    );
    const first = post.mock.calls[0][0].requestId;
    reply(first);
    rerender({ session: 'second' });
    expect(result.current).toBeNull();
    reply(first);
    expect(result.current).toBeNull();
    reply(post.mock.calls.at(-1)![0].requestId);
    expect(result.current).not.toBeNull();
    act(() => window.dispatchEvent(new Event(AUTO_CLOCK_SESSION_ENDED_EVENT)));
    reply(post.mock.calls.at(-1)![0].requestId);
    expect(result.current).toBeNull();
  });

  it('expires unavailable snapshots and stops requesting after unmount', () => {
    vi.useFakeTimers();
    const post = vi.fn();
    const { result, unmount } = renderHook(() => useNativeAutoClockStatus(true, 'employee', post));
    reply(post.mock.calls[0][0].requestId);
    act(() => vi.advanceTimersByTime(AUTO_CLOCK_STATUS_STALE_MS + 15_000));
    expect(result.current).toBeNull();
    unmount();
    post.mockClear();
    act(() => vi.advanceTimersByTime(30_000));
    expect(post).not.toHaveBeenCalled();
  });

  it('does not send native requests from a browser', () => {
    const post = vi.fn();
    const { result } = renderHook(() => useNativeAutoClockStatus(false, 'employee', post));
    expect(post).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});
