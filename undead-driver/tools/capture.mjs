#!/usr/bin/env node
/**
 * tools/capture.mjs — dependency-free CDP screenshot harness (aaa-visual-overhaul).
 *
 * Spawns a DEDICATED headless Chromium over the Chrome DevTools Protocol using
 * only node builtins: `http` to read /json/list, and a minimal WebSocket client
 * implemented directly over `node:net` (handshake, frame masking, fragmentation).
 * No playwright/puppeteer/ws. Zero npm dependencies.
 *
 * Dev-server policy: this harness REUSES an already-running dev server and never
 * spawns one. Start it first:
 *
 *     bun run dev          # http://localhost:5173
 *
 * Usage:
 *     node tools/capture.mjs [scenario...] [--out dir] [--url url] [--sheet]
 *     node tools/capture.mjs --eval 'expr' [--eval 'expr' ...] [--url url]
 *
 *     scenario             one of: car-side-profile combat-mid horde-max
 *                          lamp-pool title game-over   (default: all six)
 *     --out dir            output root (default: evidence). Screenshots land in
 *                          <out>/fullres/<scenario>.png (full-res captures are
 *                          gitignored per design D9); --sheet writes
 *                          <out>/contact-sheet.png (committable).
 *     --url url            dev-server origin (default: http://localhost:5173)
 *     --sheet              also build <out>/contact-sheet.png (2x3 grid, ~480 px
 *                          cells) from the captures via a browser-rendered page
 *     --eval expr          eval mode instead of scenario captures: evaluate the
 *                          given expressions in order against window (typically
 *                          window.__zh.*), printing each JSON result plus any
 *                          page console output. The pseudo-expression
 *                          `sleep:<ms>` waits between steps. Repeatable.
 *     --help               this text
 *
 * Environment:
 *     CHROME_PATH          absolute path to a Chrome/Chromium binary; otherwise
 *                          well-known macOS install locations are probed.
 *
 * Scenarios are driven through the DEV-only `window.__zh` hook namespace
 * (see src/main.ts): play(), freeze(), stepSim(n), fire(), spawnZombie(),
 * pose(), state(). Combat states are choreographed with fixed 1/60 s sim
 * steps after freezing, so captures are comparable across runs.
 *
 * Design guard: before capturing, the page's requestAnimationFrame is probed
 * for ~500 ms; fewer than 2 frames aborts the run — rAF throttled (background
 * pane). Full-res screenshots of a throttled page are garbage.
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const SCENARIOS = [
  "car-side-profile",
  "combat-mid",
  "horde-max",
  "lamp-pool",
  "title",
  "game-over",
];

const VIEW_W = 1280;
const VIEW_H = 720;
const COMMAND_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(code = 0) {
  const lines = [
    "undead-driver capture harness (dependency-free CDP screenshots)",
    "",
    "  node tools/capture.mjs [scenario...] [--out dir] [--url url] [--sheet]",
    "",
    `  scenarios: ${SCENARIOS.join(" ")}   (default: all)`,
    "  --out dir    output root; screenshots -> <dir>/fullres/<scenario>.png (default: evidence)",
    "  --url url    dev-server origin (default: http://localhost:5173)",
    "  --sheet      also write <dir>/contact-sheet.png (2x3 downscaled grid)",
    "  --eval expr  eval mode: run expressions in order (window.__zh.* probes),",
    "               print JSON + page console; `sleep:<ms>` waits between steps",
    "  --help       show this help",
    "",
    "Requires `bun run dev` to be running (reused, never spawned).",
    "Override the browser with CHROME_PATH=/path/to/chrome.",
  ];
  console.log(lines.join("\n"));
  process.exit(code);
}

function parseArgs(argv) {
  const scenarios = [];
  const evals = [];
  let out = "evidence";
  let url = "http://localhost:5173";
  let sheet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage(0);
    else if (a === "--out") out = argv[++i] ?? die("--out needs a value");
    else if (a === "--url") url = argv[++i] ?? die("--url needs a value");
    else if (a === "--sheet") sheet = true;
    else if (a === "--eval") evals.push(argv[++i] ?? die("--eval needs a value"));
    else if (a.startsWith("--")) die(`unknown flag: ${a}`);
    else if (SCENARIOS.includes(a)) scenarios.push(a);
    else die(`unknown scenario: ${a} (choose from ${SCENARIOS.join(", ")})`);
  }
  const hasScenarios = scenarios.length > 0;
  return {
    scenarios: hasScenarios ? scenarios : evals.length ? [] : [...SCENARIOS],
    evals,
    out,
    url,
    sheet,
  };
}

function die(msg, code = 1) {
  console.error(`capture: ${msg}`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Chrome discovery + launch
// ---------------------------------------------------------------------------

function findChromeBin() {
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    die(`CHROME_PATH set but not found: ${process.env.CHROME_PATH}`);
  }
  const suffixes = [
    "Google Chrome.app/Contents/MacOS/Google Chrome",
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "Chromium.app/Contents/MacOS/Chromium",
    "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ];
  const roots = ["/Applications", path.join(os.homedir(), "Applications")];
  for (const root of roots) {
    for (const s of suffixes) {
      const p = path.join(root, s);
      if (fs.existsSync(p)) return p;
    }
  }
  die(
    "no Chrome/Chromium found. Install Google Chrome (or Chromium / Chrome for Testing), " +
      "or set CHROME_PATH=/path/to/binary",
  );
}

function launchChrome() {
  const bin = findChromeBin();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "zh-capture-profile-"));
  const args = [
    "--headless=new",
    "--remote-debugging-port=0", // OS picks a free port; announced on stderr
    `--user-data-dir=${profileDir}`,
    "--window-size=1280,720",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--mute-audio",
    "--use-angle=swiftshader", // deterministic software GL; WebGL must work headless
    "--enable-unsafe-swiftshader",
    "--disable-dev-shm-usage",
    "about:blank",
  ];
  const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  const port = new Promise((resolve, reject) => {
    let acc = "";
    const timer = setTimeout(
      () => reject(new Error("chromium never announced a DevTools port (20 s timeout)")),
      20000,
    );
    child.stderr.on("data", (chunk) => {
      acc += chunk.toString();
      const m = acc.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`chromium exited early (code ${code}). stderr tail:\n${acc.slice(-600)}`));
    });
  });
  return { child, port, profileDir };
}

// ---------------------------------------------------------------------------
// Minimal WebSocket over node:net (client frames only, text + ping/pong)
// ---------------------------------------------------------------------------

class WsClient {
  constructor(url) {
    const u = new URL(url);
    this.host = u.hostname;
    this.port = Number(u.port);
    this.path = u.pathname + u.search;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.handshaken = false;
    this.fragments = [];
    this.fragmentOp = 0;
    this.onmessage = null;
    this.onclose = null;
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString("base64");
      const req =
        `GET ${this.path} HTTP/1.1\r\n` +
        `Host: ${this.host}:${this.port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`;
      const socket = net.connect(this.port, this.host, () => socket.write(req));
      socket.setTimeout(15000, () => {
        socket.destroy();
        reject(new Error(`websocket connect timeout to ${this.host}:${this.port}`));
      });
      socket.on("error", (err) => {
        if (!this.handshaken) reject(err);
      });
      socket.on("data", (chunk) => {
        if (!this.handshaken) {
          this.buffer = Buffer.concat([this.buffer, chunk]);
          const idx = this.buffer.indexOf("\r\n\r\n");
          if (idx === -1) return;
          const head = this.buffer.slice(0, idx).toString();
          if (!/^HTTP\/1\.1 101/i.test(head)) {
            socket.destroy();
            reject(new Error(`websocket upgrade refused:\n${head.slice(0, 300)}`));
            return;
          }
          this.handshaken = true;
          socket.setTimeout(0);
          this.buffer = this.buffer.slice(idx + 4);
          resolve();
          // Frames may share the handshake chunk; drain before returning so
          // the parser never re-concats this chunk below.
          this.drainFrames();
          return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.drainFrames();
      });
      socket.on("close", () => {
        this.closed = true;
        this.onclose?.();
      });
      this.socket = socket;
    });
  }

  drainFrames() {
    for (;;) {
      const f = this.readFrame();
      if (!f) return;
      if (f.op === 0x8) {
        // close
        this.closed = true;
        this.socket.end();
        this.onclose?.();
        return;
      }
      if (f.op === 0x9) {
        this.sendFrame(0xa, f.payload); // pong
        continue;
      }
      if (f.op === 0x1 || f.op === 0x2) {
        if (f.fin) {
          this.deliver(f.payload);
        } else {
          this.fragments = [f.payload];
          this.fragmentOp = f.op;
        }
        continue;
      }
      if (f.op === 0x0) {
        this.fragments.push(f.payload);
        // A continuation frame with fin finishes the message; Chrome always
        // terminates its text messages promptly, so no timeout guard needed.
        if (f.fin) {
          const whole = Buffer.concat(this.fragments);
          this.fragments = [];
          this.deliver(whole);
        }
      }
    }
  }

  deliver(payload) {
    if (this.onmessage) this.onmessage(payload.toString("utf8"));
  }

  readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const op = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) return null;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("websocket frame too large");
      }
      len = Number(big);
      off = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < off + maskLen + len) return null;
    const mask = masked ? buf.slice(off, off + 4) : null;
    const payload = Buffer.from(buf.slice(off + maskLen, off + maskLen + len));
    if (mask) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    this.buffer = buf.slice(off + maskLen + len);
    return { fin, op, payload };
  }

  sendFrame(op, payload) {
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, 0x80 | len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(text) {
    this.sendFrame(0x1, Buffer.from(text, "utf8"));
  }

  close() {
    if (!this.closed && this.socket) {
      try {
        this.sendFrame(0x8, Buffer.alloc(0));
      } catch {
        /* already gone */
      }
    }
    this.socket?.destroy();
  }
}

