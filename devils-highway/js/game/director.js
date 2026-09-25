/**
 * @file game/director.js — chunk-keyed spawn director (run-core-loop design
 * decision 3, task 4.2). Pre-builds a chunk's entity set on chunk activation
 * (world.onChunkActive), releases it on deactivation (world.onChunkInactive —
 * world.js fires every inactive callback BEFORE every active one, so outgoing
 * chunks free pooled records before new chunks spawn into them). Per frame
 * this only advances zombie approach + the three managers' own passes.
 *
 * Determinism (bible rule 7): every decision comes from the chunk's own
 * seeded streams — never a global rng. Tag 4 is the DEDICATED SPAWN tag
 * (builders use 1-3, world.js TAG); sub-streams append a feature tag so the
 * hashSeed part lists stay disjoint from the builders' and each other:
 *   obstacles mulberry32(hashSeed(seed, 4, index, 1)) — band z/composition
 *   zombies   mulberry32(hashSeed(seed, 4, index, 2)) — pack lane/size/speed
 *   pickups   mulberry32(hashSeed(seed, 4, index, 3)) — strand lane/span
 * Density ramps are pure functions of the chunk index; the managers consume
 * NO rng (tone/jitter/phase derive from pool slots), so these streams alone
 * decide the layout: same ?seed= => identical per-chunk set (per-layout
 * determinism, design 3). Pooled back-pressure cannot fire on the 8-chunk
 * medium window — bounds in CONFIG.SPAWN.
 *
 * Passability (modes-run spec): every band leaves >= 1 open or clearable
 * lane AT SPAWN TIME — compositions fill 1-3 lanes with DISTINCT archetypes
 * (full band = {low,gantry,block}, 2 clearable), the validator re-rolls from
 * the SAME stream on failure, never a post-hoc fix. Bands spawn first so a
 * chunk's strands/packs see them via obstacles.occupied(). Zombies are
 * CALLER-OWNED (manager contract): the director runs them straight at the
 * focus (lunge inside pack.lungeAt, cull behind pack.cullBehind — they meet
 * the player before their chunk deactivates) or releases with the chunk.
 * Missed pickups release with the chunk and award nothing.
 *
 * API (4.3's RUN mode consumes):
 *   const dir = createSpawnDirector({ world, seed, zombies, obstacles, pickups });
 *   dir.fixedUpdate(dt, focusZ) // once per fixed step AFTER the mode moved
 *   dir.reset()                 // release all (retry also does via world.reset())
 *   dir.live                    // Map<index, {bands, zoms, picks}> — QA read-only
 *   Manifests allocate at ACTIVATION rate (never per frame; the heap-gated
 *   path is fixedUpdate — spawn_probe measures both).
 */

import { CONFIG } from "../core/config.js";
import { mulberry32, hashSeed } from "../core/rng.js";

const TAG_SPAWN = 4; // dedicated spawn tag (builders use 1-3, world.js TAG)
const FEAT_TAG = { obstacles: 1, zombies: 2, pickups: 3 };
const LANES = [-1, 0, 1];
const TYPES = ["low", "gantry", "block"];
const CLEARABLE = { low: true, gantry: true, block: false };
const lerp = (a, b, t) => a + (b - a) * t;

/** Seeded sub-stream for one chunk feature (header derivation). */
function streamFor(seed, index, feat) {
  return mulberry32(hashSeed(seed, TAG_SPAWN, index, feat));
}

/** Density ramp t in [0, 1] for a chunk index — pure, no rng draws. */
function rampT(index) {
  const S = CONFIG.SPAWN;
  return Math.min(Math.max((index - S.graceChunks) / S.rampChunks, 0), 1);
}

