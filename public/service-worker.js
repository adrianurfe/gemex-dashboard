// Service Worker del CRM — recibe notificaciones push y actualiza la
// burbuja (badge) del ícono en la pantalla de inicio (iOS 16.4+, Android).
// Va en /public/service-worker.js — CRA lo sirve tal cual en /service-worker.js

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// FIX: cuando llega un push real desde el servidor, se muestra la
// notificación Y se actualiza la burbuja del ícono con el badgeCount
// que mande el servidor.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

  const title = data.title || 'Sonnet CRM';
  const options = {
    body: data.body || '',
    icon: '/logo192.png',
    badge: '/logo192.png',
    data: { url: data.url || '/' },
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    if ('setAppBadge' in self.navigator && typeof data.badgeCount === 'number') {
      if (data.badgeCount > 0) await self.navigator.setAppBadge(data.badgeCount);
      else await self.navigator.clearAppBadge();
    }
  })());
});

// Al tocar la notificación, abre (o enfoca) el CRM en la sección relevante
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) { client.focus(); return; }
    }
    if (clients.openWindow) clients.openWindow(targetUrl);
  })());
});