// ---------------------------------------------------------------------------
// CDP session over the page-target websocket
// ---------------------------------------------------------------------------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    /** Buffered page console output (Runtime.consoleAPICalled), for --eval. */
    this.consoleEntries = [];
    this.ws.onmessage = (text) => {
      const msg = JSON.parse(text);
      if (msg.method === "Runtime.consoleAPICalled") {
        this.consoleEntries.push({
          type: msg.params.type,
          text: msg.params.args
            .map((a) => a.value ?? a.description ?? "")
            .join(" "),
        });
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${msg.error.message}: ${msg.error.data ?? ""}`));
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(payload);
    });
  }
}

async function httpGetJson(port, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: reqPath }, (res) => {
      let acc = "";
      res.on("data", (c) => (acc += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(acc));
        } catch (err) {
          reject(new Error(`bad JSON from ${reqPath}: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error(`timeout fetching ${reqPath}`));
    });
  });
}

async function attachToPage(port) {
  const targets = await httpGetJson(port, "/json/list");
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error(`no page target found among ${targets.length} targets`);
  const ws = new WsClient(page.webSocketDebuggerUrl);
  // Wire the message dispatcher before connecting: no early frame can drop.
  const cdp = new Cdp(ws);
  await ws.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return { ws, cdp };
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function evalJs(cdp, expression) {
  const res = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error(`page threw: ${d.exception?.description ?? d.text ?? "unknown"}`);
  }
  return res.result.value;
}

