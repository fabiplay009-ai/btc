/* Service Worker: macht die App offline-fähig und installierbar. */
const CACHE = 'pocket-miner-v1';
const ASSETS = [
  './', 'index.html', 'style.css', 'app.js', 'miner-worker.js', 'miner-core.js',
  'manifest.webmanifest', 'icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // API-Anfragen immer live
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