export function createSpawnDirector({ world, seed, zombies, obstacles, pickups }) {
  const S = CONFIG.SPAWN;
  const B = S.band;
  const P = S.pack;
  const T = S.strand;
  const len = CONFIG.CHUNK_LEN;
  const obsTypes = CONFIG.OBSTACLES.types;
  const live = new Map(); // chunk index -> manifest
  const zomList = []; // flat live-zombie list (swap-remove; scan per step)

  /** Fisher-Yates over a 3-item copy. */
  function shuffle3(arr, r) {
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
  }

  /** Spec rule: >= 1 lane open or clearable. */
  function bandPassable(items) {
    let escape = LANES.length - items.length;
    for (let i = 0; i < items.length; i++) if (CLEARABLE[items[i].type]) escape++;
    return escape >= 1;
  }

  /** Candidate band: 1-3 lanes, DISTINCT archetype per lane. */
  function genBand(r, z) {
    const lanes = LANES.slice();
    const types = TYPES.slice();
    shuffle3(lanes, r);
    shuffle3(types, r);
    const count = B.lanes[0] + Math.floor(r() * (B.lanes[1] - B.lanes[0] + 1));
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({ type: types[i], lane: lanes[i], z: z + (r() * 2 - 1) * B.jitter });
    }
    return items;
  }

  /** 0-2 bands, chunk halves when 2, re-rolled from the same stream;
   *  spawned where the band query is clear (skipping only OPENS lanes). */
  function buildBands(index, zStart, manifest) {
    const r = streamFor(seed, index, FEAT_TAG.obstacles);
    let count = r() < lerp(B.chance[0], B.chance[1], rampT(index)) ? 1 : 0;
    if (count === 1 && r() < B.second) count = 2;
    for (let b = 0; b < count; b++) {
      const mid = zStart + len * 0.5;
      const lo = count === 2 && b === 1 ? mid + B.splitGap : zStart + B.edge;
      const hi = count === 2 && b === 0 ? mid - B.splitGap : zStart + len - B.edge;
      const z = lo + r() * (hi - lo);
      let items = null;
      for (let tries = 0; tries < B.maxRolls; tries++) {
        const cand = genBand(r, z);
        if (bandPassable(cand)) {
          items = cand;
          break;
        }
      }
      if (!items) items = [{ type: "low", lane: LANES[Math.floor(r() * 3)], z }]; // always clearable
      const band = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const zh = obsTypes[it.type].zHalf + B.pad;
        if (obstacles.occupied(it.z - zh, it.z + zh, it.lane)) continue;
        const rec = obstacles.spawn({ type: it.type, lane: it.lane, z: it.z });
        if (rec) band.push(rec); // null impossible within the SPAWN bounds
      }
      if (band.length > 0) manifest.bands.push(band);
    }
  }

  /** One pack: 2-4 figures, single lane, spread along z. */
  function buildPack(index, zStart, manifest) {
    const r = streamFor(seed, index, FEAT_TAG.zombies);
    if (r() >= lerp(P.chance[0], P.chance[1], rampT(index))) return;
    const lane = LANES[Math.floor(r() * 3)];
    const size = P.size[0] + Math.floor(r() * (P.size[1] - P.size[0] + 1));
    const spacing = lerp(P.spacing[0], P.spacing[1], r());
    const speed = lerp(P.speed[0], P.speed[1], r());
    const tail = (size - 1) * spacing;
    const lead = zStart + P.inset + r() * Math.max(len - 2 * P.inset - tail, 1);
    const n = Math.min(size, zombies.max - zombies.count); // back-pressure guard
    for (let i = 0; i < n; i++) {
      const z = lead + i * spacing;
      if (obstacles.occupied(z - P.clearWin, z + P.clearWin, lane)) continue; // never inside a band
      const zom = zombies.spawn({ lane, z, ry: Math.PI, pose: "run", speed, scale: lerp(P.scale[0], P.scale[1], r()) });
      if (!zom) break;
      manifest.zoms.push(zom);
      zomList.push(zom);
    }
  }

  /** 0-2 strands of 3-6 markers, perChunkMax/chunk, never inside a
   *  same-lane obstacle window. */
  function buildStrands(index, zStart, manifest) {
    const r = streamFor(seed, index, FEAT_TAG.pickups);
    let count = r() < lerp(T.chance[0], T.chance[1], rampT(index)) ? 1 : 0;
    if (count === 1 && r() < T.second) count = 2;
    let budget = T.perChunkMax;
    for (let s = 0; s < count && budget >= T.size[0]; s++) {
      let size = T.size[0] + Math.floor(r() * (T.size[1] - T.size[0] + 1));
      if (size > budget) size = budget;
      const lane = LANES[Math.floor(r() * 3)];
      const span = (size - 1) * T.spacing;
      const z0 = zStart + T.inset + r() * Math.max(len - 2 * T.inset - span, 1);
      if (obstacles.occupied(z0 - T.pad, z0 + span + T.pad, lane)) continue;
      for (let i = 0; i < size; i++) {
        const rec = pickups.spawn({ lane, z: z0 + i * T.spacing });
        if (!rec) break; // pool cap: strand tail drops (graceful)
        manifest.picks.push(rec);
        budget--;
      }
    }
  }

  function buildChunk(index, zStart) {
    if (index < S.graceChunks) return; // clear runway out of the start
    const manifest = { bands: [], zoms: [], picks: [] };
    buildBands(index, zStart, manifest); // bands first: strands/packs read them
    buildPack(index, zStart, manifest);
    buildStrands(index, zStart, manifest);
    live.set(index, manifest);
  }

  function releaseZomRecord(z) {
    const k = zomList.indexOf(z);
    if (k >= 0) {
      zomList[k] = zomList[zomList.length - 1];
      zomList.pop();
    }
    zombies.release(z); // no-op when the pass-cull already released it
  }

  function releaseChunk(index) {
    const manifest = live.get(index);
    if (!manifest) return;
    for (let i = 0; i < manifest.zoms.length; i++) releaseZomRecord(manifest.zoms[i]);
    for (let i = 0; i < manifest.picks.length; i++) pickups.release(manifest.picks[i]);
    for (let b = 0; b < manifest.bands.length; b++) {
      const band = manifest.bands[b];
      for (let i = 0; i < band.length; i++) obstacles.release(band[i]);
    }
    live.delete(index);
  }

  world.onChunkActive(buildChunk);
  world.onChunkInactive(releaseChunk);

  return {
    /** QA read-only ownership view (layout hashing / leak checks). */
    live,

    /**
     * Per fixed step AFTER the mode moved: zombie approach/lunge/cull, then
     * the three managers' passes. dt 0 rewrites the current frame.
     * @param {number} dt
     * @param {number} focusZ Player/dolly sim z.
     */
    fixedUpdate(dt, focusZ) {
      for (let i = zomList.length - 1; i >= 0; i--) {
        const z = zomList[i];
        z.z -= z.speed * dt;
        if (z.z < focusZ - P.cullBehind) {
          zombies.release(z);
          zomList[i] = zomList[zomList.length - 1];
          zomList.pop();
        } else if (z.z - focusZ < P.lungeAt) {
          z.pose = "lunge";
        }
      }
      zombies.fixedUpdate(dt);
      obstacles.fixedUpdate(dt);
      pickups.fixedUpdate(dt);
    },

    /** Release every chunk's set (world.reset() already does this through
     *  the inactive path; exposed for mode exit / direct QA use). */
    reset() {
      for (const index of [...live.keys()]) releaseChunk(index);
    },
  };
}