async function waitForExpr(cdp, expression, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try {
      ok = await evalJs(cdp, `Boolean(${expression})`);
    } catch {
      ok = false; // page mid-navigation: evaluate can transiently fail
    }
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`);
    await sleep(150);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshLoad(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitForExpr(
    cdp,
    `document.readyState === "complete" && !!window.__zh`,
    30000,
    `page load + __zh hooks at ${url}`,
  );
}

/** Let the compositor present n animation frames. */
async function settleFrames(cdp, n = 2) {
  await evalJs(
    cdp,
    `new Promise((res) => {
       let left = ${n};
       const tick = () => (--left <= 0 ? res(left) : requestAnimationFrame(tick));
       requestAnimationFrame(tick);
     })`,
  );
}

/**
 * Design guard (task 1.6 #6): a throttled pane produces garbage captures.
 * The harness spawns its own dedicated Chromium, but if the *host* pane is
 * throttled the spawned browser still renders; this probe verifies the page's
 * own rAF cadence so silently-frozen captures can never ship.
 */
async function rafThrottleProbe(cdp) {
  const frames = await evalJs(cdp, `new Promise((resolve) => {
      let n = 0;
      const t0 = performance.now();
      const loop = () => {
        n++;
        if (performance.now() - t0 < 500) requestAnimationFrame(loop);
        else resolve(n);
      };
      requestAnimationFrame(loop);
    })`);
  if (frames < 2) {
    throw new Error(
      "rAF throttled — run from a dedicated foreground browser/pane " +
        `(probe fired ${frames} frame(s) in 500 ms)`,
    );
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Scenario choreography (drives window.__zh — see src/main.ts)
// ---------------------------------------------------------------------------

async function startFrozenRun(zh) {
  await zh(`play()`);
  await zh(`freeze(true)`);
}

/** Two leapers directly ahead land and cling; returns sim state. */
async function attachPair(zh) {
  await zh(`spawnZombie("walker", -0.5, 30)`);
  await zh(`spawnZombie("walker", 0.5, 30)`);
  await zh(`stepSim(95)`);
  let st = await zh(`state()`);
  if (st.clinging < 1) {
    // Margin was tight (slow first frames warm the jit); give it more road.
    await zh(`stepSim(20)`);
    st = await zh(`state()`);
  }
  return st;
}

async function driveScenario(name, cdp, url, log) {
  const zh = (expr) => evalJs(cdp, `window.__zh.${expr}`);
  await freshLoad(cdp, url);
  const st = { phase: "", note: {} };

  switch (name) {
    case "title":
      // Boot state: title menu over the live scene, chase camera at spawn.
      st.phase = "title";
      break;

    case "car-side-profile":
      await startFrozenRun(zh);
      st.note.pose = await zh(`pose("side")`);
      await settleFrames(cdp, 2);
      st.phase = "running-frozen";
      break;

    case "lamp-pool":
      await startFrozenRun(zh);
      st.note.pose = await zh(`pose("lamp")`);
      await settleFrames(cdp, 2);
      st.phase = "running-frozen";
      break;

    case "combat-mid": {
      await startFrozenRun(zh);
      st.note.attached = await attachPair(zh);
      // Second pair also runs in and clings (both pairs land within the same
      // step budget — verified by the pre-fire state below).
      await zh(`spawnZombie("walker", -0.7, 26)`);
      await zh(`spawnZombie("walker", 0.7, 26)`);
      await zh(`stepSim(62)`);
      // Fifth walker spawned just inside leap range and frozen ~8 steps into
      // its 0.35 s crouch: squashed pose + swelling red ground flash (the
      // windup beat). At true-to-sim cruise the leap itself is a 1-2 step
      // point-blank pounce (the car covers ~9.8 m during the crouch), so
      // there is no airborne window to pin — telegraph is the visible
      // pre-leap state. Window is wide: any step 3..23 after spawn works.
      await zh(`spawnZombie("walker", 0.6, 9.8)`);
      await zh(`stepSim(10)`);
      st.note.preFire = await zh(`state()`);
      // One round per flank; consumed by the next step with the muzzle flash
      // still alive (fx life 0.06 s, one 1/60 s step elapsed). Guns prefer
      // the nearest target — a clinger — so the airborne fifth survives.
      await zh(`fire("left")`);
      await zh(`fire("right")`);
      await zh(`stepSim(1)`);
      Object.assign(st, await zh(`state()`));
      break;
    }

    case "horde-max": {
      await startFrozenRun(zh);
      // Pool capacity is 24 (ZombiePool default). Lane rows walking in from
      // 25..81 m; after 30 fixed steps the front row sits ~11 m out — still
      // outside leap range (9 m), so nothing attaches (weight stays 0).
      const lanes = [-5.6, -2.8, 0, 2.8, 5.6];
      let spawned = 0;
      for (let i = 0; i < 24; i++) {
        const lane = lanes[i % 5];
        const jitter = Math.sin(i * 12.9898) * 0.5; // deterministic spread
        // Outer lanes pull in a touch so nobody hugs the guardrail.
        const x = (Math.abs(lane) > 5 ? lane - Math.sign(lane) * 0.7 : lane) + jitter;
        const zRel = 25 + Math.floor(i / 5) * 14;
        const ok = await zh(`spawnZombie("walker", ${x.toFixed(2)}, ${zRel})`);
        if (ok) spawned++;
      }
      await zh(`stepSim(30)`);
      st.note.spawned = spawned;
      Object.assign(st, await zh(`state()`));
      break;
    }

    case "game-over": {
      await startFrozenRun(zh);
      st.note.attached = await attachPair(zh);
      // True-to-sim flip: bonus weight > capacityPerSide (4) holds |imbalance|
      // >= 1 for the 1.2 s flip window (72 steps), then stepCar emits "flipped".
      await zh(`debugAddWeight("left", 4.5)`);
      await zh(`stepSim(78)`);
      let s = await zh(`state()`);
      if (s.phase !== "over") {
        await zh(`stepSim(20)`);
        s = await zh(`state()`);
      }
      if (s.phase !== "over") throw new Error("game-over scenario: flip never fired");
      await sleep(700); // death-cam pull + game-over card entrance
      Object.assign(st, s);
      break;
    }

    default:
      throw new Error(`no choreography for ${name}`);
  }

  await settleFrames(cdp, 2);
  st.final = await zh(`state()`);
  return st;
}

// ---------------------------------------------------------------------------
// PNG decode + validity (pure node: zlib inflate + manual unfilter)
// ---------------------------------------------------------------------------

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG (bad signature)");
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (!width || !height) throw new Error("PNG missing IHDR dimensions");
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : -1;
  if (bpp === -1) throw new Error(`unsupported color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let val = line[x];
      switch (filter) {
        case 1: val += a; break;
        case 2: val += b; break;
        case 3: val += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          val += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
      }
      cur[x] = val & 0xff;
    }
  }
  return { width, height, bpp, pixels: out };
}

