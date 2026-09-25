#!/usr/bin/env bun
/**
 * QA chunk-streaming probe (task 4.1; kept as the world regression tool for
 * the 4.2 director). Same browser flags as shot.mjs. Verifies, across three
 * page loads of the SAME seed:
 *  1. callbacks: onChunkActive fires per spawned chunk with (index, zStart
 *     = index * CHUNK_LEN), onChunkInactive per despawn, all inactives
 *     before all actives, both ascending by index — across window slides,
 *     pooled reuse, world.reset() and a setGameplay rebuild;
 *  2. gameplay dressing: in gameplay builds NO vehicle instance intersects
 *     the 3-lane corridor (|x| - halfWidth >= 5.1 required), while the same
 *     seed's attract builds DO (the check is meaningful). Harness: the
 *     world is streamed synchronously to a fixed z via world.update(0, z)
 *     inside one JS task, so no render frame interleaves.
 *  3. rng-order preservation: attract vs gameplay placement hashes of the
 *     same chunk indexes match once the shifted x translations are
 *     excluded — every retained value (z, y, rotations, scales, colors,
 *     stream counts, chunk types) is bit-identical, so the flag added or
 *     removed NO rng draws;
 *  4. determinism: same-seed attract vs attract (cross-load), gameplay-boot
 *     vs gameplay-flip (cross-load), and a setGameplay(true -> false) round
 *     trip — all full-placement hashes (x included) bit-identical.
 * Prints one JSON report; touches nothing outside __QA_* surfaces.
 *
 * Usage: bun .qa/chunk_probe.mjs <attract-url> <gameplay-url>
 *   attract-url:  http://127.0.0.1:8123/?qa=1&scene=menu&seed=1
 *   gameplay-url: http://127.0.0.1:8123/?qa=1&scene=game&mode=run&seed=1&gameplay=1
 */
import { chromium } from "playwright-core";

const [attractUrl, gameplayUrl] = process.argv.slice(2);
if (!attractUrl || !gameplayUrl) {
  console.error("usage: bun .qa/chunk_probe.mjs <attract-url> <gameplay-url>");
  process.exit(2);
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
    "--mute-audio",
    "--force-device-scale-factor=1",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = [];
const consoleWarns = [];
const pageErrors = [];
page.on("console", (m) => {
  const t = m.type();
  if (t === "error") consoleErrors.push(m.text());
  else if (t === "warning") consoleWarns.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e?.message || e)));

const waitReady = async (url) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return page
    .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
      timeout: 15000,
      polling: 250,
    })
    .then(() => true)
    .catch(() => false);
};

/**
 * In-page session: registers the callbacks, drives the world synchronously
 * through the whole phase ladder (each update() + snapshot happens inside
 * ONE evaluate, so no render frame interleaves) and returns event logs plus
 * placement hashes of the streamed window at z = 400 (indexes 9..16).
 * `bootGameplay` skips the flag flips when the page booted with the flag on.
 */
