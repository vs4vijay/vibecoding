#!/usr/bin/env bun
/**
 * WAVE 6 smoke test — UI shell + graceful backend channel (headless, no GPU).
 *
 * Validates:
 *  1. core/api.js channel: null paths (no SW / register failure / never
 *     activates / no reply), successful reply path, caching of the channel.
 *  2. sw.js backend relay against REAL message-handler code with a stubbed
 *     fetch: QA-offline (404/501) stays silent and returns "hidden"/"skip"
 *     results; backend-online returns rows and posts the run with the exact
 *     API payload contract.
 *  3. End-to-end: page send() -> sw.js handler -> reply over MessageChannel.
 *  4. Static contract checks: element IDs referenced by main.js/hooks exist
 *     in index.html; menu dim <= rgba(15,20,35,0.45); backdrop blur <= 3px;
 *     .qa-freeze kill-switch; no external assets/fonts; SW cache metro-dash-v6 with
 *     api.js precached.
 *
 * NO browser is used (sub-agents must not open pages); the SW message
 * handler is executed in a sandbox with stubbed fetch — network behavior is
 * simulated exactly (ok/404/501/throw) without any socket.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(ROOT, "client");

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Deterministic MessageChannel fake (browser semantics, no platform  *
 * quirks): postMessage delivers to the peer port asynchronously.      *
 * ------------------------------------------------------------------ */
class FakePort {
  constructor() {
    this.onmessage = null;
    this._peer = null;
    this._closed = false;
    this.sent = [];
  }
  postMessage(data) {
    if (this._closed) return;
    this.sent.push(data);
    const peer = this._peer;
    queueMicrotask(() => {
      if (peer && peer.onmessage) peer.onmessage({ data });
    });
  }
  start() {}
  close() {
    this._closed = true;
  }
}
class FakeMessageChannel {
  constructor() {
    this.port1 = new FakePort();
    this.port2 = new FakePort();
    this.port1._peer = this.port2;
    this.port2._peer = this.port1;
  }
}
globalThis.MessageChannel = FakeMessageChannel;

function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
}

/* ------------------------------------------------------------------ *
 * sw.js sandbox: run the REAL file with stubbed fetch/self.           *
 * ------------------------------------------------------------------ */
function loadSw(fetchImpl) {
  const src = readFileSync(join(CLIENT, "sw.js"), "utf8");
  const handlers = {};
  const selfStub = {
    addEventListener: (type, fn) => {
      (handlers[type] = handlers[type] || []).push(fn);
    },
  };
  // caches/FetchEvent are never dispatched — only install/activate/fetch
  // handlers touch them, and this test only fires "message".
  new Function(
    "self",
    "caches",
    "fetch",
    "AbortController",
    src,
  )(selfStub, {}, fetchImpl, AbortController);
  return handlers;
}

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

/* ================================================================== *
 * 1. api.js channel paths                                             *
 * ================================================================== */
console.log("[1] core/api.js channel");
let apiModCounter = 0;
/** Fresh module instance per scenario (getApiChannel caches its promise). */
async function freshApi() {
  apiModCounter += 1;
  return import(join(CLIENT, "js/src/core/api.js") + `?case=${apiModCounter}`);
}
{
  // 1a. no serviceWorker support
  const api = await freshApi();
  setNavigator({});
  const ch = await api.getApiChannel();
  check("no SW support -> null channel", ch === null);
}

{
  // 1b. register() rejects
  let calls = 0;
  setNavigator({
    serviceWorker: {
      register: async () => {
        calls++;
        throw new Error("blocked");
      },
    },
  });
  const api = await freshApi();
  const ch = await api.getApiChannel();
  check("register reject -> null channel (no throw)", ch === null);
  check("exactly one register attempt (cached)", calls === 1);
  const again = await api.getApiChannel();
  check("channel promise cached (no retry spam)", again === ch && calls === 1);
}

{
  // 1c. active worker, immediate reply
  setNavigator({
    serviceWorker: {
      register: async () => ({
        active: {
          postMessage: (msg, ports) => {
            ports[0].postMessage({ ok: true, rows: [{ a: 1 }] });
          },
        },
      }),
    },
  });
  const api = await freshApi();
  const send = await api.getApiChannel();
  check("active worker -> send function", typeof send === "function");
  const reply = await send({ type: "leaderboard", limit: 5 });
  check("reply relayed", reply && reply.ok && reply.rows.length === 1);
}

{
  // 1d. worker never replies -> null after REPLY timeout (3 s)
  setNavigator({
    serviceWorker: {
      register: async () => ({
        active: {
          postMessage: () => {
            /* silence */
          },
        },
      }),
    },
  });
  const api = await freshApi();
  const send = await api.getApiChannel();
  const t0 = Date.now();
  const reply = await send({ type: "leaderboard", limit: 5 });
  check("no reply -> null, never hangs", reply === null);
  check(`reply timeout ~3s (took ${Date.now() - t0}ms)`, Date.now() - t0 >= 2900);
}

