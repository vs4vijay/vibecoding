/**
 * DEVIL'S HIGHWAY service worker — cache-first app shell.
 * Bypasses interception entirely for any request whose URL contains qa=1
 * (QA captures must always see the network copy). Versioned cache; stale
 * caches are removed on activate.
 *
 * All SHELL keys are RELATIVE on purpose: caches are origin-global and this
 * game is served from a subpath (/vibecoding/devils-highway/). Cache
 * put/match/fetch resolve string URLs against the SW script's URL, so
 * "./index.html" here means <scope>/index.html wherever the game is mounted.
 */
const VERSION = "devils-highway-v1";
const SHELL = [
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/main.js",
  "./js/core/config.js",
  "./js/core/rng.js",
  "./js/core/assets.js",
  "./js/core/renderer.js",
  "./js/core/sky.js",
  "./js/core/input.js",
  "./js/core/audio.js",
  "./js/core/save.js",
  "./js/world/world.js",
  "./js/world/chunks.js",
  "./js/world/dust.js",
  "./js/ui/menu.js",
  "./js/ui/pause.js",
  "./js/ui/gameover.js",
  "./js/ui/hud.js",
  "./js/modes/run.js",
  "./js/game/score.js",
  "./js/game/director.js",
  "./js/entities/player.js",
  "./js/entities/zombies.js",
  "./js/entities/obstacles.js",
  "./js/entities/pickups.js",
  "./js/entities/particles.js",
  "./vendor/three/three.module.min.js",
  "./vendor/three/three.core.js",
  "./vendor/three/addons/postprocessing/EffectComposer.js",
  "./vendor/three/addons/postprocessing/MaskPass.js",
  "./vendor/three/addons/postprocessing/OutputPass.js",
  "./vendor/three/addons/postprocessing/RenderPass.js",
  "./vendor/three/addons/postprocessing/SMAAPass.js",
  "./vendor/three/addons/postprocessing/ShaderPass.js",
  "./vendor/three/addons/postprocessing/UnrealBloomPass.js",
  "./vendor/three/addons/shaders/CopyShader.js",
  "./vendor/three/addons/shaders/LuminosityHighPassShader.js",
  "./vendor/three/addons/shaders/OutputShader.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // Put files individually: one missing asset must not break the install.
      await Promise.all(
        SHELL.map(async (path) => {
          try {
            const res = await fetch(new Request(path, { cache: "reload" }));
            if (res.ok) await cache.put(path, res);
          } catch {
            /* offline install — shell still serves what it has */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // QA contract: never intercept captures.
  if (url.search.includes("qa=1")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      // Navigations always resolve to the cached shell index. Relative key:
      // cache.match resolves it against the SW script URL (the game scope).
      const key = req.mode === "navigate" ? "./index.html" : url.pathname;
      const hit = await cache.match(key);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(url.pathname, res.clone());
        return res;
      } catch {
        const fallback = await cache.match("./index.html");
        if (fallback) return fallback;
        return new Response("offline", { status: 503 });
      }
    })(),
  );
});
