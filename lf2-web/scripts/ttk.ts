// scripts/ttk.ts — median 1v1 bot-duel length across seeds; the balance dial.
// Target band from the plan: 1500–4500 ticks (25–75 s at 60 Hz).
import { spawnMatch, stepWorld } from "../src/sim/world";
import type { SimContext } from "../src/sim/world";
import { loadAllContent } from "../src/content/loader";
import fetchInject from "../src/headless-content";

const PAIRS: Array<[string, string]> = [
  ["brawler", "swordsman"], ["fire-caster", "ice-caster"], ["ninja", "support-mage"],
];

const cache = await loadAllContent(await fetchInject());
const ctx: SimContext = { sheets: cache.sheets, weapons: cache.weapons, items: cache.items };
const stage = cache.stages.get("grassland-dojo")!;

const all: number[] = [];
for (const [a, b] of PAIRS) {
  const ticks: number[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    let w = spawnMatch({ seed, stage, slots: [
      { isHuman: false, charId: a, team: "red" }, { isHuman: false, charId: b, team: "blue" },
    ], sheets: cache.sheets });
    let t = 0;
    for (; t < 9000 && !w.over; t++) w = stepWorld(w, [], ctx).state;
    ticks.push(t);
  }
  const sorted = [...ticks].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  all.push(...ticks);
  console.log(`${a} vs ${b}: median ${median} ticks (${(median / 60).toFixed(1)}s) min ${sorted[0]} max ${sorted[sorted.length - 1]}`);
}
const sorted = [...all].sort((x, y) => x - y);
const median = sorted[Math.floor(sorted.length / 2)]!;
console.log(`OVERALL median ${median} ticks — target 1500–4500: ${median >= 1500 && median <= 4500 ? "OK" : "OUT OF BAND"}`);