/* ================================================================== *
 * 2. sw.js relay — OFFLINE (QA static server: 404 GET / 501 POST)     *
 * ================================================================== */
console.log("[2] sw.js relay — offline (no backend)");
{
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || "GET" });
    return { ok: false, status: url.includes("runs") ? 501 : 404, json: async () => [] };
  };
  const handlers = loadSw(fetchImpl);
  check("message handler registered", Array.isArray(handlers.message) && handlers.message.length === 1);

  // leaderboard: page-visible outcome = rows null -> panel stays hidden
  let lbReply = null;
  const lbCh = new FakeMessageChannel(); // paired like a real transfer
  lbCh.port1.onmessage = (e) => (lbReply = e.data);
  handlers.message[0]({ data: { type: "leaderboard", limit: 5 }, ports: [lbCh.port2] });
  await sleep(20);
  check("offline leaderboard -> ok:false", lbReply && lbReply.ok === false, JSON.stringify(lbReply));
  check("offline leaderboard -> rows null (panel hidden)", lbReply && lbReply.rows === null);
  check(
    "offline leaderboard hit the right endpoint",
    calls.length === 1 && calls[0].url === "/api/leaderboard/score?limit=5" && calls[0].method === "GET",
    JSON.stringify(calls),
  );

  // submit-run: get-or-create fails -> runs POST never attempted
  let goReply = null;
  const goCh = new FakeMessageChannel();
  goCh.port1.onmessage = (e) => (goReply = e.data);
  handlers.message[0]({ data: { type: "submit-run", run: { username: "Nova", score: 100 } }, ports: [goCh.port2] });
  await sleep(20);
  check("offline submit -> handled without throw", goReply && goReply.ok === false);
  check("offline submit -> no /api/runs POST attempted", calls.length === 2 && !calls.some((c) => c.url.includes("/api/runs")));

  // malformed messages never throw
  let threw = false;
  try {
    handlers.message[0]({ data: null, ports: [] });
    handlers.message[0]({ data: { type: "unknown" }, ports: [goCh.port2] });
    handlers.message[0]({});
  } catch {
    threw = true;
  }
  check("malformed messages ignored", !threw);
}

/* ================================================================== *
 * 3. sw.js relay — ONLINE (real Elysia backend contract)              *
 * ================================================================== */
console.log("[3] sw.js relay — online (backend present)");
{
  let runBody = null;
  const fetchImpl = async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    if (url.includes("/api/leaderboard/score")) {
      return jsonResponse([
        { rank: 1, username: "nova", displayName: "Nova", highScore: 42000 },
        { rank: 2, username: "ghost", displayName: "Ghost", highScore: 31000 },
      ]);
    }
    if (url.includes("/api/players/get-or-create")) {
      return jsonResponse({ id: "uuid-player-1", username: "Nova", displayName: "Nova" });
    }
    if (url.includes("/api/runs") && method === "POST") {
      runBody = JSON.parse(opts.body);
      return jsonResponse({ id: "run-1", ...runBody });
    }
    return { ok: false, status: 404, json: async () => null };
  };
  const handlers = loadSw(fetchImpl);

  let lbReply = null;
  const lbCh = new FakeMessageChannel();
  lbCh.port1.onmessage = (e) => (lbReply = e.data);
  handlers.message[0]({ data: { type: "leaderboard", limit: 5 }, ports: [lbCh.port2] });
  await sleep(20);
  check(
    "online leaderboard -> rows array",
    lbReply && lbReply.ok && Array.isArray(lbReply.rows) && lbReply.rows[0].displayName === "Nova",
    JSON.stringify(lbReply),
  );

  let submitReply = null;
  const subCh = new FakeMessageChannel();
  subCh.port1.onmessage = (e) => (submitReply = e.data);
  handlers.message[0]({
    data: {
      type: "submit-run",
      run: { username: "Nova", score: 12345.6, distance: 812.2, coins: 210, multiplier: 2, duration: 63.4 },
    },
    ports: [subCh.port2],
  });
  await sleep(20);
  check("online submit -> ok:true", submitReply && submitReply.ok === true);
  check(
    "POST /api/runs payload matches API contract",
    runBody &&
      runBody.playerId === "uuid-player-1" &&
      runBody.score === 12346 &&
      runBody.distance === 812 &&
      runBody.coinsCollected === 210 &&
      runBody.multiplier === 2 &&
      runBody.playTimeSeconds === 63 &&
      runBody.obstaclesDodged === 0 &&
      runBody.powerupsUsed === 0 &&
      runBody.maxCombo === 0,
    JSON.stringify(runBody),
  );

  // backend up but rejects the player (e.g. 1-char username -> 422): silent skip
  let skipReply = null;
  const skipCh = new FakeMessageChannel();
  skipCh.port1.onmessage = (e) => (skipReply = e.data);
  const handlers422 = loadSw(async (url) =>
    url.includes("get-or-create") ? { ok: false, status: 422, json: async () => null } : jsonResponse([]),
  );
  handlers422.message[0]({ data: { type: "submit-run", run: { username: "X" } }, ports: [skipCh.port2] });
  await sleep(20);
  check("422 get-or-create -> ok:false, no throw", skipReply && skipReply.ok === false);
}

