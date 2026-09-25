#!/usr/bin/env bun
/**
 * QA obstacle-system probe (task 3.2; kept as the entity system's regression
 * tool). Same browser flags as shot.mjs, plus --js-flags=--expose-gc for the
 * heap check. Since task 4.3 the probe constructs its OWN fixture in-page
 * (qa/entity_stage.js — a fresh manager, never the live RUN mode's systems):
 *
 * Usage: bun .qa/obstacle_probe.mjs <url> [--settle-ms 2500] [--live-ms 10000]
 *
 * Verifies, in ONE page load of ?qa=1&mode=run&scene=game:
 *  1. staged band live (one record per archetype) + pool fills to
 *     maxPerType per type (3 x max total); overflow spawn null; extras
 *     recycle cleanly;
 *  2. collision truth table: a grounded run-through hits all three
 *     archetypes; the intended action clears each (jump over the low,
 *     slide under the gantry, lane change past the block); the WRONG
 *     action hits (slide into the low, jump into the gantry/block);
 *     height/z-window/x-tolerance boundaries all bound exactly (early/late
 *     jump edges + mid-lane-ease body positions);
 *  3. occupancy read (the 4.2 director contract): band windows overlap,
 *     the lane filter works, a spawned-then-released window clears;
 *  4. EXACT added draw/tri cost via __QA_OBSTACLES.measure() (the three
 *     archetype meshes hidden vs shown around a direct renderer.render);
 *  5. allocation: forced GC -> 600 synchronous fixedUpdate+collide+flush
 *     steps -> forced GC (retained delta ~= 0 proves the per-frame surface
 *     allocates nothing), then a heap series across `live-ms`;
 *  6. at night the gantry hazard blink drives the shared lamp material's
 *     emissiveIntensity; at dusk fixedUpdate is a no-op (intensity frozen).
 * Prints one JSON report; touches nothing in the page outside __QA_*.
 */
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const url = args[0];
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
}
const settleMs = parseInt(opt("settle-ms", "2500"), 10);
const liveMs = parseInt(opt("live-ms", "10000"), 10);
const waitMs = parseInt(opt("wait", "12000"), 10);

if (!url) {
  console.error("usage: bun .qa/obstacle_probe.mjs <url> [--settle-ms n] [--live-ms n]");
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
    "--js-flags=--expose-gc",
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

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
const ready = await page
  .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
    timeout: Math.max(waitMs, 1000),
    polling: 250,
  })
  .then(() => true)
  .catch(() => false);
if (!ready) await page.waitForTimeout(waitMs);
await page.waitForTimeout(settleMs);

// Probe-side fixture (task 4.3): a fresh manager + the band conveyed to the
// live focus (dt 0 re-anchor; nothing ticks it but the probe).
await page.evaluate(async () => {
  const stg = await import("/qa/entity_stage.js");
  stg.stageObstacles().fixedUpdate(0, window.__QA_SHELL.dolly().z);
});

const counts = await page.evaluate(() => {
  const q = window.__QA_OBSTACLES;
  const byType = {};
  for (const r of q.records) {
    if (!r.alive) continue;
    byType[r.type] = (byType[r.type] || 0) + 1;
  }
  return {
    live: q.count(),
    max: q.max,
    byType,
    meshCounts: {
      low: q.meshes.low.count,
      gantry: q.meshes.gantry.count,
      block: q.meshes.block.count,
    },
  };
});

// Capacity: fill every type pool past its cap, confirm the overflow is
// refused, then recycle the extras (the staged band must survive intact).
const capacity = await page.evaluate(() => {
  const q = window.__QA_OBSTACLES;
  const before = q.count();
  const extra = [];
  const perType = {};
  for (const type of ["low", "gantry", "block"]) {
    for (;;) {
      const rec = q.spawn({ type, z: -1e6, lane: 0 }); // far off-scene
      if (!rec) break;
      extra.push(rec);
      perType[type] = (perType[type] || 0) + 1;
    }
  }
  const filled = q.count();
  const overflowBlocked = q.spawn({ type: "low", z: -1e6 }) === null;
  const invalidTypeNull = q.spawn({ type: "nope", z: 0 }) === null;
  for (const r of extra) q.release(r);
  return {
    before,
    filled,
    capacityTotal: q.max * 3,
    spawnedPerType: perType,
    overflowBlocked,
    invalidTypeNull,
    afterRelease: q.count(),
    bandIntact: q.records.filter((r) => r.alive && r.z > -1e5).length === 3,
  };
});