const session = (bootGameplay) => page.evaluate((booted) => {
  const w = window.__QA_AUDIT.world;
  const LANE_EDGE = 5.1; // lane edges ±5.1 (CONFIG.ROAD_WIDTH comment)
  const CHUNK_LEN = 40;
  const problems = [];
  const events = [];
  w.onChunkActive((i, z) => events.push({ k: "a", i, z }));
  w.onChunkInactive((i) => events.push({ k: "d", i }));
  const drain = () => events.splice(0, events.length);

  // FNV-1a (the core/rng.js shape) over a stable serialization.
  const fnv = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2545f491) >>> 0;
    return (h >>> 0).toString(16).padStart(8, "0");
  };

  /**
   * Placement snapshot of the active chunks: per chunk, every vehicle
   * instance (the chunk group's own InstancedMeshes — hull matrices +
   * instanceColor) and every recorded stream (wheels/shadows/debris/mesas/
   * rails/posts/reflectors/...). dropX strips each placement's x translation
   * — the ONLY values the gameplay shoulder shift may move.
   */
  const snap = (dropX) => {
    const parts = [];
    const corridor = { violations: 0, worstMargin: Infinity, vehicles: 0 };
    for (const [index, chunk] of w._active) {
      const gz = chunk.group.position.z;
      const chunkParts = [`t:${chunk.type}`];
      chunk.group.traverse((o) => {
        if (!o.isInstancedMesh) return;
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        const halfW = (bb.max.x - bb.min.x) / 2;
        const arr = o.instanceMatrix.array;
        const col = o.instanceColor ? o.instanceColor.array : null;
        for (let i = 0; i < o.count; i++) {
          const b = i * 16;
          const x = arr[b + 12];
          const vals = [];
          for (let j = 0; j < 16; j++) if (!(dropX && j === 12)) vals.push(arr[b + j].toFixed(5));
          if (col) for (let j = 0; j < 3; j++) vals.push(col[i * 3 + j].toFixed(5));
          chunkParts.push(fnv(vals.join(",")));
          corridor.vehicles++;
          const margin = Math.abs(x) - halfW; // hull inner flank vs centreline
          if (margin < corridor.worstMargin) corridor.worstMargin = margin;
          if (margin < LANE_EDGE) corridor.violations++;
        }
      });
      const d = chunk.group.userData;
      if (d.dressing) {
        for (const key of Object.keys(d.dressing)) {
          const list = key === "mesas" ? d.dressing[key].p : d.dressing[key];
          const vals = [`k:${key}`, `n:${list.length}`];
          for (const p of list) {
            for (let j = 0; j < p.length; j++) {
              if (!(dropX && j === 0)) vals.push(Number(p[j]).toFixed(5));
            }
          }
          chunkParts.push(fnv(vals.join(",")));
        }
      }
      if (d.shamblers) {
        // ryCur is eased per frame by the shambler manager — frame state,
        // not placement; everything else is build-time static.
        const vals = [`n:${d.shamblers.length}`];
        for (const s of d.shamblers) {
          for (const key of ["x", "z", "ex", "ez", "lamp", "freq", "phase", "bobPhase", "ry"]) {
            if (!(dropX && key === "x")) vals.push(String(s[key]));
          }
        }
        chunkParts.push(fnv(vals.join(",")));
      }
      parts.push(`${index}[${gz}]${chunkParts.join("|")}`);
    }
    return { hash: fnv(parts.sort().join(";")), corridor };
  };

  const asc = (arr) => arr.every((v, i) => i === 0 || v > arr[i - 1]);
  const checkEvents = (name, evts, expect) => {
    const d = evts.filter((e) => e.k === "d").map((e) => e.i);
    const a = evts.filter((e) => e.k === "a").map((e) => e.i);
    const lastD = evts.reduce((acc, e, i) => (e.k === "d" ? i : acc), -1);
    const firstA = evts.findIndex((e) => e.k === "a");
    const ordered = firstA === -1 || lastD < firstA; // all inactives first
    const zOk = evts.filter((e) => e.k === "a").every((e) => e.z === e.i * CHUNK_LEN);
    if (JSON.stringify(d) !== JSON.stringify(expect.d) || JSON.stringify(a) !== JSON.stringify(expect.a)) {
      problems.push(`${name}: expected d=${JSON.stringify(expect.d)} a=${JSON.stringify(expect.a)}`);
    }
    if (!ordered || !asc(d) || !asc(a) || !zOk) {
      problems.push(`${name}: order/args violated (ordered=${ordered} ascD=${asc(d)} ascA=${asc(a)} zOk=${zOk})`);
    }
    return { name, inactive: d, active: a };
  };

  // Like-for-like snapshots need every active chunk FRESH-built for its
  // index (pooled groups replay their build-time layout by design — task
  // 1.2). reset() + a probe-side pool flush forces a full rebuild; the
  // despawned groups stay parked invisible in the scene until the page
  // dies (QA-only waste). zRef = the menu dolly start -> window -1..6.
  const Z_REF = 20;
  const freshWindow = () => {
    w.reset();
    for (const pool of w._pools.values()) pool.length = 0;
    w.update(0, Z_REF);
    return drain();
  };

  // ---- base snapshot: all-fresh builds, window -1..6, current flag --------
  freshWindow();
  const base = { noX: snap(true), full: snap(false) };

  // ---- callback ladder (synchronous; no frame interleaves) ----------------
  // (callbacks registered at the top of the session; freshWindow drained
  // its own reset events, so the ladder starts from an empty log)
  w.update(0, 400); // window 9..16 (despawns -1..6)
  const ph1 = checkEvents("slide-to-400", drain(), {
    d: [-1, 0, 1, 2, 3, 4, 5, 6],
    a: [9, 10, 11, 12, 13, 14, 15, 16],
  });

  w.update(0, 100); // slide back to window 1..8 — pooled reuse still fires
  const ph2 = checkEvents("slide-to-100", drain(), { d: [9, 10, 11, 12, 13, 14, 15, 16], a: [1, 2, 3, 4, 5, 6, 7, 8] });

  w.reset(); // recycle everything: inactives only
  const ph3 = checkEvents("reset", drain(), { d: [1, 2, 3, 4, 5, 6, 7, 8], a: [] });

  w.update(0, 400); // re-stream the reference window
  const ph4 = checkEvents("restream-400", drain(), { d: [], a: [9, 10, 11, 12, 13, 14, 15, 16] });

  let flipped = null;
  let roundtrip = null;
  if (!booted) {
    // The flips rebuild back at the SAME reference window (-1..6) so the
    // three snapshots cover identical chunk indexes, all freshly built.
    w.setGameplay(true); // rebuild semantics: inactives for the live window
    checkEvents("setGameplay(true)", drain(), { d: [9, 10, 11, 12, 13, 14, 15, 16], a: [] });
    if (w.gameplay !== true) problems.push("gameplay getter did not flip true");
    w.update(0, Z_REF);
    checkEvents("gameplay-restream-ref", drain(), { d: [], a: [-1, 0, 1, 2, 3, 4, 5, 6] });
    flipped = { noX: snap(true), full: snap(false) };

    w.setGameplay(false);
    checkEvents("setGameplay(false)", drain(), { d: [-1, 0, 1, 2, 3, 4, 5, 6], a: [] });
    if (w.gameplay !== false) problems.push("gameplay getter did not flip false");
    w.update(0, Z_REF);
    checkEvents("roundtrip-restream-ref", drain(), { d: [], a: [-1, 0, 1, 2, 3, 4, 5, 6] });
    roundtrip = snap(false); // full hash: must equal the base attract snap
  } else if (w.gameplay !== true) {
    problems.push("boot gameplay flag not set");
  }

  return {
    flag: w.gameplay,
    phases: [ph1, ph2, ph3, ph4],
    base,
    flipped,
    roundtrip,
    chunks: window.__WORLD.chunks,
    problems,
  };
}, bootGameplay);