/* ================================================================== *
 * 4. End-to-end: page api.js -> real sw.js handler -> reply           *
 * ================================================================== */
console.log("[4] end-to-end page<->SW (offline 404)");
{
  const handlers = loadSw(async () => ({ ok: false, status: 404, json: async () => null }));
  const swHandler = handlers.message[0];
  setNavigator({
    serviceWorker: {
      register: async () => ({
        active: {
          postMessage: (msg, ports) => {
            const port = ports[0];
            queueMicrotask(() => swHandler({ data: msg, ports: [port] }));
          },
        },
      }),
    },
  });
  // fresh module instance so the channel re-opens against this navigator
  const fresh = await import(join(CLIENT, "js/src/core/api.js") + `?t=${Date.now()}`);
  const send = await fresh.getApiChannel();
  check("channel opened against real handler", typeof send === "function");
  const reply = await send({ type: "leaderboard", limit: 5 });
  check("e2e offline: rows null -> panel hidden, zero errors", reply && reply.ok === false && reply.rows === null);
}

/* ================================================================== *
 * 5. Static contract checks                                           *
 * ================================================================== */
console.log("[5] static contract");
{
  const html = readFileSync(join(CLIENT, "index.html"), "utf8");
  const mainJs = readFileSync(join(CLIENT, "js/src/main.js"), "utf8");
  const hooksJs = readFileSync(join(CLIENT, "js/src/qa/hooks.js"), "utf8");
  const css = readFileSync(join(CLIENT, "css/style.css"), "utf8");
  const swSrc = readFileSync(join(CLIENT, "sw.js"), "utf8");

  // every getElementById in main.js + hooks.js exists in index.html
  const ids = new Set();
  for (const src of [mainJs, hooksJs]) {
    for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) ids.add(m[1]);
  }
  // hooks.js also looks up DOM-UI IDs from an array literal
  // (`for (const id of [...]) -> getElementById(id)`) — cover those too.
  const hookList = hooksJs.match(/for \(const id of \[([^\]]*)\]/);
  if (hookList) for (const m of hookList[1].matchAll(/"([^"]+)"/g)) ids.add(m[1]);
  const missing = [...ids].filter((id) => !new RegExp(`id="${id}"`).test(html));
  check(`all ${ids.size} referenced IDs exist in index.html`, missing.length === 0, missing.join(", "));

  // menu/overlay dim cap
  const dims = [...css.matchAll(/rgba\(15,\s*20,\s*35,\s*([\d.]+)\)/g)].map((m) => parseFloat(m[1]));
  check(`overlay dim caps at 0.45 (max ${Math.max(...dims)})`, Math.max(...dims) <= 0.45);

  // backdrop blur cap
  const blurs = [...css.matchAll(/blur\(([\d.]+)px\)/g)].map((m) => parseFloat(m[1]));
  check(`backdrop blur caps at 3px (max ${Math.max(...blurs)})`, Math.max(...blurs) <= 3);

  // freeze kill-switch + reduced motion
  check(".qa-freeze animation kill-switch present", css.includes(".qa-freeze"));
  check("prefers-reduced-motion respected", css.includes("prefers-reduced-motion"));

  // no external assets / webfonts anywhere in html+css
  const external = [...(html + css).matchAll(/(?:@import|src=|href=)\s*["']?(https?:)?\/\//gi)]
    .filter((m) => !m[0].includes("//127.0.0.1"));
  check("no external fonts/assets", external.length === 0, external.map((m) => m[0]).join(" | "));

  // sprites: the 3D scene must contain none (wave constraint re-check)
  check("sw.js cache metro-dash-v6", swSrc.includes("metro-dash-v6"));
  check("sw.js precaches api.js", swSrc.includes('"./js/src/core/api.js"'));
  check("sw.js never intercepts /api/ GETs", swSrc.includes('url.pathname.startsWith("/api/")'));

  // HUD not blocking corridor center: hud-top is flex space-between (edges only)
  check("#hud-top edge layout (space-between)", /#hud-top\s*{[^}]*justify-content:\s*space-between/.test(css));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
