/* Comedor dashboard service worker.
   Goal: new deploys must show up on the very next app open, not 10 minutes
   later. GitHub Pages stamps index.html with a ~10-min HTTP cache, and an
   installed PWA happily re-serves that stale copy on "refresh". So we take
   over navigations and always go to the NETWORK FIRST, explicitly bypassing
   the HTTP cache. The cached copy is only a fallback for when the device is
   truly offline. */
const CACHE = 'comedor-shell-v1';
const SHELL = './index.html';

self.addEventListener('install', () => {
  // Don't sit in "waiting" — a fresh worker should control the page at once.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Drop any older shell caches.
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Only manage top-level navigations (the app shell). Everything else
  // (Firebase, CDN scripts, icons) goes straight to the network untouched.
  if (req.mode !== 'navigate') return;

  event.respondWith((async () => {
    try {
      // cache:'reload' forces a real network hit, skipping the HTTP disk cache.
      const fresh = await fetch(req, { cache: 'reload' });
      const cache = await caches.open(CACHE);
      cache.put(SHELL, fresh.clone());
      return fresh;
    } catch (err) {
      // Offline: serve the last good shell so the app still opens.
      const cached = await caches.match(SHELL);
      return cached || Response.error();
    }
  })());
});