// ---- load 1: attract session (full phase ladder incl. flag flips) --------
const ready1 = await waitReady(attractUrl);
const s1 = await session(false);

// ---- load 2: same attract URL again (cross-load determinism) -------------
const ready2 = await waitReady(attractUrl);
const s2 = await session(false);

// ---- load 3: gameplay boot (flag set at boot; corridor + hash) -----------
const ready3 = await waitReady(gameplayUrl);
const s3 = await session(true);

await browser.close();

const problems = [
  ...s1.problems.map((p) => `load1: ${p}`),
  ...s2.problems.map((p) => `load2: ${p}`),
  ...s3.problems.map((p) => `load3: ${p}`),
];
if (!ready1 || !ready2 || !ready3) problems.push("screenshotReady timeout on a load");

// Determinism matrix (see file header). All FULL placement hashes (x kept)
// except rngOrderPreserved, which compares x-excluded hashes. Every hash
// covers the same freshly built window (-1..6) on its load.
const det = {
  attractCrossLoad: s1.base.full.hash === s2.base.full.hash,
  gameplayBootVsFlip: s1.flipped && s1.flipped.full.hash === s3.base.full.hash,
  rngOrderPreserved: s1.flipped && s1.base.noX.hash === s1.flipped.noX.hash,
  roundTripBitIdentical: s1.roundtrip && s1.base.full.hash === s1.roundtrip.hash,
};
// Corridor: gameplay builds clear, attract builds violate (meaningful check).
// worstMargin guards null: a window with zero vehicle instances serializes
// the Infinity sentinel as null through the CDP bridge.
const wm = (c) => (c.worstMargin == null ? Infinity : c.worstMargin);
const corridor = {
  gameplayViolations: s1.flipped.full.corridor.violations + s3.base.full.corridor.violations,
  gameplayWorstMargin: Math.min(wm(s1.flipped.full.corridor), wm(s3.base.full.corridor)),
  attractViolations: s1.base.full.corridor.violations,
  attractWorstMargin: wm(s1.base.full.corridor),
  vehiclesChecked:
    s1.base.full.corridor.vehicles + s1.flipped.full.corridor.vehicles + s3.base.full.corridor.vehicles,
};
if (!det.attractCrossLoad) problems.push("attract cross-load hashes differ");
if (!det.gameplayBootVsFlip) problems.push("gameplay boot vs flip hashes differ");
if (!det.rngOrderPreserved) problems.push("attract vs gameplay hashes differ beyond the shifted x");
if (!det.roundTripBitIdentical) problems.push("setGameplay round trip did not rebuild attract exactly");
if (corridor.gameplayViolations !== 0) problems.push("gameplay build intersects the lane corridor");
if (corridor.gameplayWorstMargin < 5.1) problems.push("gameplay worst hull inner edge inside the lane edge");
if (corridor.attractViolations === 0) problems.push("attract build shows no on-road wrecks (check vacuous)");
if (s1.chunks !== 8) problems.push(`unexpected active chunk count ${s1.chunks}`);

console.log(
  JSON.stringify(
    {
      ok: problems.length === 0,
      problems,
      det,
      corridor,
      phases: s1.phases,
      hashes: {
        attract1: s1.base.full.hash,
        attract2: s2.base.full.hash,
        gameplayFlip: s1.flipped && s1.flipped.full.hash,
        gameplayBoot: s3.base.full.hash,
        attractNoX: s1.base.noX.hash,
        gameplayNoX: s1.flipped && s1.flipped.noX.hash,
        roundtrip: s1.roundtrip && s1.roundtrip.hash,
      },
      consoleErrors,
      consoleWarns: consoleWarns.slice(0, 4),
      pageErrors,
    },
    null,
    2,
  ),
);
