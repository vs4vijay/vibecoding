#!/usr/bin/env node
/**
 * tools/lighting-probe.mjs — pixel probes for the lighting workstream
 * (aaa-visual-overhaul tasks 2.1–2.3), run against a live dev server.
 *
 * Reuses the capture.mjs CDP scaffolding (dedicated headless Chromium over a
 * raw-socket WebSocket, node builtins only) plus its PNG decoder, and drives
 * the dev-only `window.__zh` hooks — including the lighting-only `project()`
 * (world → CSS px, the kill-popup path) and `forceLevel()` (mood target) —
 * so every sampled patch is anchored to an exact world point.
 *
 * Probes (spec scenarios, specs/render/lighting/spec.md):
 *   1. Car shadow      — road patch in the sun-shadow direction vs a control
 *                        patch perpendicular to it at like camera distance.
 *   2. Shadow floor    — darkest patch mean under/behind the car stays above
 *                        CONFIG.look.shadow.floorLuma8bit (config-pinned).
 *   3. Headlight cone  — road in the spotlight cone vs road outside it at the
 *                        same distance ahead of the car.
 *   4. Lamp pool/glow  — elliptical pool on the road under the lamp head +
 *                        glow brightness at the head (lamp-pool pose).
 *   5. Mood shift      — level 1 vs forced level 9: far-road fog patch and
 *                        whole-frame stats differ measurably (MAD), and the
 *                        zombie-vs-road readability contrast still passes in
 *                        BOTH moods.
 *   6. Edge popping    — 30 s of frozen sim advance in 2 s chunks; shadow
 *                        contrast stays present at every checkpoint.
 *
 * Usage:
 *     node tools/lighting-probe.mjs [--url http://localhost:5173] [--out dir]
 *         [--json path] [--skip-popping]
 *
 * Requires `bun run dev` (reused, never spawned). Writes captures to
 * <out>/fullres/ and a JSON report (default: <out>/probe-results.json).
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const VIEW_W = 1280;
const VIEW_H = 720;
/** Patch half-size in px (samples a (2h+1)² box). */
const PATCH = 7;
/** Probe thresholds (8-bit sRGB luma unless noted). */
const THRESH = {
  shadowContrastMin: 6, // control − shadow mean
  coneContrastMin: 6, // in-cone − out-of-cone mean
  poolContrastMin: 6, // pool − control mean
  glowMinLuma: 60, // lamp-head glow patch mean
  readabilityContrastMin: 10, // |zombie − road| in either mood
  moodMadMin: 2.5, // far-road patch mean-abs-diff between moods
};

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  let url = "http://localhost:5173";
  let out = path.resolve("evidence/aaa-visual-overhaul/lighting");
  let json = null;
  let skipPopping = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") url = argv[++i];
    else if (a === "--out") out = path.resolve(argv[++i]);
    else if (a === "--json") json = path.resolve(argv[++i]);
    else if (a === "--skip-popping") skipPopping = true;
    else die(`unknown arg: ${a}`);
  }
  return { url, out, json: json ?? path.join(out, "probe-results.json"), skipPopping };
}

function die(msg) {
  console.error(`lighting-probe: ${msg}`);
  process.exit(1);
}

// ── Chrome launch + raw WebSocket CDP client (copied from capture.mjs) ──────

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
  die("no Chrome/Chromium found (set CHROME_PATH)");
}

