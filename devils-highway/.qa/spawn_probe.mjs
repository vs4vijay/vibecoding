#!/usr/bin/env bun
/**
 * QA spawn-director probe (task 4.2, retargeted in 4.3). Same browser flags
 * as shot.mjs plus --expose-gc. Boots the REAL RUN mode (?scene=game&mode=run
 * — the mode constructs the director + managers, window.__QA_RUN) and drives
 * the world SYNCHRONOUSLY via window.__QA_AUDIT.world (no render frame
 * interleaves inside one evaluate; the chunk_probe.mjs harness). Layout is
 * captured in a probe-side onChunkActive callback — registered AFTER the
 * director's (boot order), so each chunk's manifest is deep-copied at
 * activation time, before any fixed step can move a zombie or a pooled
 * record can be reused:
 *  1. determinism: same seed -> identical per-chunk layout hashes
 *     {type,lane,x,z} across (a) a full world.reset() + re-run and
 *     (b) a second page load; a different seed -> different hashes;
 *  2. passability: EVERY band observed across all loads/seeds validates
 *     >= 1 open-or-clearable lane at spawn time (director's spec rule);
 *  3. callbacks/leaks: after each of 20 chunk cycles the live entity counts
 *     return exactly to the window baseline; world.reset() zeroes them;
 *  4. heap: 600 fixedUpdate steps (approach + lunge + cull + manager
 *     passes) retain ~0 after gc; activation-rate churn reported separately;
 *  5. integration smoke: a synchronous mini-run (window streamed + director
 *     ticked with an advancing focus — no wall-clock variance) leaves sane
 *     entity counts, at least one zombie having closed inside 15 m of the
 *     focus, pickups/obstacles streamed past it, and the score ledger's
 *     pickup/currency formula exact.
 * Prints one JSON report; touches nothing outside __QA_* surfaces.
 *
 * Usage: bun .qa/spawn_probe.mjs [qa-url-prefix]   (default seed list below)
 *   e.g. bun .qa/spawn_probe.mjs "http://127.0.0.1:8123/?qa=1"
 */
import { chromium } from "playwright-core";

const prefix = process.argv[2] || "http://127.0.0.1:8123/?qa=1";
const url = (q) => `${prefix}&scene=game&mode=run&${q}`;
const SEEDS = [7, 7, 8, 9, 10]; // load 2 repeats seed 7 (cross-load pair)

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

const waitReady = async (u) => {
  await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30000 });
  return page
    .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
      timeout: 20000,
      polling: 250,
    })
    .then(() => true)
    .catch(() => false);
};

/**
 * In-page session (one evaluate): capture layouts at activation, slide the
 * window 20 -> 2000, reset + re-run, then leak cycles + heap probes.
 */
