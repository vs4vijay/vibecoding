#!/usr/bin/env bun
/**
 * QA RUN-mode end-to-end probe (task 4.3). Same browser flags as shot.mjs,
 * plus --js-flags=--expose-gc for the heap check. Drives the FULL shell loop
 * through real inputs and the QA surfaces:
 *
 *  1. menu -> select RUN (CDP keys) -> GAME: mode active (window.__QA_RUN),
 *     world gameplay dressing flag on, player running (focus advances);
 *  2. real key "a" reaches the mode (routed + lane change fires);
 *  3. autopilot survival: an in-page interval drives the player's public
 *     request API off the live director layout (jump/slides/dodges) — the
 *     run survives >= 10 s of director-spawned hazards, distance accrues;
 *  4. pickups: a spawned in-lane marker is collected (ledger +1);
 *  5. evasion + contact, deterministic: Esc-pause freezes the shell sim,
 *     __QA_RUN.step() drives the mode synchronously — a jump clears a
 *     spawned zombie (no death), a grounded pass dies (contact);
 *  6. collision death exactly once: a spawned block kills; gameover stats
 *     shape + formula verified, stable across 300 ms;
 *  7. retry: synchronous round-trip < 1 s, fresh run (stats cleared, pools
 *     re-based, focus re-advancing);
 *  8. determinism: same ?seed= reproduces per-chunk director layout hashes
 *     (reset + re-run AND cross-load); a different seed differs;
 *  9. heap: gc -> 600 real mode steps (ramp + director + collisions +
 *     bursts) -> gc: retained ~= 0;
 * 10. quit -> menu (mode exited, gameplay flag off, __QA_RUN gone);
 *     re-select RUN -> fresh run boots again (enter/exit cycle).
 * Prints one JSON report; touches nothing outside __QA_* surfaces.
 *
 * Usage: bun .qa/run_probe.mjs [base-url]   (default http://127.0.0.1:8123)
 */
import { chromium } from "playwright-core";

const CONFIG_CRUISE_RUN = 7.5; // CONFIG.CRUISE.run — autopilot survival floor (m/s)

const base = process.argv[2] || "http://127.0.0.1:8123";
const problems = [];
const consoleErrors = [];
const consoleWarns = [];
const pageErrors = [];
let envNoise = 0; // documented ANGLE/SwiftShader boot notices (qa report 1.1)
const ENV_NOISE = /GPU stall due to ReadPixels/i;

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

async function openPage(url) {
  // SwiftShader teardown of a heavy predecessor page races the next page's
  // GPU upload — retry once on a hard failure, settle between pages.
  for (let attempt = 0; ; attempt++) {
    try {
      return await openPageOnce(url);
    } catch (e) {
      if (attempt > 0) throw e;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
}

async function openPageOnce(url) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error") consoleErrors.push(m.text());
    else if (t === "warning") {
      if (ENV_NOISE.test(m.text())) envNoise++;
      else consoleWarns.push(m.text());
    }
  });
  page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e?.message || e)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const ready = await page
    .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
      timeout: 25000,
      polling: 200,
    })
    .then(() => true)
    .catch(() => false);
  if (!ready) problems.push(`screenshotReady timeout: ${url}`);
  return page;
}

const shell = (page) =>
  page.evaluate(() => ({
    state: window.__QA_SHELL.state(),
    paused: window.__QA_SHELL.paused(),
    stats: window.__QA_SHELL.stats(),
    dolly: window.__QA_SHELL.dolly(),
    routed: window.__QA_SHELL.routed.length,
    gameplay: window.__QA_AUDIT.world.gameplay,
    qaRun: !!window.__QA_RUN,
    menuOn: document.getElementById("menu").classList.contains("on"),
    gameOn: document.getElementById("gameui").classList.contains("on"),
    sel: document.querySelector("#menu .card.sel")?.dataset.mode || null,
  }));
const check = (label, got, want) => {
  if (got !== want) problems.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const waitFor = async (page, fn, ms = 6000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(120);
  }
};

// ---- 1-2: menu -> GAME (real keys) -----------------------------------------
let page = await openPage(`${base}/?qa=1&seed=7`);
let s = await shell(page);
check("boots to menu", s.state, "menu");
check("menu shown", s.menuOn, true);
await page.keyboard.press("1"); // select RUN
await page.keyboard.press("Enter"); // start
s = await shell(page);
check("enter starts game", s.state, "game");
check("run card selected", s.sel, "run");
check("gameui on", s.gameOn, true);
check("mode surface live (__QA_RUN)", s.qaRun, true);
check("gameplay dressing flag", s.gameplay, true);

