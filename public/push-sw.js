/* TimeTrack Web Push handler (migration 25).
 * Imported into the Workbox-generated service worker via workbox.importScripts
 * (vite.config.ts). Shows server-sent notifications even when no TimeTrack tab
 * is open, and focuses/opens the app when tapped.
 */

function pathFor(data) {
  const type = data && data.type;
  if (type === 'auto_clock_in' || type === 'auto_clock_out' || type === 'geofence') return '/time';
  if (type === 'shift_reminder') return '/shifts';
  if (type === 'attendance_alert') return '/';
  return '/';
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: 'TimeTrack', body: event.data ? event.data.text() : '' };
  }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 120) : 'TimeTrack';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 400) : '';
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/TimeTrack Icon.png',
      badge: '/TimeTrack Icon.png',
      tag: data.entryId ? `tt-${data.type}-${data.entryId}` : undefined,
      data: { url: pathFor(data) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          if ('navigate' in w) w.navigate(url).catch(() => undefined);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
