import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyUser, isNativeShellPresent } from '../nativeNotify';

type ShellWindow = Window & {
  ReactNativeWebView?: { postMessage?: (msg: string) => void };
};

function setShell(postMessage: (msg: string) => void): void {
  (window as unknown as ShellWindow).ReactNativeWebView = { postMessage };
}

function clearShell(): void {
  delete (window as unknown as ShellWindow).ReactNativeWebView;
}

describe('nativeNotify', () => {
  afterEach(() => {
    clearShell();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).Notification;
  });

  describe('isNativeShellPresent', () => {
    it('is false without the shell and true with it', () => {
      expect(isNativeShellPresent()).toBe(false);
      setShell(() => undefined);
      expect(isNativeShellPresent()).toBe(true);
    });
  });

  describe('notifyUser', () => {
    it('bridges through the native shell and never touches the Web Notification API', async () => {
      const postMessage = vi.fn();
      setShell(postMessage);
      const WebNotification = vi.fn();
      (globalThis as Record<string, unknown>).Notification = WebNotification;

      await notifyUser('Auto Clock In', 'You entered "HQ".', { type: 'auto_clock_in' });

      expect(postMessage).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(postMessage.mock.calls[0][0] as string);
      expect(payload).toEqual({
        type: 'NOTIFY',
        title: 'Auto Clock In',
        body: 'You entered "HQ".',
        data: { type: 'auto_clock_in' },
      });
      expect(WebNotification).not.toHaveBeenCalled();
    });

    it('falls back to the Web Notification API on desktop (no shell)', async () => {
      let captured: { title: string; options: NotificationOptions } | null = null;
      class MockNotification {
        static permission = 'granted';
        constructor(title: string, options: NotificationOptions) {
          captured = { title, options };
        }
      }
      (globalThis as Record<string, unknown>).Notification = MockNotification;

      await notifyUser('Auto Clock Out', 'You left "HQ".', { type: 'auto_clock_out' });

      // TS control-flow narrows `captured` to null here; assert through a non-null
      // local so the test still fails loudly if the fallback never fired.
      const result = captured as { title: string; options: NotificationOptions } | null;
      expect(result?.title).toBe('Auto Clock Out');
      expect(result?.options.body).toBe('You left "HQ".');
    });

    it('ignores empty titles/bodies', async () => {
      const postMessage = vi.fn();
      setShell(postMessage);
      await notifyUser('', 'body');
      await notifyUser('title', '');
      expect(postMessage).not.toHaveBeenCalled();
    });
  });
});