// Real gameplay key reaches the mode and moves the runner. Key "a" is the
// SCREEN-left intent; chase rigs face +z (screen-right = world −x), so the
// mode mirrors it onto lane +1 (post-slice control-mirror fix).
const lane0 = await page.evaluate(() => window.__QA_RUN.player.lane);
await page.keyboard.press("a");
await page.waitForTimeout(400);
s = await shell(page);
check("key routed to mode", s.routed >= 1, true);
check("lane change from key", await page.evaluate(() => window.__QA_RUN.player.lane), lane0 + 1);

// ---- 3: autopilot survival --------------------------------------------------
await page.evaluate(() => {
  const LANE = 3.4;
  const go = (a) => {
    const R = window.__QA_RUN;
    if (a === "left") R.player.requestLeft();
    else if (a === "right") R.player.requestRight();
    else if (a === "jump") R.player.requestJump();
    else if (a === "slide") R.player.requestSlide();
  };
  const laneClear = (R, px, pz, dir) => {
    const x = px + dir * LANE;
    if (Math.abs(x) > LANE + 0.1) return false;
    for (const o of R.obstacles.records) {
      if (o.alive && Math.abs(o.z - pz) < 8 && Math.abs(o.x - x) < 2.4) return false;
    }
    for (const z of R.zombies.records) {
      if (z.alive && Math.abs(z.z - pz) < 8 && Math.abs(z.x - x) < 2.4) return false;
    }
    return true;
  };
  window.__AUTO = setInterval(() => {
    const R = window.__QA_RUN;
    if (!R || R.player.state === "dead") return;
    const px = R.player.profile.x;
    const pz = R.player.profile.z;
    for (const o of R.obstacles.records) {
      if (!o.alive) continue;
      const dz = o.z - pz;
      if (dz <= 0 || dz > 13) continue;
      if (Math.abs(o.x - px) >= 2.4) continue;
      if (o.type === "low" && dz < 6.5) return go("jump");
      if (o.type === "gantry" && dz < 5.5) return go("slide");
      if (o.type === "block" && dz < 11) {
        if (laneClear(R, px, pz, -1)) return go("left");
        if (laneClear(R, px, pz, 1)) return go("right");
        return go("jump"); // boxed in: nothing better to try
      }
    }
    for (const z of R.zombies.records) {
      if (!z.alive) continue;
      const dz = z.z - pz;
      if (dz <= 0 || dz > 9) continue;
      if (Math.abs(z.x - px) >= 1.7) continue;
      if (laneClear(R, px, pz, -1)) return go("left");
      if (laneClear(R, px, pz, 1)) return go("right");
    }
  }, 80);
});
const d0 = await page.evaluate(() => ({
  dist: window.__QA_RUN.score.distance,
  sim: window.__QA_SHELL.dolly().simTime,
}));
await page.waitForTimeout(10500); // autopilot runs 10.5 s
const s3 = await shell(page);
const d1 = await page.evaluate(() => ({
  dist: window.__QA_RUN.score.distance,
  sim: window.__QA_SHELL.dolly().simTime,
}));
const dist3 = d1.dist;
check("autopilot survives 10.5 s of hazards", s3.state, "game");
// Load-independent expectation: the distance covered is a function of SIM
// time (fixed-step), not wall time — wall-clock margins flake when the host
// drags the frame rate (probe note, task 7.2: measured 3.9-4.2 fps idle vs
// 8.7-9.1 documented under load). Require cruise-rate progress over the sim
// seconds actually elapsed (>= 0.9 x 7.5 m/s) and a sane absolute minimum.
check(
  "distance accrues at cruise rate over sim time",
  d1.dist > d0.dist + (d1.sim - d0.sim) * CONFIG_CRUISE_RUN * 0.9 && d1.dist > d0.dist + 25,
  true,
);

// ---- 4: pickup collection ---------------------------------------------------
const picked = await page.evaluate(async () => {
  const R = window.__QA_RUN;
  const p = R.player;
  const before = R.score.pickups;
  // One marker per lane just ahead: whichever lane the autopilot holds, the
  // runner passes through a collect window.
  for (const lane of [-1, 0, 1]) R.pickups.spawn({ lane, z: R.focus() + 3 });
  const t0 = performance.now();
  while (R.score.pickups === before && performance.now() - t0 < 3000) {
    await new Promise((r) => setTimeout(r, 60));
  }
  return { before, after: R.score.pickups };
});
check("pickup collected (+1 ledger)", picked.after > picked.before, true);