/**
 * Luma statistics over a strided pixel sample. A real frame is never flat or
 * black: we require meaningful spread and a minimum lit-pixel fraction.
 */
function analyzePng(buf) {
  const { width, height, bpp, pixels } = decodePng(buf);
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let min = 255;
  let max = 0;
  let lit = 0; // luma > 24
  let lampAmber = 0; // streetlamp-head hue probe (r high, g mid, b low)
  const stride = 4 * bpp; // sample every 4th pixel
  for (let i = 0; i + bpp <= pixels.length; i += stride) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    n++;
    sum += luma;
    sumSq += luma * luma;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
    if (luma > 24) lit++;
    if (r > 190 && g > 110 && g < 215 && b < 130 && r > b + 80) lampAmber++;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  return {
    width,
    height,
    mean: Number(mean.toFixed(1)),
    std: Number(std.toFixed(1)),
    min,
    max,
    litPct: Number(((100 * lit) / n).toFixed(1)),
    lampAmberPct: Number(((100 * lampAmber) / n).toFixed(3)),
  };
}

function assertFrameValid(name, stats, bytes) {
  const problems = [];
  if (bytes < 20_000) problems.push(`suspiciously small (${bytes} bytes)`);
  if (stats.mean < 8) problems.push(`near-black frame (mean luma ${stats.mean})`);
  if (stats.std < 2) problems.push(`flat frame (std ${stats.std})`);
  if (stats.litPct < 0.8) problems.push(`almost nothing lit (${stats.litPct}% > luma 24)`);
  if (problems.length) {
    throw new Error(`${name}.png failed validation: ${problems.join("; ")}`);
  }
}

