#!/usr/bin/env bun
/** Debug 3: scan seeds for a playthrough-worthy early road (regular bands +
 *  pickups in the first ~300 m). Synchronous world slide, no sim racing. */
import { chromium } from "playwright-core";

const base = process.argv[2] || "http://127.0.0.1:8123";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--hide-scrollbars", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${base}/?qa=1&scene=game&mode=run&seed=41`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__QA?.screenshotReady === true, null, { timeout: 25000, polling: 200 });

const scan = (seed) =>
  page.evaluate((sd) => {
    // Re-key the run seed: the page reads ?seed= once at boot; instead scan
    // by reloading is expensive — use the director's own stream derivation
    // via a fresh boot per seed instead. (Fallback: this fn re-slides only.)
    const w = window.__QA_AUDIT.world;
    const R = window.__QA_RUN;
    const obs = [];
    const picks = [];
    w.reset();
    R.obstacles.reset();
    R.pickups.reset();
    R.zombies.reset();
    for (let z = 20; z <= 400; z += 8) {
      w.update(0, z);
      for (const o of R.obstacles.records) {
        if (o.alive && !obs.some((q) => q === o.z.toFixed(1))) obs.push(o.z.toFixed(1));
      }
      for (const k of R.pickups.records) {
        if (k.alive && !picks.some((q) => q === k.z.toFixed(1))) picks.push(k.z.toFixed(1));
      }
    }
    const zs = obs.map(Number).sort((a, b) => a - b);
    return { seed: sd, first: zs[0] ?? null, n: zs.length, obs: zs, picks: picks.length };
  }, seed);

// Reloading per seed is the honest path (?seed= is boot-time).
for (let seed = 41; seed <= 58; seed++) {
  await page.goto(`${base}/?qa=1&scene=game&mode=run&seed=${seed}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__QA?.screenshotReady === true, null, { timeout: 25000, polling: 200 }).catch(() => {});
  const r = await scan(seed);
  const gaps = r.obs.map(Number);
  const maxGap = gaps.length ? Math.max(...gaps.slice(1).map((z, i) => z - gaps[i]), 0) : 999;
  console.log(`seed ${seed}: first=${r.first} n=${r.n} picks=${r.picks} maxGap=${maxGap.toFixed(0)} obs=[${r.obs.join(" ")}]`);
}
await browser.close();