// ---- 5: evasion + zombie contact (deterministic, synchronous) ---------------
// The autopilot stops here; Esc freezes the shell sim, __QA_RUN.step() then
// drives the mode directly, so the two contact outcomes are exact rather
// than timing-dependent.
await page.evaluate(() => clearInterval(window.__AUTO));
await page.keyboard.press("Escape"); // pause
const frozen = await shell(page);
check("esc pauses", frozen.paused, true);
const contact = await page.evaluate(() => {
  const R = window.__QA_RUN;
  const stepN = (n) => {
    for (let i = 0; i < n; i++) R.step(1 / 60);
  };
  // Clear a clean stretch so only the spawned zombies are in play.
  for (const o of R.obstacles.records) {
    if (o.alive && o.z > R.focus() - 2 && o.z < R.focus() + 25) R.obstacles.release(o);
  }
  for (const z of R.zombies.records) {
    if (z.alive && z.z > R.focus() - 2 && z.z < R.focus() + 25) R.zombies.release(z);
  }
  const out = {};
  // Evasion: zombie dead ahead, jump clears the contact radius mid-arc.
  R.zombies.spawn({ lane: R.player.lane, z: R.focus() + 1.6, pose: "lunge", speed: 0 });
  R.player.requestJump();
  stepN(50);
  out.evadeState = window.__QA_SHELL.state();
  out.zombiesAfterEvade = R.zombies.count;
  // Contact: grounded pass in the same lane ends the run (contact + the
  // 0.55 s death settle both land inside 60 steps).
  R.zombies.spawn({ lane: R.player.lane, z: R.focus() + 1.6, pose: "run", speed: 0 });
  stepN(60);
  out.contactState = window.__QA_SHELL.state();
  out.stats = window.__QA_SHELL.stats();
  return out;
});
check("jump evades the zombie (game continues)", contact.evadeState, "game");
check("zombie contact ends the run", contact.contactState, "gameover");

// ---- 6: retry, then collision death exactly once ----------------------------
const retryMs = await page.evaluate(() => {
  const t0 = performance.now();
  window.__QA_SHELL.retry();
  return performance.now() - t0;
});
check("retry round trip < 1000 ms", retryMs < 1000, true);
s = await shell(page);
check("retry -> game", s.state, "game");
check("retry clears stats", s.stats, null);
const fresh = await page.evaluate(() => ({
  pickups: window.__QA_RUN.score.pickups,
  state: window.__QA_RUN.player.state,
}));
check("retry clears ledger", fresh.pickups, 0);
check("retry player alive", fresh.state, "run");

const death = await page.evaluate(async () => {
  const R = window.__QA_RUN;
  R.obstacles.spawn({ type: "block", lane: R.player.lane, z: R.focus() + 2 });
  const t0 = performance.now();
  while (window.__QA_SHELL.state() === "game" && performance.now() - t0 < 4000) {
    await new Promise((r) => setTimeout(r, 60));
  }
  const stats = window.__QA_SHELL.stats();
  const t1 = performance.now();
  const stable = window.__QA_SHELL.state() === "gameover";
  await new Promise((r) => setTimeout(r, 300));
  const stats2 = window.__QA_SHELL.stats();
  return {
    dt: performance.now() - t0,
    stable: stable && window.__QA_SHELL.state() === "gameover",
    stats,
    statsStable: JSON.stringify(stats) === JSON.stringify(stats2),
  };
});
check("block collision ends the run", death.dt < 4000, true);
check("death fires exactly once (stats stable)", death.statsStable, true);
const st = death.stats || {};
check("stats.distance > 0", st.distance > 0, true);
check(
  "score formula (distance + pickups x 25)",
  st.score === Math.floor(st.distance) + st.pickups * 25,
  true,
);
check("currency formula (pickups x 5)", st.currency === st.pickups * 5, true);

