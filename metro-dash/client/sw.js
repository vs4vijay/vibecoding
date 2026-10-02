const CACHE_NAME = "metro-dash-v6";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/game.js",
  "./js/pwa-register.js",
  "./sw.js",
  "./vendor/three/three.module.js",
  "./vendor/three/three.core.js",
  "./js/src/main.js",
  "./js/src/core/api.js",
  "./js/src/core/assets.js",
  "./js/src/core/audio.js",
  "./js/src/core/config.js",
  "./js/src/core/events.js",
  "./js/src/core/input.js",
  "./js/src/core/renderer.js",
  "./js/src/core/rng.js",
  "./js/src/core/scheme.js",
  "./js/src/core/sky.js",
  "./js/src/entities/coins.js",
  "./js/src/entities/pickups.js",
  "./js/src/entities/player.js",
  "./js/src/entities/trains.js",
  "./js/src/game/camera.js",
  "./js/src/game/coach.js",
  "./js/src/game/run.js",
  "./js/src/game/vfx.js",
  "./js/src/qa/hooks.js",
  "./js/src/world/world.js",
  "./js/src/world/buildings.js",
  "./js/src/world/chunks.js",
  "./js/src/world/corridor.js",
  "./js/src/world/ring.js",
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
  // Never intercept the backend API (wave 6): no caching, no serving stale
  // leaderboards — and non-GET requests must pass straight through.
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
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

/* ============================================================
   WAVE 6 — backend relay (see client/js/src/core/api.js).

   The page NEVER issues /api/* requests: in an API-less deployment
   (the QA static server) those would 404 and Chromium logs
   "Failed to load resource" console errors on the page. Instead the
   page relays requests here via postMessage and this worker fetches
   in ITS OWN context — network failures here are invisible to the
   page console. Every reply is sent exactly once; every failure
   resolves to a null/empty result so the client silently falls back
   to localStorage. One attempt per message, no retries.
   ============================================================ */

const API_TIMEOUT_MS = 2000;

function apiFetchJson(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  return fetch(url, { ...options, signal: ctrl.signal })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

/** get-or-create player, then POST the run. Resolves false on ANY failure. */
function submitRun(run) {
  const username = String((run && run.username) || "player")
    .trim()
    .slice(0, 50) || "player";
  return apiFetchJson("/api/players/get-or-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, displayName: username }),
  }).then((player) => {
    if (!player || player.id == null) return false;
    return apiFetchJson("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: player.id,
        score: Math.round(Number(run.score) || 0),
        distance: Math.round(Number(run.distance) || 0),
        coinsCollected: Math.round(Number(run.coins) || 0),
        multiplier: Math.max(1, Math.round(Number(run.multiplier) || 1)),
        obstaclesDodged: 0,
        powerupsUsed: 0,
        maxCombo: 0,
        playTimeSeconds: Math.max(0, Math.round(Number(run.duration) || 0)),
      }),
    }).then(Boolean);
  });
}

function reply(port, data) {
  try {
    port.postMessage(data);
  } catch {
    /* page gone — nothing to do */
  }
}

self.addEventListener("message", (event) => {
  const port = event.ports && event.ports[0];
  const msg = event.data;
  if (!port || !msg || typeof msg.type !== "string") return;

  if (msg.type === "leaderboard") {
    const limit = Math.min(10, Math.max(1, parseInt(msg.limit, 10) || 5));
    apiFetchJson(`/api/leaderboard/score?limit=${limit}`).then((data) => {
      const rows = Array.isArray(data) ? data : null;
      reply(port, { ok: !!(rows && rows.length), rows });
    });
  } else if (msg.type === "submit-run") {
    submitRun(msg.run && typeof msg.run === "object" ? msg.run : {}).then(
      (ok) => reply(port, { ok: ok === true }),
      () => reply(port, { ok: false }),
    );
  }
});
