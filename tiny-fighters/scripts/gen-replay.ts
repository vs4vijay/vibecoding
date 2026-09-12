// scripts/gen-replay.ts — generates tests/fixtures/replay-001.json with fully
// scripted inputs (no bots, no RNG beyond the seeded spawn): P1 walks in and
// punches a 3-hit chain, casts energyBlast (D>A, 25 MP), jumps at t=500; P2
// walks in and swings simultaneously with P1's third punch so two hitboxes
// resolve on the same tick (priority 12 vs 10). That simultaneous trade is
// load-bearing: it is the only point where the hitdetect priority sort is
// observable, so the golden pin's tamper check (flip the sort → hash must
// change) actually fails. Output is committed; regenerate only when the
// scenario itself should change — never to mask a determinism failure.
//
// Deviation from the plan brief's original generator (approved 2026-09-06):
// the original had P2 idle, which provably never exercises the sort — the
// prescribed tamper check passed under tampering. P2 now approaches and times
// one slash (press at t=47) to trade with P1's punch3; all other beats and the
// 1200-tick length are unchanged. Retimed again 2026-09-06 when grab
// initiation (task 8.5 fix round 1) made the old t=45 press land inside grab
// reach — see the trade comment below.
import type { InputFrame } from "../src/sim/types";

type Partial4 = Partial<InputFrame>;
const N = (over: Partial4 = {}): Partial4 =>
  ({ a: false, j: false, dHeld: false, dir: { x: 0, z: 0 }, ...over });

const TICKS = 1200;
const p1: Partial4[] = Array.from({ length: TICKS }, () => N());
const p2: Partial4[] = Array.from({ length: TICKS }, () => N());

for (let t = 0; t <= 21; t++) p1[t] = N({ dir: { x: 1, z: 0 } });    // P1 walks right (one tick short: keeps the t=52 trade outside grab reach)
for (let t = 0; t <= 24; t++) p2[t] = N({ dir: { x: -1, z: 0 } });   // P2 walks left (stops closer)
for (const t of [23, 33, 43]) { p1[t] = N({ a: true }); p1[t + 1] = N({ a: true }); }
p2[47] = N({ a: true });                                              // slash1 — trades with punch3
// t≈52: punch3 (heavy, priority 12) and slash1 (light, priority 10) are both
// active — the trade that makes the priority sort observable. (Beat retimed
// for grab initiation, spec §2.2: at the original t=45 press the gap was
// 61.67px — inside GRAB_RANGE + 14 = 62 — so the FSM rerouted slash1 to
// hiltBash and the tamper check went blind. P1 now stops one walk tick
// earlier and P2 presses at t=47: the press sees ~65px, outside grab reach,
// and both hitboxes still overlap on the same tick (t52), so flipping the
// hitdetect sort still flips the hash.)
for (let t = 295; t <= 306; t++) p1[t] = N({ dHeld: true });          // hold Defend
p1[300] = N({ dHeld: true, dir: { x: 1, z: 0 } });                    // ">" edge
p1[305] = N({ dHeld: true, dir: { x: 1, z: 0 }, a: true });           // D>A complete
p1[500] = N({ j: true });                                             // jump
p2[500] = N({ j: true });

const replay = {
  seed: 20260824,
  stageId: "grassland-dojo",
  slots: [
    { isHuman: true, charId: "brawler", team: "red" },
    { isHuman: true, charId: "swordsman", team: "blue" },
  ],
  inputs: p1.map((f, i) => [f, p2[i]!]),
};

await Bun.write("tests/fixtures/replay-001.json", JSON.stringify(replay));
console.log("wrote tests/fixtures/replay-001.json");
