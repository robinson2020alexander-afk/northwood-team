// Service worker — caches the app shell (so iOS treats this as a real
// installed PWA and keeps its stored login) and shows push notifications.
const CACHE = 'team-hub-1781086416';
const SHELL = ['./', 'index.html', 'app.js', 'styles.css', 'config.js',
  'manifest.json', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// network-first (so updates land when online), fall back to cache when offline
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch (e) {
      const cached = await caches.match(req);
      return cached || caches.match('index.html');
    }
  })());
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Team reminder';
  event.waitUntil(self.registration.showNotification(title, {
    body:  data.body || 'Please update your availability.',
    icon:  'icon-180.png',
    badge: 'icon-180.png',
    tag:   data.tag || 'team-reminder',
    data:  { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      for (const w of wins) { if ('focus' in w) return w.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
