// Seeded pattern library. Every pattern GUARANTEES a clear path (fairness,
// GAME_PROMPT §12): at least one lane passable at every z; full-width rows are
// uniformly jumpable or slideable; forced lane changes are ≥ 14 m apart
// (≥ 1.2 reaction-s at min speed); the entry corridor of the incoming safe
// lane is kept clear for the first 14 m of the chunk. Coins never route
// through hazards.
//
// Local z convention: chunk near edge = 0, far end = -60. Content at local z
// reaches the player after (eta + |z| / speed) seconds.

const MIN_Z = -58;      // never place past the far end
const ENTRY_CLEAR = 14; // corridor reserved for the incoming safe lane

// [W1-FEEL] flow channel: Director exports a shared { perf, density } state —
// density is the hazard keep-rate (struggling players → lighter patterns).
// Removing hazards can never break a guaranteed clear path, so the drop is
// always fairness-safe. Import direction world→game is read-only state.
import { flow } from '../game/Director.js';

function P(id, tier, weight, run) {
  return { id, tier, weight, run };
}

// ---- placement helpers ------------------------------------------------------

function coinLine(c, lane, z0, z1, n, y = 0.55) {
  const dz = n > 1 ? (z1 - z0) / (n - 1) : 0;
  for (let i = 0; i < n; i++) c.coin(lane, z0 + dz * i, y);
}

// Parabola matching the jump arc (v0 9.2 / g 24 → apex ≈ 1.76 m). Mid coins
// sit too high to grab from the ground — the arc rewards jumping.
function coinArc(c, lane, z0, z1, n, apex = 1.6) {
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const y = 0.5 + apex * (1 - (2 * t - 1) * (2 * t - 1));
    c.coin(lane, z0 + (z1 - z0) * t, y);
  }
}

function otherLane(rng, avoid) {
  const opts = [];
  for (let l = 0; l < 3; l++) if (l !== avoid) opts.push(l);
  return opts[Math.floor(rng() * opts.length)];
}

// Adjacent lane (max one step from l) — keeps forced weaves inside the
// one-lane-per-row rule no matter which safe lane the player arrives in.
function nearLane(rng, l) {
  return Math.max(0, Math.min(2, l + (rng() < 0.5 ? 1 : -1)));
}

function clampZ(z) { return Math.max(MIN_Z, Math.min(-ENTRY_CLEAR, z)); }

// ---- patterns ---------------------------------------------------------------