const session = () => page.evaluate(() => {
  const w = window.__QA_AUDIT.world;
  const sp = window.__QA_RUN;
  const problems = [];
  const f5 = (v) => v.toFixed(5);

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

  // Layout capture AT activation (deep copy: records are pooled and reused,
  // zombie z moves from its spawn value on the first fixed step). Bands are
  // validated here too — the spec rule is a spawn-time invariant.
  const layouts = new Map();
  let bandsChecked = 0;
  let bandFailures = 0;
  w.onChunkActive((index) => {
    const m = sp.director.live.get(index);
    if (!m) return; // grace chunk: director builds no manifest
    const parts = [];
    for (const band of m.bands) {
      let escape = 3 - band.length; // open lanes
      for (const r of band) {
        parts.push(`o:${r.type},${f5(r.lane)},${f5(r.x)},${f5(r.z)}`);
        if (r.type !== "block") escape++; // clearable by jump/slide
      }
      bandsChecked++;
      if (escape < 1) {
        bandFailures++;
        problems.push(`chunk ${index}: band with no open-or-clearable lane`);
      }
    }
    for (const z of m.zoms) parts.push(`z:${f5(z.x)},${f5(z.z)},${f5(z.speed)},${f5(z.scale)}`);
    for (const p of m.picks) parts.push(`p:${f5(p.x)},${f5(p.z)}`);
    layouts.set(index, fnv(parts.sort().join("|")));
  });

  const counts = () => ({ z: sp.zombies.count, o: sp.obstacles.count, p: sp.pickups.count });
  const hashes = () => {
    const out = {};
    for (const [k, v] of layouts) out[k] = v;
    return out;
  };

  // Slide the window synchronously; an 8 m step crosses every chunk
  // boundary (current = floor(z/40) takes every integer).
  const Z0 = 20;
  const Z1 = 2000;
  const slide = () => {
    for (let z = Z0; z <= Z1; z += 8) w.update(0, z);
  };

  w.reset();
  w.update(0, Z0);
  const baseline = counts();
  slide();
  const run1 = hashes();
  const spawned = { chunks: layouts.size };

  // Full release + re-run: the reset must zero every pool, the re-run must
  // reproduce every per-chunk hash exactly.
  w.reset();
  const afterReset = counts();
  layouts.clear();
  slide();
  const run2 = hashes();

  const mismatch = [];
  for (const k of Object.keys(run1)) if (run1[k] !== run2[k]) mismatch.push(k);
  for (const k of Object.keys(run2)) if (!(k in run1)) mismatch.push(`extra ${k}`);
  if (mismatch.length > 0) problems.push(`reset+rerun layout mismatch on chunks ${mismatch.join(",")}`);
  if (afterReset.z !== 0 || afterReset.o !== 0 || afterReset.p !== 0) {
    problems.push(`world.reset() left entities live: ${JSON.stringify(afterReset)}`);
  }

  // Leak cycles: 20 round trips to the next chunk and back; the window at
  // Z0 is identical every return, so live counts must pin to the baseline.
  w.reset();
  w.update(0, Z0);
  const leak = [counts()];
  for (let c = 0; c < 20; c++) {
    w.update(0, Z0 + 40);
    w.update(0, Z0);
    leak.push(counts());
  }
  const leakDrift = leak.filter((c) => c.z !== leak[0].z || c.o !== leak[0].o || c.p !== leak[0].p);
  if (leakDrift.length > 0) problems.push(`leak drift across chunk cycles: ${JSON.stringify(leak)}`);

  // Heap: populated window, then ONLY the per-frame path (director
  // fixedUpdate: approach + lunge + pass-cull + the three manager passes)
  // with the focus advancing so culls fire. Activation-rate churn measured
  // separately (manifests allocate at activation by design, never per frame).
  w.reset();
  w.update(0, 400);
  const heap = () => performance.memory.usedJSHeapSize;
  window.gc();
  const h1 = heap();
  for (let i = 0; i < 600; i++) sp.director.fixedUpdate(1 / 60, 400 + i * 0.25);
  window.gc();
  const retainedFixed = heap() - h1;
  window.gc();
  const h3 = heap();
  for (let c = 0; c < 10; c++) {
    w.update(0, 800);
    w.update(0, 760);
  }
  window.gc();
  const retainedActive = heap() - h3;
  if (retainedFixed > 65536) problems.push(`fixedUpdate retained ${retainedFixed} B over 600 steps`);

  const spawnTotals = counts();
  if (spawnTotals.o === 0) problems.push("no obstacles spawned across the slide");
  if (spawnTotals.p === 0) problems.push("no pickups spawned across the slide");
  if (spawned.chunks < 40) problems.push(`only ${spawned.chunks} chunk manifests built`);

  return {
    seed: window.__QA.seed,
    spawned,
    baseline,
    afterReset,
    run1,
    run2,
    passability: { checked: bandsChecked, failures: bandFailures },
    leak: { baseline: leak[0], samples: leak.length, drift: leakDrift.length },
    heap: { retainedFixed, retainedActive },
    windowCounts: spawnTotals,
    problems,
  };
});

/**
 * Integration smoke (one evaluate, fully synchronous — the wall-clock-free
 * 4.3 replacement for the old ?time= live-preview read): stream the window
 * forward and tick the director with an advancing focus, then read what
 * streamed THROUGH the player's frame.
 */
const smoke = () => page.evaluate(() => {
  const w = window.__QA_AUDIT.world;
  const sp = window.__QA_RUN;
  const DT = 1 / 60;
  w.reset();
  w.update(0, 20);
  let minGap = Infinity;
  let passed = 0; // fixed steps where any live entity sits within ±14 m
  const start = sp.zombies.count + sp.obstacles.count + sp.pickups.count;
  for (let i = 0; i < 60 * 45; i++) { // 45 s of fixed steps -> ~340 m at base
    const focus = 20 + 7.5 * (i * DT);
    w.update(0, focus);
    sp.director.fixedUpdate(DT, focus);
    let near = false;
    for (const z of sp.zombies.records) {
      if (!z.alive) continue;
      const gap = Math.abs(z.z - focus);
      if (gap < minGap) minGap = gap;
      if (gap < 14) near = true;
    }
    for (const r of sp.obstacles.records) {
      if (r.alive && Math.abs(r.z - focus) < 14) near = true;
    }
    for (const r of sp.pickups.records) {
      if (r.alive && Math.abs(r.z - focus) < 14) near = true;
    }
    if (near) passed++;
  }
  // Ledger contract (design 9): pickups -> score bonus + currency exactly.
  sp.score.reset();
  sp.score.distance = 100;
  sp.score.onPickup(2);
  const snap = { ...sp.score.snapshot() };
  const ledgerOk =
    snap.distance === 100 && snap.pickups === 2 &&
    snap.score === 100 + 2 * 25 && snap.currency === 2 * 5;
  sp.score.reset();
  return {
    spawnedAtStart: start,
    counts: { z: sp.zombies.count, o: sp.obstacles.count, p: sp.pickups.count },
    chunks: sp.director.live.size,
    minZombieGap: Number.isFinite(minGap) ? Math.round(minGap * 10) / 10 : null,
    nearSteps: passed,
    ledger: snap,
    ledgerOk,
  };
});

