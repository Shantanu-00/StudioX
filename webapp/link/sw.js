const CACHE_NAME = 'studiox-link-v2';
const SHELL_ASSETS = [
  '/link/',
  '/link/index.html',
  '/link/style.css',
  '/link/app.js',
  '/link/api.js',
  '/link/upload.js',
  '/link/cards.js',
  '/link/voice.js',
  '/link/mock.js',
  '/link/manifest.webmanifest',
  '/link/icons/icon.svg',
  '/link/icons/icon-192.png',
  '/link/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Bypass the browser's HTTP cache: S3 sends no Cache-Control, so a
      // heuristically fresh old copy could otherwise be cached as the new shell.
      return cache.addAll(SHELL_ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // CRITICAL: NEVER cache API calls or anything under /v1/
  if (url.pathname.startsWith('/v1/') || req.method !== 'GET') {
    return;
  }

  // Handle navigation requests (SPA routing)
  if (req.mode === 'navigate' && url.pathname.startsWith('/link/')) {
    event.respondWith(
      fetch(req).catch(() => {
        return caches.match('/link/index.html') || caches.match('/link/');
      })
    );
    return;
  }

  // App shell caching strategy: Cache first, fallback to network
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Fetch in background to update cache (stale-while-revalidate for assets)
        fetch(req).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
        }).catch(() => {/* ignore background update error */});
        return cached;
      }
      return fetch(req).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, responseToCache);
        });
        return response;
      });
    })
  );
});
