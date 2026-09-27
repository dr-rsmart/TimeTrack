/**
 * Native notification facade — the single entry point for raising a phone or
 * desktop notification from the web app.
 *
 * Inside the React Native shell (mobile/App.js) the WebView is remote content
 * with NO working Notification API: WKWebView (iOS) does not implement it, and
 * Android WebView returns `denied` without a native permission handler. We
 * therefore bridge through `window.ReactNativeWebView.postMessage` so the shell
 * can raise a real OS notification via expo-notifications.
 *
 * In a plain browser (desktop) we fall back to the Web Notification API.
 *
 * This mirrors the shell bridge helper in useAutoGeofence.ts but is kept
 * dependency-free (no import cycle) and typed to the NOTIFY message contract
 * the shell validates in mobile/App.js.
 */

/** Notification categories the native shell (mobile/App.js) allowlists. */
export type NativeNotifyType =
  'geofence' | 'auto_clock_in' | 'auto_clock_out' | 'shift_reminder' | 'attendance_alert';

export interface NotifyOptions {
  type?: NativeNotifyType;
}

function postToShell(message: Record<string, unknown>): void {
  try {
    const shell = (
      window as unknown as { ReactNativeWebView?: { postMessage?: (msg: string) => void } }
    ).ReactNativeWebView;
    shell?.postMessage?.(JSON.stringify(message));
  } catch {
    /* Never let bridge failures affect the web app. */
  }
}

/** True when the TimeTrack native shell is hosting this web app. */
export function isNativeShellPresent(): boolean {
  try {
    return (
      typeof (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView !==
      'undefined'
    );
  } catch {
    return false;
  }
}

async function webNotify(title: string, body: string): Promise<void> {
  if (!('Notification' in window)) return;
  try {
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico', tag: `${title}-${Date.now()}` });
    }
  } catch {
    // Browser notification permission/delivery is best effort.
  }
}

/**
 * Raise a notification. Prefers the native shell bridge (so it works on the
 * phone); falls back to the browser Notification API for desktop web.
 */
export async function notifyUser(
  title: string,
  body: string,
  options: NotifyOptions = {},
): Promise<void> {
  if (!title || !body) return;
  if (isNativeShellPresent()) {
    postToShell({
      type: 'NOTIFY',
      title,
      body,
      ...(options.type ? { data: { type: options.type } } : {}),
    });
    return;
  }
  await webNotify(title, body);
}