// ---- loads: seed pair (7,7) + different seeds (8,9,10) for passability ----
const sessions = [];
const ready = [];
for (const seed of SEEDS) {
  const u = url(`seed=${seed}`);
  ready.push(await waitReady(u));
  sessions.push(await session());
}
const smokeReady = await waitReady(url("seed=11"));
ready.push(smokeReady);
const sm = smokeReady ? await smoke() : null;

await browser.close();

// ---- cross-load determinism ------------------------------------------------
const problems = [];
for (let i = 0; i < sessions.length; i++) {
  for (const p of sessions[i].problems) problems.push(`load${i + 1}(seed ${sessions[i].seed}): ${p}`);
}
if (!ready.every(Boolean)) problems.push("screenshotReady timeout on a load");
const bySeed = {};
for (const s of sessions) (bySeed[s.seed] = bySeed[s.seed] || []).push(s);
const seed7 = bySeed["7"];
const sameLoadPair =
  seed7[0].run1 && seed7[0].run2 &&
  JSON.stringify(seed7[0].run1) === JSON.stringify(seed7[0].run2);
const crossLoad =
  seed7.length > 1 && JSON.stringify(seed7[0].run1) === JSON.stringify(seed7[1].run1);
const seeds = Object.keys(bySeed).sort();
let crossSeedDiffer = true;
const ref = JSON.stringify(bySeed[seeds[0]][0].run1);
for (const s of seeds.slice(1)) {
  const h = JSON.stringify(bySeed[s][0].run1);
  if (h === ref) crossSeedDiffer = false;
}
if (!sameLoadPair) problems.push("seed 7: reset + re-run layout hashes differ");
if (!crossLoad) problems.push("seed 7: cross-load layout hashes differ");
if (!crossSeedDiffer) problems.push("different seeds produced identical layout hashes");

const bandsChecked = sessions.reduce((a, s) => a + s.passability.checked, 0);
const bandFailures = sessions.reduce((a, s) => a + s.passability.failures, 0);
if (bandsChecked === 0) problems.push("no bands observed (validator vacuous)");
if (bandFailures > 0) problems.push(`${bandFailures} bands failed passability`);

if (sm) {
  if (sm.counts.z === 0) problems.push("smoke: no zombies live after the mini-run");
  if (sm.counts.o === 0) problems.push("smoke: no obstacles live after the mini-run");
  if (sm.counts.p === 0) problems.push("smoke: no pickups live after the mini-run");
  if (sm.minZombieGap === null || sm.minZombieGap > 15) {
    problems.push(`smoke: no zombie closed inside 15 m (min gap ${sm.minZombieGap})`);
  }
  if (sm.nearSteps < 60) problems.push(`smoke: only ${sm.nearSteps} steps with entities in frame`);
  if (!sm.ledgerOk) problems.push(`smoke: ledger formula mismatch ${JSON.stringify(sm.ledger)}`);
}

console.log(
  JSON.stringify(
    {
      ok: problems.length === 0,
      problems,
      determinism: { sameLoadPair, crossLoad, crossSeedDiffer },
      passability: { checked: bandsChecked, failures: bandFailures },
      hashes: {
        seed7a: bySeed["7"] && bySeed["7"][0].run1,
        seed7b: seed7.length > 1 ? seed7[1].run1 : null,
        seed8: bySeed["8"] && bySeed["8"][0].run1,
      },
      heap: sessions[0].heap,
      leak: sessions[0].leak,
      windowCounts: sessions[0].windowCounts,
      smoke: sm,
      consoleErrors,
      consoleWarns: consoleWarns.slice(0, 4),
      pageErrors,
    },
    null,
    2,
  ),
);
