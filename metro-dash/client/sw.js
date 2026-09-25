const CACHE_NAME = "metro-dash-v5";
// All entries are relative to the service worker's own directory, so the
// game works at the repo root (http://localhost:PORT/) and under any
// subpath (GitHub Pages /vibecoding/metro-dash/).
const ASSETS_TO_CACHE = [
  "./",
  "index.html",
  "css/style.css",
  "fonts/Bungee-Regular.woff2",
  "js/game.js",
  "js/pwa-register.js",
  "sw.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Same-origin assets are served network-first so deploys show up on the
  // next reload (un-hashed filenames + long max-age make cache-first go
  // stale forever); the cache answers when offline. Cross-origin requests
  // (the version-pinned three.js CDN) stay cache-first.
  if (url.origin === self.location.origin && event.request.method === "GET") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached || Response.error()),
        ),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) return response;
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      });
    }),
  );
});
