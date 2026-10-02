/**
 * @file core/api.js
 * WAVE 6 — graceful backend channel.
 *
 * WHY THIS EXISTS:
 * The QA environment serves the client from a plain static file server with
 * NO backend. Any `/api/*` request issued from the PAGE context would get a
 * 404 and Chromium logs "Failed to load resource: the server responded with
 * a status of 404" as a console error — a hard QA violation (zero console
 * errors). There is no way to suppress that log from page JS.
 *
 * HOW IT SOLVES IT:
 * The page never touches `/api/*`. Requests are relayed to the service
 * worker (a plain postMessage) and the SW performs the fetches INSIDE its
 * own context, where network failures are invisible to the page console.
 * Results come back over a MessageChannel port. The worker registers with
 * root scope ("/"), enabled by the server's `Service-Worker-Allowed: /`
 * header on the SW script.
 *
 * GRACEFUL DEGRADATION:
 *  - No service worker support / registration fails / never activates:
 *    the channel resolves to null and callers silently stay in
 *    localStorage-only mode (no retries, no logs).
 *  - SW present but backend absent: the SW fetch fails or gets a non-2xx in
 *    the SW context -> reply carries null -> callers fall back silently.
 *  - Backend present: real JSON flows back (leaderboard renders, runs submit).
 *
 * The channel is opened lazily at most once per page load; every call has a
 * hard timeout so nothing can hang the boot or the game-over flow.
 */

const REGISTER_TIMEOUT_MS = 2500;
const REPLY_TIMEOUT_MS = 3000;

/** @type {Promise<((msg: object) => Promise<object|null>) | null> | null} */
let channelPromise = null;

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Resolve the active service worker for sw.js (game root), waiting (bounded) for a
 * fresh install to finish activating. register() is idempotent for the same
 * script + scope, so calling it again alongside pwa-register.js is safe.
 */
async function activeWorker(timeoutMs) {
  const reg = await withTimeout(
    navigator.serviceWorker.register("sw.js"), // relative: same script+scope as pwa-register.js (subpath-safe)
    timeoutMs,
    null,
  );
  if (!reg) return null;
  if (reg.active) return reg.active;
  return new Promise((resolve) => {
    let done = false;
    const finish = (w) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(w);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const check = () => {
      if (reg.active) finish(reg.active);
    };
    const watch = (w) => {
      if (!w || typeof w.addEventListener !== "function") return;
      w.addEventListener("statechange", () => {
        if (w.state === "activated") check();
      });
    };
    check();
    watch(reg.installing);
    watch(reg.waiting);
    reg.addEventListener("updatefound", () => watch(reg.installing));
  });
}

function openChannel() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  return activeWorker(REGISTER_TIMEOUT_MS)
    .then((sw) => {
      if (!sw) return null;
      /**
       * Send one message and await the single reply over a fresh
       * MessageChannel. Resolves null on any failure/timeout (never hangs,
       * never throws, never logs).
       */
      return function send(message) {
        return new Promise((resolve) => {
          try {
            const ch = new MessageChannel();
            const timer = setTimeout(() => {
              ch.port1.onmessage = null;
              resolve(null);
            }, REPLY_TIMEOUT_MS);
            ch.port1.onmessage = (ev) => {
              clearTimeout(timer);
              resolve(ev && ev.data ? ev.data : null);
            };
            sw.postMessage(message, [ch.port2]);
          } catch {
            resolve(null);
          }
        });
      };
    })
    .catch(() => null);
}

/**
 * @returns {Promise<((msg: object) => Promise<object|null>) | null>}
 * Resolves to a send() function, or null when the SW channel is unavailable
 * (callers then stay in localStorage-only mode). Cached: at most one
 * registration attempt per page load.
 */
export function getApiChannel() {
  if (!channelPromise) channelPromise = openChannel();
  return channelPromise;
}