// ---------------------------------------------------------------------------
// Contact sheet: browser-rendered 2x3 grid of the full-res captures
// ---------------------------------------------------------------------------

async function buildContactSheet(cdp, outDir, names, log) {
  const cols = 2;
  const cellW = 480;
  const rows = Math.ceil(names.length / cols);
  const cellH = Math.round((cellW * VIEW_H) / VIEW_W); // 16:9 thumbs
  const pageW = cols * (cellW + 26) + 24;
  const pageH = rows * (cellH + 52) + 24;
  const cells = names
    .map(
      (name) =>
        `<div class="cell"><div class="cap">${name}</div>` +
        `<img src="file://${path.join(outDir, "fullres", `${name}.png`)}"></div>`,
    )
    .join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0d0a12;font:600 14px/1.3 system-ui,sans-serif;color:#e8dcc8}
.grid{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:10px;padding:12px}
.cell{background:#171226;border:1px solid #2a2140;border-radius:6px;padding:8px 8px 6px}
.cell img{display:block;width:${cellW}px;height:${cellH}px;border-radius:3px;background:#000}
.cap{margin:0 2px 6px;letter-spacing:.08em;text-transform:uppercase;font-size:12px;color:#ffb26b}
</style></head><body><div class="grid">${cells}</div></body></html>`;
  const tmpHtml = path.join(os.tmpdir(), `zh-contact-sheet-${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, html);
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: pageW,
      height: pageH,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.navigate", { url: `file://${tmpHtml}` });
    await waitForExpr(
      cdp,
      `[...document.images].every((i) => i.complete && i.naturalWidth > 0)`,
      20000,
      "contact-sheet images",
    );
    await settleFrames(cdp, 2);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const outPath = path.join(outDir, "contact-sheet.png");
    const buf = Buffer.from(shot.data, "base64");
    fs.writeFileSync(outPath, buf);
    log(`contact sheet -> ${outPath} (${buf.length} bytes)`);
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  } finally {
    fs.unlinkSync(tmpHtml);
  }
}

// ---------------------------------------------------------------------------
// Eval mode (--eval): sequential __zh probes with console passthrough
// ---------------------------------------------------------------------------

function drainConsole(cdp, log) {
  for (const e of cdp.consoleEntries) log(`[page ${e.type}] ${e.text}`);
  cdp.consoleEntries.length = 0;
}

/**
 * Evaluates each expression in order against the page, printing JSON results
 * and any console output the page produced. `sleep:<ms>` pseudo-expressions
 * wait between steps (quality-controller cooldowns are wall-clock).
 */
async function runEvals(cdp, url, evals, log) {
  await freshLoad(cdp, url);
  await evalJs(
    cdp,
    `(() => { localStorage.setItem("zh.coachSeen", "true"); return "seeded"; })()`,
  );
  const frames = await rafThrottleProbe(cdp);
  log(`rAF probe: ${frames} frames / 500 ms — cadence OK`);
  for (const expr of evals) {
    if (expr.startsWith("sleep:")) {
      const ms = Number(expr.slice(6));
      await sleep(ms);
      log(`… slept ${ms} ms`);
    } else {
      const value = await evalJs(cdp, expr);
      log(`${expr} => ${JSON.stringify(value)}`);
    }
    drainConsole(cdp, log);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { scenarios, evals, out, url, sheet } = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(out);
  const fullDir = path.join(outDir, "fullres");
  fs.mkdirSync(fullDir, { recursive: true });

  // Dev-server readiness (we reuse, never spawn — see header docs).
  const origin = new URL(url);
  await new Promise((resolve, reject) => {
    const probe = http.get({ host: origin.hostname, port: origin.port || 80, path: "/" }, (res) => {
      res.resume();
      resolve();
    });
    probe.on("error", () =>
      reject(
        new Error(
          `dev server not reachable at ${url} — start it with \`bun run dev\` first`,
        ),
      ),
    );
    probe.setTimeout(5000, () => {
      probe.destroy();
      reject(new Error(`dev server at ${url} did not answer within 5 s`));
    });
  });

  const log = (msg) => console.log(`capture: ${msg}`);
  const { child, port: chromePort, profileDir } = launchChrome();
  const shutdown = (signal) => {
    child.kill("SIGTERM");
    setTimeout(() => process.exit(1), 300).unref();
    if (signal) console.error(`capture: aborted (${signal})`);
    process.exit(1);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    log(`chromium pid ${child.pid} (profile ${profileDir})`);
    const devPort = await chromePort;
    log(`devtools on 127.0.0.1:${devPort}`);
    const { ws, cdp } = await attachToPage(devPort);
    const zh = (expr) => evalJs(cdp, `window.__zh.${expr}`);

    try {
      // Establish the origin once, seed profile storage, reload so the game
      // boots with the coach dismissed and a believable best score (the
      // game-over card then shows plain stats — no NEW BEST badge noise).
      await freshLoad(cdp, url);
      await evalJs(cdp, `(() => {
        localStorage.setItem("zh.coachSeen", "true");
        localStorage.setItem("zh.bestScore", "25000");
        localStorage.setItem("zh.bestDist", "900");
        return "seeded";
      })()`);

      const frames = await rafThrottleProbe(cdp);
      log(`rAF probe: ${frames} frames / 500 ms — cadence OK`);

      if (evals.length) {
        // Eval mode: sequential probes on a freshly loaded page (the load
        // above seeded profile storage; runEvals navigates once more for a
        // clean boot with the coach dismissed).
        await runEvals(cdp, url, evals, log);
        log("done: eval mode");
        return;
      }

      // Pin the viewport to exactly 1280x720: --window-size includes window
      // chrome in headless=new, which crops the capture surface (599 px).
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: VIEW_W,
        height: VIEW_H,
        deviceScaleFactor: 1,
        mobile: false,
      });

      const captured = [];
      const fmtState = (s) =>
        `phase=${s.phase} z=${s.zombies} cling=${s.clinging} leap=${s.leaping} ` +
        `kills=${s.kills} score=${s.score} dc=${s.drawCalls}`;
      for (const name of scenarios) {
        const st = await driveScenario(name, cdp, url, log);
        const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
        const buf = Buffer.from(shot.data, "base64");
        const file = path.join(fullDir, `${name}.png`);
        fs.writeFileSync(file, buf);
        const stats = analyzePng(buf);
        assertFrameValid(name, stats, buf.length);
        captured.push(name);
        log(
          `${name}.png  ${buf.length} B  ${stats.width}x${stats.height}  ` +
            `luma mean ${stats.mean} / std ${stats.std} / lit ${stats.litPct}%  ` +
            `amber ${stats.lampAmberPct}%  ` +
            `choreo ${JSON.stringify(st.note)}  sim[${fmtState(st.final)}]`,
        );
      }

      await cdp.send("Emulation.clearDeviceMetricsOverride");

      if (sheet) {
        await buildContactSheet(cdp, outDir, captured, log);
      }

      log(`done: ${captured.length} capture(s) in ${fullDir}`);
    } finally {
      ws.close();
    }
  } finally {
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }, 500).unref();
  }
}

main().catch((err) => {
  console.error(`capture: ${err.message}`);
  process.exit(1);
});