// Collision truth table (semantics from the obstacles.js file header; the
// mock profiles stand in for the mode's 4.3 jump-arc/slide state).
const truth = await page.evaluate(() => {
  const q = window.__QA_OBSTACLES;
  const C = q.cfg;
  const PP = q.playerProfile;
  const phw = C.playerHalfW;
  const phd = C.playerHalfD;
  const eps = 0.02;
  const LANE = 3.4; // CONFIG.LANE_W — adjacent-lane centre for the dodge case
  const recs = {};
  for (const r of q.records) if (r.alive && r.z > -1e5) recs[r.type] = r;
  const cases = [];
  const t = (name, type, over, expect) => {
    const r = recs[type];
    const p = { x: r.x, z: r.z, y0: 0, y1: PP.standTop, ...over };
    const h = q.collide(p);
    cases.push({ name, expect, got: h ? h.type : null, pass: (h ? h.type : null) === expect });
  };
  const tAt = (name, type, over, expect) => {
    const h = q.collide(over);
    cases.push({ name, expect, got: h ? h.type : null, pass: (h ? h.type : null) === expect });
  };

  // Run-through: grounded standing profile hits every archetype.
  t("run into low", "low", {}, "low");
  t("run into gantry", "gantry", {}, "gantry");
  t("run into block", "block", {}, "block");
  // Intended actions clear.
  t("jump over low (feet above top)", "low", { y0: recs.low.y1 + 0.05, y1: recs.low.y1 + 1.7 }, null);
  t("slide under gantry (top below gap)", "gantry", { y1: recs.gantry.y0 - 0.25 }, null);
  t("dodge block (adjacent lane)", "block", { x: recs.block.x + LANE }, null);
  // Wrong actions hit.
  t("slide into low (slide top above plank)", "low", { y1: 0.85 }, "low");
  t("jump into gantry (arc inside beam span)", "gantry", { y0: 0.7, y1: 2.4 }, "gantry");
  t("jump into block (solid at any Y)", "block", { y0: 0.9, y1: 2.6 }, "block");
  // Height boundaries: exactly at the clear threshold passes, eps shy hits.
  t("low: feet exactly at top clears", "low", { y0: recs.low.y1, y1: recs.low.y1 + 1.7 }, null);
  t("low: feet eps below top hits", "low", { y0: recs.low.y1 - eps, y1: recs.low.y1 + 1.7 }, "low");
  t("gantry: top exactly at gap clears", "gantry", { y1: recs.gantry.y0 }, null);
  t("gantry: top eps into gap hits", "gantry", { y1: recs.gantry.y0 + eps }, "gantry");
  // Z-window edges (early/late jump timing) — inside the padded window the
  // rule applies, one step outside it nothing hits.
  const zw = recs.low.zHalf + phd;
  for (const side of [-1, 1]) {
    tAt(
      `low z-edge inside (${side < 0 ? "early" : "late"}) still hits`,
      "low",
      { x: recs.low.x, z: recs.low.z + side * (zw - eps), y0: 0, y1: PP.standTop },
      "low",
    );
    tAt(
      `low z-edge outside (${side < 0 ? "early" : "late"}) clears`,
      "low",
      { x: recs.low.x, z: recs.low.z + side * (zw + eps), y0: 0, y1: PP.standTop },
      null,
    );
  }
  // X tolerance (lane easing): the body mid-transition is genuinely between
  // lanes — inside halfW + playerHalfW it hits, past it nothing does.
  const xw = recs.low.halfW + phw;
  for (const side of [-1, 1]) {
    tAt(
      `low x inside tolerance (${side < 0 ? "-" : "+"}) hits`,
      "low",
      { x: recs.low.x + side * (xw - eps), z: recs.low.z, y0: 0, y1: PP.standTop },
      "low",
    );
    tAt(
      `low x outside tolerance (${side < 0 ? "-" : "+"}) clears`,
      "low",
      { x: recs.low.x + side * (xw + eps), z: recs.low.z, y0: 0, y1: PP.standTop },
      null,
    );
  }
  // Default profile (no y0/y1): standTop default hits the gantry.
  tAt(
    "gantry: default standing profile hits",
    "gantry",
    { x: recs.gantry.x, z: recs.gantry.z },
    "gantry",
  );
  // Death-handling read: the hit IS the record (archetype + placement).
  const hit = q.collide({ x: recs.block.x, z: recs.block.z });
  const hitShape =
    hit && hit.type === "block" && typeof hit.z === "number" &&
    typeof hit.lane === "number" && typeof hit.x === "number";

  return { allPass: cases.every((c) => c.pass), cases, hitRecordShape: hitShape };
});

