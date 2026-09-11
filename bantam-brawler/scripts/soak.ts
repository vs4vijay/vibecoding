// scripts/soak.ts — 8-bot FFA soak over seeds 1..20 on both stages.
// Surfaces stuck-in-wall, infinite-grab, and never-ending-match bugs
// deterministically: any failure prints (stage, seed, tick) so the exact
// match can be replayed via HEADLESS=1 bun src/main.ts --replay <fixture>.
import { spawnMatch, stepWorld } from "../src/sim/world";
import type { SimContext } from "../src/sim/world";
import { loadAllContent } from "../src/content/loader";
import fetchInject from "../src/headless-content";
import { MAX_FIGHTERS } from "../src/sim/constants";
import type { Team } from "../src/sim/types";

const CHAR_IDS = ["brawler", "swordsman", "fire-caster", "ice-caster", "ninja", "support-mage"];
const TICK_CAP = 9000; // 150 s of game time per match

const cache = await loadAllContent(await fetchInject());
if (cache.errors.length > 0) throw new Error("content errors: " + JSON.stringify(cache.errors));
const ctx: SimContext = { sheets: cache.sheets, weapons: cache.weapons, items: cache.items };

const lengths: Array<{ stage: string; seed: number; ticks: number }> = [];
let failures = 0;

for (const stageId of ["grassland-dojo", "rooftop-night"]) {
  const stage = cache.stages.get(stageId)!;
  for (let seed = 1; seed <= 20; seed++) {
    const slots = Array.from({ length: MAX_FIGHTERS }, (_, i) => ({
      isHuman: false, charId: CHAR_IDS[i % CHAR_IDS.length]!, team: "independent" as Team,
    }));
    let w = spawnMatch({ seed, stage, slots, sheets: cache.sheets });
    let sawMatchEnd = false;
    let ticks = 0;
    for (; ticks < TICK_CAP && !w.over; ticks++) {
      const r = stepWorld(w, [], ctx);
      w = r.state;
      if (r.events.some((e) => e.type === "matchEnd")) sawMatchEnd = true;
      for (const f of w.fighters) {
        const bad = [f.x, f.y, f.z, f.vx, f.vy, f.vz, f.hp, f.mp].some((v) => !Number.isFinite(v));
        if (bad) {
          console.error(`FAIL ${stageId} seed=${seed} tick=${ticks} fighter=${f.id}: non-finite state`);
          failures++;
        }
      }
    }
    if (!w.over) { console.error(`FAIL ${stageId} seed=${seed}: no matchEnd within ${TICK_CAP} ticks`); failures++; }
    else if (!sawMatchEnd) { console.error(`FAIL ${stageId} seed=${seed}: ended without matchEnd event`); failures++; }
    else lengths.push({ stage: stageId, seed, ticks });
  }
}

const sorted = lengths.map((l) => l.ticks).sort((a, b) => a - b);
const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : NaN;
console.log(`completed=${lengths.length}/40 failures=${failures} medianTicks=${median} (${(median / 60).toFixed(1)}s)`);
for (const l of lengths) console.log(`  ${l.stage} seed=${l.seed}: ${l.ticks} ticks`);
if (failures > 0) process.exit(1);
