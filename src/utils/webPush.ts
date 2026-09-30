/**
 * Browser Web Push subscription helpers (migration 25).
 * Web version only — inside the mobile shell, Expo push is used instead.
 */
import { api } from '../services/api';
import { isNativeShellPresent } from './nativeNotify';

export type WebPushState = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on';

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !isNativeShellPresent() &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function getPublicKey(): Promise<string | null> {
  const res = await api.get<{ publicKey: string | null }>('/auth/web-push/public-key');
  return res.publicKey;
}

export async function getWebPushState(): Promise<WebPushState> {
  if (!isWebPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enableWebPush(): Promise<WebPushState> {
  if (!isWebPushSupported()) return 'unsupported';
  const publicKey = await getPublicKey();
  if (!publicKey) return 'unconfigured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.post('/auth/web-push', { endpoint: json.endpoint, keys: json.keys });
  return 'on';
}

export async function disableWebPush(): Promise<WebPushState> {
  if (!isWebPushSupported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    // DELETE with a JSON body (api.delete takes no body) — same-origin fetch
    // with the session cookie, mirroring the api client's defaults.
    await fetch('/api/auth/web-push', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return 'off';
}