// Occupancy read — the 4.2 director's band-validation contract.
const occupancy = await page.evaluate(() => {
  const q = window.__QA_OBSTACLES;
  const recs = {};
  for (const r of q.records) if (r.alive && r.z > -1e5) recs[r.type] = r;
  const low = recs.low;
  const pad = 0.4;
  const bandOverlap = q.occupied(low.z - pad, low.z + pad) === true;
  const laneHit = q.occupied(low.z - pad, low.z + pad, low.lane) === true;
  const laneMiss = q.occupied(low.z - pad, low.z + pad, -low.lane) === false;
  const emptyGap = q.occupied(low.z + 3, low.z + 4) === false;
  // Director lifecycle: a fresh placement owns its window; releasing it
  // frees the window again (spawn/reservation symmetry).
  const tmp = q.spawn({ type: "block", z: low.z - 6, lane: 1 });
  const reservedNow = !!tmp && q.occupied(tmp.z - 1, tmp.z + 1, 1) === true;
  q.release(tmp);
  const reservedCleared = !q.occupied(low.z - 7, low.z - 5, 1);
  return { bandOverlap, laneHit, laneMiss, emptyGap, reservedNow, reservedCleared };
});

// Exact added cost of the three instanced meshes (main + shadow passes).
const measure = await page.evaluate(() => window.__QA_OBSTACLES.measure());

// Night-only: the gantry blink moves the shared lamp material's intensity;
// dusk fixedUpdate is a no-op (frozen intensity).
const blink = await page.evaluate(
  (isNight) => {
    const q = window.__QA_OBSTACLES;
    const mat = q.meshes.gantry.material;
    const i0 = mat.emissiveIntensity;
    q.run(90); // 1.5 s of fixed steps — the blink advances ~1.3 cycles
    const i1 = mat.emissiveIntensity;
    return { night: isNight, before: i0, after: i1, changed: i0 !== i1 };
  },
  await page.evaluate(() => window.__QA.params.timeOfDay === "night"),
);

// Allocation: GC-bracketed 600-step micro-probe (10 s of fixed steps over
// the whole per-frame surface), then a heap series across the live window.
const heap = await page.evaluate(
  async (ms) => {
    const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
    const hasGc = typeof window.gc === "function";
    if (hasGc) window.gc();
    const h0 = mem();
    window.__QA_OBSTACLES.run(600);
    if (hasGc) window.gc();
    const h1 = mem();
    const series = [];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 1000));
      series.push(mem());
    }
    const min = Math.min(...series);
    const max = Math.max(...series);
    return {
      hasGc,
      probeRetainedBytes: h1 - h0,
      series,
      seriesGrowthBytes: max - min,
    };
  },
  liveMs,
);

await browser.close();

const truthPass = truth.allPass && truth.hitRecordShape;
const occupancyPass = Object.values(occupancy).every(Boolean);
console.log(
  JSON.stringify(
    {
      ok: truthPass && occupancyPass,
      url,
      ready,
      counts,
      capacity,
      truth,
      occupancy,
      measure,
      blink,
      heap,
      consoleErrors,
      consoleWarns: consoleWarns.slice(0, 4),
      pageErrors,
    },
    null,
    2,
  ),
);