const PATTERNS = [

  // --- easy ---

  P('coin-cruise', 0, 1.0, (c) => {
    coinLine(c, c.safeIn, -8, -50, 9);
    if (c.chance(0.5)) coinLine(c, otherLane(c.rng, c.safeIn), -16, -44, 6);
    return c.safeIn;
  }),

  P('lonely-barriers', 0, 1.2, (c) => {
    // 1-2 barriers, never in the safe lane — pure warm-up.
    const s = c.safeIn;
    for (let i = 0; i < 3; i++) {
      if (!c.chance(0.8)) continue;
      c.place('barrier', otherLane(c.rng, s), clampZ(-18 - i * 16));
    }
    coinLine(c, s, -14, -54, 7);
    return s;
  }),

  P('coin-arc-run', 0, 1.0, (c) => {
    const s = c.safeIn;
    coinArc(c, s, -10, -34, 7);
    c.place('barrier', s, -22); // the arc flies over it
    if (c.chance(0.6)) coinLine(c, otherLane(c.rng, s), -38, -54, 4);
    return s;
  }),

  P('coin-weave', 0, 0.9, (c) => {
    // coins zigzag; a gentle barrier nudges you off the spent lane.
    let s = c.safeIn;
    const stops = [-12, -28, -44];
    for (let i = 0; i < stops.length; i++) {
      coinLine(c, s, stops[i], stops[i] - 8, 3);
      if (i < stops.length - 1) {
        c.place('barrier', s, stops[i + 1] - 2);
        s = otherLane(c.rng, s);
      }
    }
    return s;
  }),

  // --- medium ---

  P('jump-row', 1, 1.1, (c) => {
    // full-width barrier row — uniformly jumpable, so always fair.
    const s = c.safeIn;
    const z = clampZ(c.range(-30, -22));
    for (let l = 0; l < 3; l++) c.place('barrier', l, z);
    coinArc(c, s, z + 8, z - 8, 7);
    if (c.chance(0.55)) {
      const z2 = Math.max(MIN_Z, z - 24);
      for (let l = 0; l < 3; l++) c.place('barrier', l, z2);
      coinArc(c, s, z2 + 8, z2 - 8, 7);
    }
    return s;
  }),

  P('slide-row', 1, 1.1, (c) => {
    // full-width beam row — uniformly slideable, so always fair.
    const s = c.safeIn;
    const z = clampZ(c.range(-30, -22));
    for (let l = 0; l < 3; l++) c.place('beam', l, z);
    coinLine(c, s, z + 7, z - 7, 5, 0.5); // low line threads under
    if (c.chance(0.5)) {
      const z2 = Math.max(MIN_Z, z - 26);
      for (let l = 0; l < 3; l++) c.place('beam', l, z2);
      coinLine(c, s, z2 + 7, z2 - 7, 5, 0.5);
    }
    return s;
  }),

  P('jump-slide', 1, 1.1, (c) => {
    const s = c.safeIn;
    const zA = -22, zB = -44;
    for (let l = 0; l < 3; l++) c.place('barrier', l, zA);
    for (let l = 0; l < 3; l++) c.place('beam', l, zB);
    coinArc(c, s, zA + 7, zA - 7, 6);
    coinLine(c, s, zB + 6, zB - 6, 4, 0.5);
    return s;
  }),

  P('train-block', 1, 1.1, (c) => {
    // one long train in a side lane; entry lane stays clear, coins on the far side.
    const s = c.safeIn;
    const bad = otherLane(c.rng, s);
    c.place('train', bad, clampZ(c.range(-26, -20))); // train spans z ± 7
    coinLine(c, otherLane(c.rng, bad), -12, -50, 8);
    return s;
  }),

  // --- hard ---

  P('train-corridor', 2, 1.0, (c) => {
    // trains in lanes 0 & 2 (staggered ≤ 6 m), corridor through lane 1.
    // [W1-FEEL] fairness fix: zA used to start at -20, so a train's front edge
    // (zA + 7) could reach -13 — INSIDE the 14 m entry corridor of the safe
    // lane when safeIn was 0 or 2. Deep enough starts keep the front edge at
    // or past -14 for every safeIn.
    const zA = c.range(-25, -21);
    c.place('train', 0, zA);
    c.place('train', 2, zA - c.range(0, 6));
    coinLine(c, 1, -10, -52, 9);
    return 1;
  }),

  P('slalom', 2, 1.0, (c) => {
    // alternating double-blocks force a weave; 16 m between rows.
    // [W1-FEEL] fairness fix: the open lanes used to be hard-coded 2/0/2, so
    // arriving with safeIn 0 needed TWO lane changes in the 4 m after the
    // entry corridor (unfair at any speed). The first gap is now the incoming
    // safe lane and every step moves exactly one lane.
    const g1 = c.safeIn;
    const g2 = nearLane(c.rng, g1);
    const g3 = nearLane(c.rng, g2);
    const rows = [
      { z: -18, open: g1 }, { z: -34, open: g2 }, { z: -50, open: g3 },
    ];
    for (const r of rows) {
      for (let l = 0; l < 3; l++) if (l !== r.open) c.place('barrier', l, r.z);
      c.coin(r.open, r.z + 6, 0.55);
    }
    return g3;
  }),

  P('wall-gaps', 2, 0.9, (c) => {
    // two wall rows, each with a single gap; the gap moves max one lane per row.
    let gap = c.safeIn;
    for (let l = 0; l < 3; l++) if (l !== gap) c.place('wall', l, -20);
    c.coin(gap, -20, 0.55);
    gap = Math.max(0, Math.min(2, gap + (c.chance(0.5) ? 1 : -1)));
    for (let l = 0; l < 3; l++) if (l !== gap) c.place('wall', l, -42);
    coinLine(c, gap, -34, -50, 5);
    return gap;
  }),

  P('gauntlet', 2, 0.8, (c) => {
    // mixed hard: barrier squeeze → train wall → slide finish.
    let s = c.safeIn;
    const b1 = otherLane(c.rng, s);
    c.place('barrier', b1, clampZ(-18));
    if (b1 === s) s = otherLane(c.rng, s);
    const trainLane = otherLane(c.rng, s);
    c.place('train', trainLane, -36);
    if (trainLane === s) s = otherLane(c.rng, trainLane);
    for (let l = 0; l < 3; l++) c.place('beam', l, -52);
    coinLine(c, s, -12, -30, 5);
    coinLine(c, s, -44, -56, 3, 0.5);
    return s;
  }),
];