function launchChrome() {
  const bin = findChromeBin();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "zh-lightprobe-"));
  const child = spawn(
    bin,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      `--window-size=${VIEW_W},${VIEW_H}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--mute-audio",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-dev-shm-usage",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const port = new Promise((resolve, reject) => {
    let acc = "";
    const timer = setTimeout(() => reject(new Error("no DevTools port (20 s)")), 20000);
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
      reject(new Error(`chromium exited early (${code}):\n${acc.slice(-400)}`));
    });
  });
  return { child, port, profileDir };
}

class WsClient {
  constructor(url) {
    const u = new URL(url);
    this.host = u.hostname;
    this.port = Number(u.port);
    this.path = u.pathname + u.search;
    this.buffer = Buffer.alloc(0);
    this.handshaken = false;
    this.fragments = [];
    this.onmessage = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString("base64");
      const req =
        `GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`;
      const socket = net.connect(this.port, this.host, () => socket.write(req));
      socket.setTimeout(15000, () => {
        socket.destroy();
        reject(new Error("websocket connect timeout"));
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
            reject(new Error(`upgrade refused:\n${head.slice(0, 200)}`));
            return;
          }
          this.handshaken = true;
          socket.setTimeout(0);
          this.buffer = this.buffer.slice(idx + 4);
          resolve();
          this.drain();
          return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.drain();
      });
      this.socket = socket;
    });
  }
  drain() {
    for (;;) {
      const f = this.readFrame();
      if (!f) return;
      if (f.op === 0x8) {
        this.socket.destroy();
        return;
      }
      if (f.op === 0x9) {
        this.sendFrame(0xa, f.payload);
        continue;
      }
      if (f.op === 0x1 || f.op === 0x2) {
        if (f.fin) this.deliver(f.payload);
        else this.fragments = [f.payload];
        continue;
      }
      if (f.op === 0x0 && f.fin) {
        this.deliver(Buffer.concat([...this.fragments, f.payload]));
        this.fragments = [];
      }
    }
  }
  deliver(payload) {
    this.onmessage?.(payload.toString("utf8"));
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
      len = Number(buf.readBigUInt64BE(2));
      off = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < off + maskLen + len) return null;
    const mask = masked ? buf.slice(off, off + 4) : null;
    const payload = Buffer.from(buf.slice(off + maskLen, off + maskLen + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buffer = buf.slice(off + maskLen + len);
    return { fin, op, payload };
  }
  sendFrame(op, payload) {
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | op, 0x80 | len]);
    else if (len < 65536) {
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
    try {
      this.sendFrame(0x8, Buffer.alloc(0));
    } catch {
      /* gone */
    }
    this.socket?.destroy();
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleEntries = [];
    ws.onmessage = (text) => {
      const msg = JSON.parse(text);
      if (msg.method === "Runtime.consoleAPICalled") {
        this.consoleEntries.push(
          msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
        );
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }
  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── PNG decode (copied from capture.mjs) + patch sampling ───────────────────

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
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
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!width || !height) throw new Error("PNG missing dimensions");
  if (bitDepth !== 8 || interlace !== 0) throw new Error("unsupported PNG");
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

/** Luma stats over a (2h+1)² patch centered at CSS px (cx, cy). */
function patchStats(img, cx, cy, h = PATCH) {
  const { width, height, bpp, pixels } = img;
  const x0 = Math.max(0, Math.round(cx) - h);
  const x1 = Math.min(width - 1, Math.round(cx) + h);
  const y0 = Math.max(0, Math.round(cy) - h);
  const y1 = Math.min(height - 1, Math.round(cy) + h);
  let n = 0;
  let sum = 0;
  let min = 255;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * bpp;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++;
      sum += luma;
      if (luma < min) min = luma;
      rSum += r;
      gSum += g;
      bSum += b;
    }
  }
  return {
    x: Math.round(cx),
    y: Math.round(cy),
    n,
    mean: +(sum / n).toFixed(2),
    min,
    rgb: [+(rSum / n).toFixed(1), +(gSum / n).toFixed(1), +(bSum / n).toFixed(1)],
  };
}

/** Mean absolute difference of two same-size stat sets (per luma mean). */
const mad = (a, b) => +Math.abs(a - b).toFixed(2);

// ── Probe driver ─────────────────────────────────────────────────────────────

async function evalJs(cdp, expression) {
  const res = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      `page threw: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`,
    );
  }
  return res.result.value;
}

async function freshLoad(cdp, url) {
  // A navigate issued while the fresh target is still settling can answer
  // "Inspected target navigated or closed" — retry briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      await cdp.send("Page.navigate", { url });
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
      await sleep(400);
    }
  }
  const deadline = Date.now() + 30000;
  for (;;) {
    let ok = false;
    try {
      ok = await evalJs(cdp, `document.readyState === "complete" && !!window.__zh`);
    } catch {
      ok = false;
    }
    if (ok) break;
    if (Date.now() > deadline) throw new Error("page load timeout");
    await sleep(150);
  }
}

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

async function screenshot(cdp) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  return Buffer.from(shot.data, "base64");
}

/** Project a world point and return its stats in the given image. */
async function probePoint(cdp, img, x, y, z, h = PATCH) {
  const p = await evalJs(cdp, `window.__zh.project(${x}, ${y}, ${z})`);
  if (p.offscreen) return { offscreen: true, point: p };
  return { offscreen: false, point: p, stats: patchStats(img, p.x, p.y, h) };
}

async function main() {
  const { url, out, json, skipPopping } = parseArgs(process.argv.slice(2));
  const fullDir = path.join(out, "fullres");
  fs.mkdirSync(fullDir, { recursive: true });

  // Dev-server readiness.
  const origin = new URL(url);
  await new Promise((resolve, reject) => {
    const probe = http.get({ host: origin.hostname, port: origin.port || 80, path: "/" }, (res) => {
      res.resume();
      resolve();
    });
    probe.on("error", () => reject(new Error(`dev server not reachable at ${url}`)));
    probe.setTimeout(5000, () => {
      probe.destroy();
      reject(new Error("dev server timeout"));
    });
  });

  const log = (m) => console.log(`probe: ${m}`);
  const report = {
    thresholds: THRESH,
    floorPin: null,
    checks: {},
    captures: {},
    popping: [],
    mood: {},
    readability: {},
  };

  // The shadow-floor pin lives in src/config.ts (CONFIG.look.shadow.floorLuma8bit);
  // this probe is plain node, so read the pinned value straight from source.
  const configSrc = fs.readFileSync(
    path.resolve("src/config.ts"),
    "utf8",
  );
  const floorPin = Number(configSrc.match(/floorLuma8bit:\s*(\d+)/)?.[1]);
  if (!Number.isFinite(floorPin)) die("could not read CONFIG.look.shadow.floorLuma8bit");
  report.floorPin = floorPin;

  const { child, port: chromePort, profileDir } = launchChrome();
  try {
    log(`chromium pid ${child.pid}`);
    const devPort = await chromePort;
    const targets = await new Promise((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port: devPort, path: "/json/list" }, (res) => {
        let acc = "";
        res.on("data", (c) => (acc += c));
        res.on("end", () => resolve(JSON.parse(acc)));
      });
      req.on("error", reject);
    });
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!page) die("no page target");
    const ws = new WsClient(page.webSocketDebuggerUrl);
    const cdp = new Cdp(ws);
    await ws.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: VIEW_W,
      height: VIEW_H,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const zh = (expr) => evalJs(cdp, `window.__zh.${expr}`);

    await freshLoad(cdp, url);
    await evalJs(
      cdp,
      `(() => { localStorage.setItem("zh.coachSeen", "true"); localStorage.setItem("zh.bestScore", "25000"); return 1; })()`,
    );
    // Pin tier 3 for the whole probe run (SwiftShader fps would otherwise
    // degrade tiers mid-probe — correct controller behavior, wrong probe pins).
    await zh(`forceFps(90)`);

    // ── Combat state: pair clings, lurker frozen at +26 m, chase camera ──
    await zh(`play()`);
    await zh(`freeze(true)`);
    await zh(`spawnZombie("walker", -0.5, 30)`);
    await zh(`spawnZombie("walker", 0.5, 30)`);
    await zh(`stepSim(95)`);
    let st = await zh(`state()`);
    if (st.clinging < 1) await zh(`stepSim(20)`);
    // Readability lurker: spawned after stepping → exactly at carZ + 26.
    await zh(`spawnZombie("walker", 0.9, 26)`);
    await settleFrames(cdp, 3);
    st = await zh(`state()`);
    const carZ = st.carZ;
    const carX = st.carX;
    log(`combat state: z=${st.zombies} cling=${st.clinging} carZ=${carZ.toFixed(1)}`);

    const combatPng = await screenshot(cdp);
    const combatFile = path.join(fullDir, "combat-mid.png");
    fs.writeFileSync(combatFile, combatPng);
    report.captures["combat-mid"] = combatFile;
    const img = decodePng(combatPng);

    // Sun geometry must mirror scene.ts's sunDirection convention.
    const az = (38 * Math.PI) / 180;
    const sd = { x: -Math.sin(az), z: -Math.cos(az) }; // shadow points away from sun
    const pd = { x: Math.cos(az), z: -Math.sin(az) }; // perpendicular control

    // 1+2: shadow + floor probes.
    const shadowPts = [1.6, 2.4, 3.2, 4.0];
    const shadowStats = [];
    for (const d of shadowPts) {
      const r = await probePoint(cdp, img, carX + sd.x * d, 0, carZ + sd.z * d);
      if (!r.offscreen) shadowStats.push(r.stats);
    }
    const ctrl = await probePoint(cdp, img, carX + pd.x * 4.8, 0, carZ + pd.z * 4.8);
    if (ctrl.offscreen) die("control patch off screen — probe geometry broken");
    const shadowMean =
      shadowStats.reduce((s, v) => s + v.mean, 0) / Math.max(1, shadowStats.length);
    const shadowContrast = +(ctrl.stats.mean - shadowMean).toFixed(2);
    const floorMin = Math.min(...shadowStats.map((s) => s.mean));
    report.checks.shadow = {
      shadowPatches: shadowStats,
      control: ctrl.stats,
      shadowMean: +shadowMean.toFixed(2),
      contrast: shadowContrast,
      pass: shadowContrast >= THRESH.shadowContrastMin && shadowMean < ctrl.stats.mean,
    };
    report.checks.shadowFloor = {
      darkestPatchMean: +floorMin.toFixed(2),
      pin: floorPin,
      pass: floorMin >= floorPin,
    };
    log(
      `shadow: in-shadow mean ${shadowMean.toFixed(1)} vs control ${ctrl.stats.mean} ` +
        `(contrast ${shadowContrast}, darkest patch ${floorMin.toFixed(1)})`,
    );

    // 3: headlight cone in/out, both patches on the dash-free band (x=±1.4,
    // midway between lanes 0 and ±2.8), mirrored lateral, ±7.5 m from the car:
    // the ahead patch sits inside the 20° spot cone + beam fake; the behind
    // patches are outside the forward cone by construction and clear of the
    // car shadow band (which drifts to −x behind the car). Equal car-distance
    // keeps fog/sun conditions identical between the patches.
    await zh(`pose("side")`);
    await settleFrames(cdp, 2);
    const sidePng = await screenshot(cdp);
    const sideFile = path.join(fullDir, "car-side-profile.png");
    fs.writeFileSync(sideFile, sidePng);
    report.captures["car-side-profile"] = sideFile;
    const sideImg = decodePng(sidePng);
    const coneIn = await probePoint(cdp, sideImg, carX + 1.4, 0, carZ + 7.5);
    const coneOutA = await probePoint(cdp, sideImg, carX + 1.4, 0, carZ - 7.5);
    const coneOutB = await probePoint(cdp, sideImg, carX - 1.4, 0, carZ - 7.5);
    if (coneIn.offscreen || coneOutA.offscreen || coneOutB.offscreen) {
      die("cone probe patches off screen");
    }
    const coneOut = (coneOutA.stats.mean + coneOutB.stats.mean) / 2;
    const coneContrast = +(coneIn.stats.mean - coneOut).toFixed(2);
    report.checks.cone = {
      pose: "side",
      inCone: coneIn.stats,
      outConeFar: coneOutA.stats,
      outConeFarNear: coneOutB.stats,
      contrast: coneContrast,
      pass: coneContrast >= THRESH.coneContrastMin,
    };
    log(`cone: in ${coneIn.stats.mean} vs out ${coneOut.toFixed(1)} (contrast ${coneContrast})`);
    await zh(`pose("chase")`);
    await settleFrames(cdp, 2);

    // 4: lamp pool + glow (lamp-pool pose on a fresh choreography).
    await zh(`pose("chase")`);
    const lampPose = await zh(`pose("lamp")`);
    await settleFrames(cdp, 3);
    const lampPng = await screenshot(cdp);
    const lampFile = path.join(fullDir, "lamp-pool.png");
    fs.writeFileSync(lampFile, lampPng);
    report.captures["lamp-pool"] = lampFile;
    const lampImg = decodePng(lampPng);
    if (!lampPose.lamp) die("pose(lamp) returned no lamp info");
    const lx = lampPose.lamp.x;
    const lz = lampPose.lamp.z;
    const inRoadX = lx - Math.sign(lx) * 2.9; // road-side pool flank, clear of dash lanes
    const poolSide = await probePoint(cdp, lampImg, inRoadX, 0, lz);
    const poolCtrl = await probePoint(cdp, lampImg, -Math.sign(lx) * 4.2, 0, lz);
    const glow = await probePoint(cdp, lampImg, lx, 5.9, lz);
    if (poolSide.offscreen || poolCtrl.offscreen || glow.offscreen) {
      die("lamp probe patches off screen");
    }
    const poolContrast = +(poolSide.stats.mean - poolCtrl.stats.mean).toFixed(2);
    // Elliptical extent: walk ±3.6 m along z at the in-road x, count patches
    // above (control + half the pool lift); same walk along x through the
    // pool center. Stretched axis should reach farther.
    const lift = poolSide.stats.mean - poolCtrl.stats.mean;
    const halfLevel = poolCtrl.stats.mean + Math.max(2, lift / 2);
    const zWalk = [];
    for (let dz = -3.6; dz <= 3.61; dz += 0.6) {
      const r = await probePoint(cdp, lampImg, inRoadX, 0, lz + dz, 4);
      if (!r.offscreen) zWalk.push(r.stats.mean >= halfLevel);
    }
    const xWalk = [];
    for (let dx = -3.0; dx <= 3.01; dx += 0.6) {
      const r = await probePoint(cdp, lampImg, inRoadX + dx, 0, lz, 4);
      if (!r.offscreen) xWalk.push(r.stats.mean >= halfLevel);
    }
    const zExtent = zWalk.filter(Boolean).length;
    const xExtent = xWalk.filter(Boolean).length;
    report.checks.lampPool = {
      lamp: lampPose.lamp,
      poolSide: poolSide.stats,
      control: poolCtrl.stats,
      contrast: poolContrast,
      zSamplesAboveHalf: zExtent,
      xSamplesAboveHalf: xExtent,
      aspectZOverX: +(zExtent / Math.max(1, xExtent)).toFixed(2),
      glow: glow.stats,
      // Ellipticity is pinned by poolStretchZ (config); the z-walk falloff is
      // informational — the x-walk crosses unlit dash lanes, so x extent is
      // not threshold-comparable.
      pass: poolContrast >= THRESH.poolContrastMin && glow.stats.mean >= THRESH.glowMinLuma,
    };
    log(
      `lamp: pool ${poolSide.stats.mean} vs ctrl ${poolCtrl.stats.mean} ` +
        `(contrast ${poolContrast}), glow ${glow.stats.mean}, ` +
        `extent z/x ${zExtent}/${xExtent}`,
    );

    // Readability in the EARLY mood (zombie lurker at carZ + 26). Zombie at
    // x=0.9 and road control at x=3.5 — both clear of the unlit dash lanes.
    const zEarly = await probePoint(cdp, img, carX + 0.9, 1.05, carZ + 26);
    const roadEarly = await probePoint(cdp, img, carX + 3.5, 0, carZ + 26);
    if (zEarly.offscreen || roadEarly.offscreen) die("early readability patches off screen");
    report.readability.early = {
      zombie: zEarly.stats,
      road: roadEarly.stats,
      contrast: +Math.abs(zEarly.stats.mean - roadEarly.stats.mean).toFixed(2),
    };

    // 5: mood shift — forced late level on a fresh choreography.
    await zh(`pose("chase")`);
    await zh(`forceLevel(9)`);
    // Mood damps in wall time on the rAF loop (freeze only gates sim steps);
    // 6 s at lerpRate 0.8 → moodT ≈ 0.99. Also outlives the 1.2 s LEVEL toast.
    await sleep(6000);
    await settleFrames(cdp, 2);
    const lateState = await zh(`state()`);
    log(`late level: ${lateState.level} (mood target t=1 at level 9)`);
    const latePng = await screenshot(cdp);
    const lateFile = path.join(fullDir, "combat-late-level.png");
    fs.writeFileSync(lateFile, latePng);
    report.captures["combat-late-level"] = lateFile;
    const lateImg = decodePng(latePng);

    // Far-road fog patch: 60 m ahead of the car is unambiguously road surface
    // and sits deep inside the fog range in both moods. The horizon scan then
    // locates the sky→ground luma cliff (where fog saturation visually ends
    // the ground) — the mood's fog-density scale moves that row measurably.
    const rowMean = (image, y, x0, x1) => {
      let s = 0;
      let n = 0;
      for (let x = x0; x <= x1; x += 2) {
        const i = (y * image.width + x) * image.bpp;
        s += 0.2126 * image.pixels[i] + 0.7152 * image.pixels[i + 1] + 0.0722 * image.pixels[i + 2];
        n++;
      }
      return s / n;
    };
    const horizonRow = (image) => {
      // First row (top→down) below which the center strip stays dark (<60):
      // the last bright sky row before the fogged ground takes over.
      for (let y = 240; y < 420; y++) {
        if (
          rowMean(image, y, 628, 652) < 60 &&
          rowMean(image, y + 4, 628, 652) < 60
        ) return y;
      }
      return -1;
    };
    const farEarly = await probePoint(cdp, img, carX, 0, carZ + 60, 12);
    const farLate = await probePoint(cdp, lateImg, carX, 0, carZ + 60, 12);
    if (farEarly.offscreen || farLate.offscreen) die("far-road fog patches off screen");
    const frameMean = (image) => {
      let n = 0;
      let sum = 0;
      const stride = 8 * image.bpp;
      for (let i = 0; i + image.bpp <= image.pixels.length; i += stride) {
        sum +=
          0.2126 * image.pixels[i] +
          0.7152 * image.pixels[i + 1] +
          0.0722 * image.pixels[i + 2];
        n++;
      }
      return +(sum / n).toFixed(2);
    };
    const horizonEarly = horizonRow(img);
    const horizonLate = horizonRow(lateImg);
    report.mood = {
      earlyLevel: st.level,
      lateLevel: lateState.level,
      farRoadEarly: farEarly.stats,
      farRoadLate: farLate.stats,
      farRoadMad: mad(farEarly.stats.mean, farLate.stats.mean),
      farRoadColorEarly: farEarly.stats.rgb,
      farRoadColorLate: farLate.stats.rgb,
      horizonRowEarly: horizonEarly,
      horizonRowLate: horizonLate,
      frameMeanEarly: frameMean(img),
      frameMeanLate: frameMean(lateImg),
      pass:
        mad(farEarly.stats.mean, farLate.stats.mean) >= THRESH.moodMadMin ||
        Math.abs(horizonEarly - horizonLate) >= 3,
    };

    // Readability in the LATE mood (same lurker, new capture).
    const zLate = await probePoint(cdp, lateImg, carX + 0.9, 1.05, carZ + 26);
    const roadLate = await probePoint(cdp, lateImg, carX + 3.5, 0, carZ + 26);
    if (zLate.offscreen || roadLate.offscreen) die("late readability patches off screen");
    report.readability.late = {
      zombie: zLate.stats,
      road: roadLate.stats,
      contrast: +Math.abs(zLate.stats.mean - roadLate.stats.mean).toFixed(2),
    };
    report.readability.pass =
      report.readability.early.contrast >= THRESH.readabilityContrastMin &&
      report.readability.late.contrast >= THRESH.readabilityContrastMin;
    log(
      `readability contrast: early ${report.readability.early.contrast}, ` +
        `late ${report.readability.late.contrast}`,
    );

    // 6: edge popping — 30 s of frozen sim in 2 s chunks.
    if (!skipPopping) {
      await zh(`freeze(true)`);
      await zh(`pose("chase")`);
      for (let i = 0; i < 6; i++) {
        await zh(`stepSim(120)`);
        await settleFrames(cdp, 1);
        const png = await screenshot(cdp);
        const file = path.join(fullDir, `popping-${i}.png`);
        fs.writeFileSync(file, png);
        const pimg = decodePng(png);
        const s2 = await zh(`state()`);
        const sh = await probePoint(cdp, pimg, s2.carX + sd.x * 3.2, 0, s2.carZ + sd.z * 3.2);
        const ct = await probePoint(cdp, pimg, s2.carX + pd.x * 4.8, 0, s2.carZ + pd.z * 4.8);
        const contrast =
          !sh.offscreen && !ct.offscreen ? +(ct.stats.mean - sh.stats.mean).toFixed(2) : null;
        report.popping.push({
          file,
          carZ: +s2.carZ.toFixed(1),
          shadowContrast: contrast,
          frameMean: frameMean(pimg),
        });
        log(`popping ${i}: carZ ${s2.carZ.toFixed(0)} shadow contrast ${contrast}`);
      }
    }

    const info = await zh(`rendererInfo()`);
    report.rendererInfo = info;
    log(
      `renderer: ${info.calls} calls (${info.renderPath}) tier ${info.tier} ` +
        `world ${info.systems.world} characters ${info.systems.characters}`,
    );

    fs.writeFileSync(json, JSON.stringify(report, null, 2));
    log(`report -> ${json}`);
    ws.close();
  } finally {
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }, 400).unref();
  }
}

main().catch((err) => {
  console.error(`lighting-probe: ${err.message}`);
  process.exit(1);
});
