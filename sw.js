/* Momentum service worker: makes the app work offline and installable.
 * Strategy: serve from cache instantly, refresh the cache in the background,
 * so pushing new code to GitHub reaches everyone on their next open.
 * Your habit data is NOT here — it lives encrypted in IndexedDB.
 */
const CACHE = 'momentum-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'engine.js', 'vault.js',
  'lightweight-charts.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const fresh = fetch(req).then(async res => {
    if (res && res.ok) { const cache = await caches.open(CACHE); await cache.put(req, res.clone()); }
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(cached => cached || fresh));
});