// calm = coins only (run-start grace, onboarding, phase-boundary guard)
const CALM = [
  P('calm-cruise', 0, 1, (c) => { coinLine(c, c.safeIn, -8, -50, 8); return c.safeIn; }),
  P('calm-arc', 0, 1, (c) => { coinArc(c, c.safeIn, -10, -40, 8); return c.safeIn; }),
];

function pickFrom(rng, list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].weight;
  let x = rng() * total;
  for (let i = 0; i < list.length; i++) {
    x -= list[i].weight;
    if (x <= 0) return list[i];
  }
  return list[list.length - 1];
}

const eligible = []; // reused scratch (runPattern runs at most ~1×/s)

// [W1-FEEL] mystery-box cadence: chunks since the last box; spawn after 7-9
// chunks (420-540 m ≈ every 500 m ±100). Module state advanced only by
// populate calls, which the seeded RNG drives — deterministic per seed.
let boxGap = 0;
const BOX_EARLY = 7;
const BOX_FORCE = 9;
const BOX_CHANCE = 0.4;

// [FX R3 determinism fix] boxGap is gen state that must belong to ONE run RNG
// stream. It used to survive Track.reset(seed) (module state), so the unseeded
// menu-boot populate left a load-dependent counter that shifted the box branch
// → different draw counts per load → same seed diverged (1/5 orb photo loads).
// Track.reset() calls this before populating; no gameplay redesign.
export function resetBoxGap() { boxGap = 0; }

// tier: 0 easy / 1 med / 2 hard (from Director). fever boosts coin-heavy picks.
export function runPattern(rng, tier, fever, calm, ctx) {
  let p;
  if (calm) {
    p = pickFrom(rng, CALM);
  } else {
    eligible.length = 0;
    for (let i = 0; i < PATTERNS.length; i++) {
      const pt = PATTERNS[i];
      if (pt.tier <= tier) {
        let w = pt.weight;
        if (fever && (pt.id === 'coin-cruise' || pt.id === 'coin-weave' || pt.id === 'coin-arc-run')) w *= 2.5;
        eligible.push({ id: pt.id, tier: pt.tier, weight: w, run: pt.run });
      }
    }
    p = pickFrom(rng, eligible.length ? eligible : CALM);
  }
  const place = ctx.place; // original placement (pre-flow-filter)

  // [W1-FEEL] flow density: while perf is low, drop a fraction of hazards.
  // One rng() per evaluated placement keeps the stream consumption
  // deterministic for a given seed.
  const dens = calm ? 1 : flow.density;
  if (dens < 1) {
    ctx.place = (type, lane, z) => { if (rng() < dens) place(type, lane, z); };
  }

  ctx.patternId = p.id;
  const out = p.run(ctx);
  const safe = out == null ? ctx.safeIn : out;
  ctx.safeOut = safe;

  // [W1-FEEL] mystery box: placed in the guaranteed-clear entry corridor of
  // the safe lane (first 14 m are hazard-free by contract), so the pickup can
  // never sit on a hazard. Every chunk counts toward the gap (calm included)
  // but calm chunks never SPAWN one — §12.3 forbids obstacle spawns within
  // the phase-boundary guard, and boxes ride the obstacle system. Cadence
  // stays within 420-600 m.
  boxGap++;
  if (!calm && (boxGap >= BOX_FORCE || (boxGap >= BOX_EARLY && rng() < BOX_CHANCE))) {
    place('mysterybox', ctx.safeIn, -7);
    boxGap = 0;
  }
  return safe;
}

export const PATTERNS_LIST = PATTERNS;
