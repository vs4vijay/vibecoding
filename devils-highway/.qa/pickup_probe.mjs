#!/usr/bin/env bun
/**
 * QA pickup + particle probe (task 3.3; kept as the entity systems'
 * regression tool). Same browser flags as shot.mjs, plus
 * --js-flags=--expose-gc for the heap check. Since task 4.3 the probe
 * constructs its OWN fixture in-page (qa/entity_stage.js — a fresh manager +
 * particle system, never the live RUN mode's systems):
 *
 * Usage: bun .qa/pickup_probe.mjs <url> [--settle-ms 2500] [--live-ms 10000]
 *
 * Verifies, in ONE page load of ?qa=1&mode=run&scene=game:
 *  1. staged strands live (5 lane-0 + 3 lane-(-1) markers), mesh count 8;
 *  2. capacity: pool fills to CONFIG.PICKUPS.max, overflow spawn null,
 *     extras recycle cleanly, strands intact;
 *  3. collection truth: tryCollect consumes exactly once (returns the
 *     record, alive flips false, count drops, second call null); lane-index
 *     and absolute-x profiles both hit; x/z window boundaries bound exactly
 *     (halfW + playerHalfW, zHalf + playerHalfD); other-lane profiles miss;
 *     missed pickups STAY live (release is caller-driven);
 *  4. release API: spawn->release recycles (chunk-despawn path);
 *     release(null)/double-release are safe no-ops;
 *  5. emissive pulse: the shared material's intensity moves across fixed
 *     steps and stays inside the CONFIG.PICKUPS.pulse band;
 *  6. particles: 2 bursts raise the live point count (12 + 30), decay
 *     reaches 0, colors zero + points parked + visible false after death,
 *     attributes recycle across later bursts;
 *  7. EXACT added draw/tri cost via __QA_PICKUPS.measure() (mesh + points
 *     hidden vs shown around a direct renderer.render);
 *  8. allocation: forced GC -> 600 fixed steps with interleaved bursts ->
 *     forced GC (retained delta ~= 0 proves the per-frame surface allocates
 *     nothing), then a heap series across `live-ms`.
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
  console.error("usage: bun .qa/pickup_probe.mjs <url> [--settle-ms n] [--live-ms n]");
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

// Probe-side fixture (task 4.3): a fresh manager + particle system, strands
// conveyed to the live focus (dt 0 re-anchor; nothing ticks it but the probe).
await page.evaluate(async () => {
  const stg = await import("/qa/entity_stage.js");
  stg.stagePickups().fixedUpdate(0, window.__QA_SHELL.dolly().z);
});

// Stop the ambient burst cadence so particle counts are probe-owned.
await page.evaluate(() => window.__QA_PICKUPS.quiet(true));

const counts = await page.evaluate(() => {
  const q = window.__QA_PICKUPS;
  const lanes = { "0": 0, "-1": 0, "1": 0 };
  for (const r of q.records) {
    if (r.alive) lanes[String(r.lane)]++;
  }
  return {
    live: q.count(),
    max: q.max,
    lanes,
    meshCount: q.mesh.count,
    visible: q.mesh.visible,
  };
});

// Capacity: fill the pool, confirm overflow is refused, recycle the extras
// (the staged strands must survive intact).
const capacity = await page.evaluate(() => {
  const q = window.__QA_PICKUPS;
  const before = q.count();
  const extra = [];
  for (;;) {
    const rec = q.spawn({ z: -1e6, lane: 0 }); // far off-scene
    if (!rec) break;
    extra.push(rec);
  }
  const filled = q.count();
  const overflowBlocked = q.spawn({ z: -1e6 }) === null;
  for (const r of extra) q.release(r);
  return {
    before,
    filled,
    capacityTotal: q.max,
    overflowBlocked,
    afterRelease: q.count(),
    strandsIntact: q.records.filter((r) => r.alive && r.z > -1e5).length === 8,
  };
});

// Collection truth table (semantics from the pickups.js file header; the
// mock profiles stand in for the mode's 4.3 collector).
const collect = await page.evaluate(() => {
  const q = window.__QA_PICKUPS;
  const C = q.cfg;
  const eps = 0.02;
  const xw = C.halfW + C.playerHalfW;
  const zw = C.zHalf + C.playerHalfD;
  const cases = [];
  const t = (name, prof, expectId) => {
    const got = q.tryCollect(prof);
    cases.push({
      name,
      expect: expectId === null ? "miss" : "hit",
      got: got === null ? "miss" : "hit",
      idMatch: expectId === null ? true : got && got.id === expectId,
      pass: (got === null ? "miss" : "hit") === (expectId === null ? "miss" : "hit") &&
        (expectId === null || (got && got.id === expectId)),
    });
  };

  const markers = q.records.filter((r) => r.alive && r.z > -1e5);
  const lane0 = markers.filter((r) => r.lane === 0);
  const laneM1 = markers.filter((r) => r.lane === -1);

  // Absolute-x profile on the first lane-0 marker: hit, exact record.
  t("collect marker by x/z", { x: lane0[0].x, z: lane0[0].z }, lane0[0].id);
  const c0 = cases[cases.length - 1];
  // Exactly once: consumed -> alive false, count dropped, second call null.
  const consumedOnce = !lane0[0].alive && q.count() === markers.length - 1;
  t("re-collect consumed marker", { x: lane0[0].x, z: lane0[0].z }, null);
  // Lane-index profile on a lane-(-1) marker.
  t("collect by lane index", { lane: -1, z: laneM1[0].z }, laneM1[0].id);
  // Other-lane profiles miss (empty lane 1, and lane 0 x shifted a lane).
  t("other lane misses (empty lane 1)", { lane: 1, z: lane0[1].z }, null);
  t("adjacent-lane x misses", { x: lane0[1].x + 3.4, z: lane0[1].z }, null);

  // Window boundaries on throwaway spawns — each at a UNIQUE far z and
  // released right after its case, so leftovers can't alias later profiles.
  const far = (k) => -1e6 - k * 50;
  const tmp = q.spawn({ z: far(1), lane: 0 });
  t("x inside tolerance hits", { x: tmp.x + (xw - eps), z: tmp.z }, tmp.id);
  const tmp2 = q.spawn({ z: far(2), lane: 0 });
  t("x outside tolerance misses", { x: tmp2.x + (xw + eps), z: tmp2.z }, null);
  q.release(tmp2);
  const tmp3 = q.spawn({ z: far(3), lane: 0 });
  t("z window inside hits", { x: tmp3.x, z: tmp3.z + (zw - eps) }, tmp3.id);
  const tmp4 = q.spawn({ z: far(4), lane: 0 });
  t("z window outside misses", { x: tmp4.x, z: tmp4.z + (zw + eps) }, null);
  q.release(tmp4);
  const tmp5 = q.spawn({ z: far(5), lane: 0 });
  t("z window behind hits", { x: tmp5.x, z: tmp5.z - (zw - eps) }, tmp5.id);

  // Missed pickups STAY live: the miss cases above released nothing, so 6
  // of the 8 staged markers are still alive (release is caller-driven).
  const missedStay = q.records.filter((r) => r.alive && r.z > -1e5).length === 6;
  // Release API (chunk-despawn path): spawn->release recycles; no-ops safe.
  const tmp6 = q.spawn({ z: -1e6, lane: 1 });
  const beforeRelease = q.count();
  q.release(tmp6);
  q.release(tmp6); // double release
  q.release(null); // null safe
  const releaseOk = q.count() === beforeRelease - 1;

  return {
    allPass: cases.every((c) => c.pass) && c0.idMatch,
    cases,
    consumedOnce,
    missedStay,
    releaseOk,
    consumedShape: typeof lane0[0].x === "number" && typeof lane0[0].z === "number",
  };
});

// Emissive pulse: shared material intensity moves across fixed steps and
// stays inside the configured band.
const pulse = await page.evaluate(() => {
  const q = window.__QA_PICKUPS;
  const tod = window.__QA.params.timeOfDay === "night" ? q.cfg.pulse.night : q.cfg.pulse.dusk;
  const i0 = q.material.emissiveIntensity;
  q.run(60); // 1 s of fixed steps at pulse.hz 0.9 ~ 0.9 cycles
  const i1 = q.material.emissiveIntensity;
  return {
    before: i0,
    after: i1,
    changed: i0 !== i1,
    inBand: i1 >= tod.min - 1e-6 && i1 <= tod.max + 1e-6,
    band: tod,
  };
});

// Particles: 2 bursts raise the count, decay reaches exactly 0, attributes
// recycle (colors zeroed + parked after death, reused by later bursts).
const particles = await page.evaluate(async () => {
  const q = window.__QA_PICKUPS;
  const p = q.particles;
  const far0 = -2e6; // probe-owned burst site (off-scene; nothing visible)
  const waitDead = () => {
    for (let i = 0; i < 400 && p.live() > 0; i++) p.run(30); // <= 200 s sim, ample
    return p.live() === 0;
  };
  const drained0 = waitDead();
  const vis0 = p.object.visible;
  p.burst(0, 0.35, far0, "pickup");
  const afterPickup = p.live();
  p.burst(0, 0.4, far0, "death");
  const afterDeath = p.live();
  p.run(1); // one fixed step: update() flips visible while anything lives
  const visLive = p.object.visible;
  // Sample a live point's color + height before decay.
  const liveIdx = [];
  for (let i = 0; i < p.capacity && liveIdx.length < 3; i++) {
    if (p.object.geometry.attributes.color.array[i * 3] !== 0) liveIdx.push(i);
  }
  const sampled = liveIdx.map((i) => ({
    y: p.object.geometry.attributes.position.array[i * 3 + 1],
    r: p.object.geometry.attributes.color.array[i * 3],
  }));
  const drained = waitDead();
  const col = p.object.geometry.attributes.color.array;
  const pos = p.object.geometry.attributes.position.array;
  let clean = true;
  for (let i = 0; i < p.capacity; i++) {
    if (col[i * 3] !== 0 || col[i * 3 + 1] !== 0 || col[i * 3 + 2] !== 0) clean = false;
    if (pos[i * 3 + 1] !== -50) clean = false;
  }
  const visDead = p.object.visible;
  // Recycle: later bursts reuse the drained slots.
  p.burst(0, 0.35, -1e6, "pickup");
  p.burst(0, 0.35, -1e6, "pickup");
  const recycled = p.live() === 24;
  waitDead();
  return {
    drained0,
    vis0,
    counts: { pickup: afterPickup, both: afterDeath },
    countsOk: afterPickup === 12 && afterDeath === 42,
    visLive,
    liveSamplesColored: sampled.length === 3 && sampled.every((s) => s.r > 0 && s.y > 0),
    drained,
    attrsClean: clean,
    visDead,
    recycled,
  };
});

// Exact added cost of the crate mesh + points (main pass; nothing casts
// shadows). One live burst keeps the points side of the A/B honest.
const measure = await page.evaluate(() => {
  const q = window.__QA_PICKUPS;
  q.particles.burst(0, 0.35, -1e6, "pickup");
  q.particles.burst(0, 0.4, -1e6, "death");
  return q.measure();
});

// Allocation: GC-bracketed 600-step micro-probe over the whole per-frame
// surface with interleaved bursts, then a heap series across the live window.
const heap = await page.evaluate(
  async (ms) => {
    const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
    const hasGc = typeof window.gc === "function";
    const q = window.__QA_PICKUPS;
    if (hasGc) window.gc();
    const h0 = mem();
    for (let b = 0; b < 10; b++) {
      q.particles.burst(b * 0.5, 0.35, -1e6, b % 3 === 2 ? "death" : "pickup");
      q.run(60);
    }
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

const ok =
  counts.live === 8 &&
  counts.meshCount === 8 &&
  capacity.overflowBlocked &&
  capacity.afterRelease === 8 &&
  capacity.strandsIntact &&
  collect.allPass &&
  collect.consumedOnce &&
  collect.missedStay &&
  collect.releaseOk &&
  pulse.changed &&
  pulse.inBand &&
  particles.countsOk &&
  particles.drained &&
  particles.attrsClean &&
  particles.recycled &&
  particles.liveSamplesColored &&
  measure.deltaCalls === 2 &&
  heap.probeRetainedBytes < 4096;

console.log(
  JSON.stringify(
    {
      ok,
      url,
      ready,
      counts,
      capacity,
      collect,
      pulse,
      particles,
      measure,
      heap,
      consoleErrors,
      consoleWarns: consoleWarns.slice(0, 4),
      pageErrors,
    },
    null,
    2,
  ),
);