// ---- 8: seed determinism (this page + cross-load) ---------------------------
const hashLayouts = (pg) => pg.evaluate(() => {
  const w = window.__QA_AUDIT.world;
  const R = window.__QA_RUN;
  const fnv = (str) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2545f491) >>> 0;
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  const layouts = new Map();
  w.onChunkActive((index) => {
    const m = R.director.live.get(index);
    if (!m) return;
    const parts = [];
    for (const band of m.bands) {
      for (const r of band) parts.push(`o:${r.type},${r.lane.toFixed(4)},${r.z.toFixed(4)}`);
    }
    for (const z of m.zoms) parts.push(`z:${z.x.toFixed(4)},${z.z.toFixed(4)},${z.speed.toFixed(4)}`);
    for (const p of m.picks) parts.push(`p:${p.lane.toFixed(4)},${p.z.toFixed(4)}`);
    layouts.set(index, fnv(parts.sort().join("|")));
  });
  const slide = () => {
    for (let z = 20; z <= 800; z += 8) w.update(0, z);
  };
  // Reset the pools TOO, not just the world: this page's own contact-test
  // spawns are manager-live but NOT in director manifests, so world.reset()'s
  // inactive burst never releases them — leftovers would skew the slide's
  // zombies.max-count back-pressure and forge a cross-load "difference".
  R.zombies.reset();
  R.obstacles.reset();
  R.pickups.reset();
  w.reset();
  layouts.clear();
  slide();
  const out = {};
  for (const [k, v] of layouts) out[k] = v;
  return out;
});
const runA = await hashLayouts(page);
const runB = await hashLayouts(page);
check("same seed: reset + re-run layout hashes identical",
  JSON.stringify(runA) === JSON.stringify(runB) && Object.keys(runA).length > 5, true);
await page.close();
await new Promise((r) => setTimeout(r, 2000)); // GPU teardown settle
const page2 = await openPage(`${base}/?qa=1&scene=game&mode=run&seed=7`);
const runC = await hashLayouts(page2);
check("same seed: cross-load layout hashes identical",
  JSON.stringify(runA) === JSON.stringify(runC), true);
await page2.close();
await new Promise((r) => setTimeout(r, 2000));
const page3 = await openPage(`${base}/?qa=1&scene=game&mode=run&seed=9`);
const runD = await hashLayouts(page3);
check("different seed: layout hashes differ", JSON.stringify(runA) !== JSON.stringify(runD), true);

// ---- 9: heap over the real mode hot path ------------------------------------
const heap = await page3.evaluate(() => {
  const R = window.__QA_RUN;
  const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
  const hasGc = typeof window.gc === "function";
  if (window.__QA_SHELL.state() === "gameover") window.__QA_SHELL.retry();
  const clearAhead = () => {
    // Keep an unattended run alive so every step exercises the full hot path
    // (ramp + player + director + collide scans + manager passes).
    for (const o of R.obstacles.records) {
      if (o.alive && o.z > R.focus() && o.z < R.focus() + 22) R.obstacles.release(o);
    }
    for (const z of R.zombies.records) {
      if (z.alive && z.z > R.focus() && z.z < R.focus() + 22) R.zombies.release(z);
    }
  };
  if (hasGc) window.gc();
  const h0 = mem();
  for (let i = 0; i < 600; i++) {
    if (i % 60 === 0) clearAhead();
    if (i === 120) R.pickups.spawn({ lane: 0, z: R.focus() + 4 });
    if (i === 240) R.zombies.spawn({ lane: 1, z: R.focus() + 6, pose: "run", speed: 0 });
    if (i === 360) R.fx.burst(R.player.profile.x, 0.35, R.focus() + 2, "pickup");
    R.step(1 / 60);
  }
  if (hasGc) window.gc();
  return {
    hasGc,
    retained: mem() - h0,
    state: window.__QA_SHELL.state(),
    distance: Math.round(R.score.distance),
  };
});
check("600 real mode steps retain ~= 0", heap.retained < 65536, true);
check("hot path stayed live (run did not end)", heap.state, "game");

// ---- 10: quit -> menu -> re-enter -------------------------------------------
await page3.evaluate(() => window.__QA_SHELL.quit());
s = await shell(page3);
check("quit -> menu", s.state, "menu");
check("menu shown", s.menuOn, true);
check("mode exited (__QA_RUN gone)", s.qaRun, false);
check("gameplay flag off", s.gameplay, false);
await page3.keyboard.press("1");
await page3.keyboard.press("Enter");
s = await shell(page3);
check("re-select run boots a fresh run", s.state, "game");
check("gameplay flag back on", s.gameplay, true);
await page3.close();

await browser.close();

const report = {
  ok: problems.length === 0 && consoleErrors.length === 0 && consoleWarns.length === 0
    && pageErrors.length === 0,
  problems,
  survival: { distance: dist3, autopilotSurvived: s3.state === "game" },
  pickups: picked,
  contact,
  retryMs,
  death,
  determinism: { sameSeedHashes: Object.keys(runA).length, sample: Object.values(runA)[0] },
  heap,
  envNoiseWarnings: envNoise,
  consoleErrors,
  consoleWarns,
  pageErrors,
};
console.log(JSON.stringify(report, null, 2));
