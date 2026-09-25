/**
 * @file qa/entity_stage.js — probe-side entity staging fixtures (task 4.3).
 * The task-3.1/3.2/3.3 QA stages moved here OUT of js/ (the staged=gauntlet
 * mode staging retired them from main.js + the entity modules — the planned
 * ~12 KB reclaim; the stage constants below are QA-only, deliberately NOT
 * gameplay CONFIG). The probes construct a stage THEMSELVES on the live
 * scene, in-page:
 *
 *   const stg = await import("/qa/entity_stage.js");
 *   await stg.stageZombies();   // -> window.__QA_ZOMBIES (fresh manager)
 *   await stg.stageObstacles(); // -> window.__QA_OBSTACLES
 *   await stg.stagePickups();   // -> window.__QA_PICKUPS (+ particles)
 *
 * Each stage builds its OWN manager instance (never the live RUN mode's —
 * probe fixtures must not pollute the running game) against
 * window.__QA_AUDIT.scene. Nothing ticks them (main.js no longer does):
 * probes drive everything synchronously; call `stg.get("zombies")
 * .fixedUpdate(0, focusZ)` once to re-anchor a conveyor layout before
 * measuring. Surfaces are byte-identical to the pre-4.3 stages.
 */
import { CONFIG } from "./../js/core/config.js";
import { materialLibrary } from "./../js/core/assets.js";
import { createZombieManager } from "./../js/entities/zombies.js";
import { createObstacleManager } from "./../js/entities/obstacles.js";
import { createPickupManager } from "./../js/entities/pickups.js";
import { createParticleSystem } from "./../js/entities/particles.js";

const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);

// QA-only staging constants (the former CONFIG.ZOMBIES.stage /
// CONFIG.OBSTACLES.stage.band / CONFIG.PICKUPS.stage tables).
const Z_STAGE = {
  pack: { run: 18, shamble: 8, lunge: 6 },
  nearCount: 6, // figures kept in the close band (death-range framing)
  zNear: [4.5, 8.5], // close band ahead of the anchor (m)
  zAhead: [8, 30], // main band ahead of the anchor (m)
  chase: [2.4, 3.4], // chaser approach speed (m/s)
  crossSpeed: 0.7, // crosser pace along -z (m/s)
  crossAmp: 1.2, // crosser lane weave amplitude (m)
  crossSwayHz: 0.4, // weave cycles/s
  respawnBehind: 10, // recycled once this far behind the anchor (m)
};
const O_STAGE = {
  band: [
    { type: "low", lane: -1, z: 8 },
    { type: "gantry", lane: 0, z: 13.5 },
    { type: "block", lane: 1, z: 19 },
  ],
};
const P_STAGE = {
  strand: [
    { lane: 0, z: 8 }, { lane: 0, z: 10.2 }, { lane: 0, z: 12.4 },
    { lane: 0, z: 14.6 }, { lane: 0, z: 16.8 },
    { lane: -1, z: 20 }, { lane: -1, z: 22.2 }, { lane: -1, z: 24.4 },
  ],
  burstEvery: 1.1, // s between ambient bursts when conveyed live
  flash: { pickup: { lane: 0, z: 6 }, death: { lane: 1, z: 9.5 } },
};

const live = new Map(); // name -> stage handle

function scene() {
  if (!window.__QA_AUDIT) throw new Error("entity_stage needs ?qa=1 (__QA_AUDIT)");
  return window.__QA_AUDIT.scene;
}

/** Task-3.1 zombie fixture: a fresh manager + a full pack posed around an
 *  anchor z (pass { fixedUpdate(dt, anchorZ) } to re-anchor; the manager's
 *  own movement demo only runs when ticked). */
export function stageZombies() {
  if (live.has("zombies")) return live.get("zombies");
  const mgr = createZombieManager(scene(), materialLibrary);
  const S = Z_STAGE;
  const span = S.zAhead[1] - S.zAhead[0];
  const order = [];
  for (const [pose, n] of Object.entries(S.pack)) {
    for (let i = 0; i < n; i++) order.push(pose);
  }
  let t = 0;
  const fr = (i, a) => frac(i * a);

  function spawnOne(i, anchorZ) {
    const pose = order[(i * 7) % order.length]; // 7 coprime 32: poses spread
    const near = i < S.nearCount;
    const z = mgr.spawn({
      lane: (i % 3) - 1,
      z: anchorZ + (near
        ? S.zNear[0] + fr(i, 0.618) * (S.zNear[1] - S.zNear[0])
        : S.zAhead[0] + fr(i, 0.618) * span),
      ry: Math.PI,
      pose,
      speed: pose === "shamble"
        ? S.crossSpeed
        : S.chase[0] + fr(i, 0.383) * (S.chase[1] - S.chase[0]),
      scale: 0.94 + fr(i, 0.271) * 0.12,
    });
    if (z) {
      z.stageMode = pose === "shamble" ? "cross" : "chase";
      z.stageLane = z.x;
      z.stagePhase = z.phase;
    }
    return z;
  }

  window.__QA_ZOMBIES = {
    max: mgr.max,
    count: () => mgr.count,
    records: mgr.records,
    meshes: mgr.meshes,
    /** Hide/show the two zombie meshes (exact added-draw A/B). */
    show(on) {
      mgr.setVisible(on);
    },
    /** Drive n fixed steps synchronously (heap allocation micro-probe). */
    run(n) {
      for (let i = 0; i < n; i++) mgr.fixedUpdate(1 / 60);
    },
    /** One page, two direct scene renders: zombies hidden vs shown.
     *  Returns the exact added main+shadow draw/tri cost of the system. */
    measure() {
      const { renderer, scene, camera } = window.__QA_AUDIT;
      mgr.setVisible(false);
      renderer.info.reset();
      renderer.render(scene, camera);
      const offC = renderer.info.render.calls;
      const offT = renderer.info.render.triangles;
      mgr.setVisible(true);
      renderer.info.reset();
      renderer.render(scene, camera);
      const onC = renderer.info.render.calls;
      const onT = renderer.info.render.triangles;
      return {
        off: { calls: offC, tris: offT },
        on: { calls: onC, tris: onT },
        deltaCalls: onC - offC,
        deltaTris: onT - offT,
        live: mgr.count,
      };
    },
  };

  const handle = {
    manager: mgr,
    /** Caller-owned movement demo + the manager's pose pass (dt 0 = anchor). */
    fixedUpdate(dt, anchorZ) {
      t += dt;
      const recs = mgr.records;
      for (let i = 0; i < recs.length; i++) {
        const z = recs[i];
        if (!z.alive) {
          spawnOne(i, anchorZ);
          continue;
        }
        if (z.stageMode === "cross") {
          z.z -= S.crossSpeed * dt;
          const w = t * S.crossSwayHz * TAU + z.stagePhase;
          z.x = z.stageLane + Math.sin(w) * S.crossAmp;
          z.ry = Math.PI + Math.cos(w) * S.crossAmp * S.crossSwayHz * TAU * 0.15;
        } else {
          z.z -= z.speed * dt;
        }
        if (z.z < anchorZ - S.respawnBehind) {
          mgr.release(z);
          spawnOne(i, anchorZ);
        }
      }
      mgr.fixedUpdate(dt);
    },
  };
  live.set("zombies", handle);
  return handle;
}

/** Task-3.2 obstacle fixture: a fresh manager + one band of the three
 *  archetypes (convey with fixedUpdate(dt, anchorZ) before measuring). */
export function stageObstacles() {
  if (live.has("obstacles")) return live.get("obstacles");
  const mgr = createObstacleManager(scene(), materialLibrary);
  const staged = [];
  for (const spec of O_STAGE.band) {
    const rec = mgr.spawn(spec);
    if (rec) {
      rec.stageZ = spec.z; // anchor-relative offset (conveyor)
      staged.push(rec);
    }
  }

  window.__QA_OBSTACLES = {
    max: mgr.max,
    count: () => mgr.count,
    records: mgr.records,
    meshes: mgr.meshes,
    cfg: CONFIG.OBSTACLES, // probe reads playerHalfW/playerHalfD (no duplication)
    playerProfile: CONFIG.PLAYER.profile, // the single profile-heights source (4.4 fold)
    /** Hide/show the three archetype meshes (exact added-draw A/B). */
    show(on) {
      mgr.setVisible(on);
    },
    /** Collision truth for a mock player profile (probe's table driver). */
    collide(p) {
      return mgr.collide(p);
    },
    /** Band query passthrough (director-contract check). */
    occupied(z0, z1, lane) {
      return mgr.occupied(z0, z1, lane);
    },
    /** Spawn/release churn entry points for the allocation probe. */
    spawn(spec) {
      return mgr.spawn(spec);
    },
    release(rec) {
      mgr.release(rec);
    },
    /** Drive n fixed steps synchronously (blink + collide + flush — the
     *  whole per-frame surface — for the heap allocation micro-probe). */
    run(n) {
      const p = {
        x: 0,
        z: staged.length ? staged[0].z : 0,
        y0: 0,
        y1: CONFIG.PLAYER.profile.standTop,
      };
      for (let i = 0; i < n; i++) {
        mgr.fixedUpdate(1 / 60);
        mgr.collide(p);
        mgr.flush();
      }
    },
    /** One page, two direct scene renders: obstacles hidden vs shown.
     *  Returns the exact added main+shadow draw/tri cost of the system. */
    measure() {
      const { renderer, scene, camera } = window.__QA_AUDIT;
      mgr.setVisible(false);
      renderer.info.reset();
      renderer.render(scene, camera);
      const offC = renderer.info.render.calls;
      const offT = renderer.info.render.triangles;
      mgr.setVisible(true);
      renderer.info.reset();
      renderer.render(scene, camera);
      const onC = renderer.info.render.calls;
      const onT = renderer.info.render.triangles;
      return {
        off: { calls: offC, tris: offT },
        on: { calls: onC, tris: onT },
        deltaCalls: onC - offC,
        deltaTris: onT - offT,
        live: mgr.count,
      };
    },
  };

  const handle = {
    manager: mgr,
    /** Convey the band ahead of the anchor, then the manager's tick. */
    fixedUpdate(dt, anchorZ) {
      for (let i = 0; i < staged.length; i++) staged[i].z = anchorZ + staged[i].stageZ;
      mgr.flush();
      mgr.fixedUpdate(dt);
    },
  };
  live.set("obstacles", handle);
  return handle;
}

/** Task-3.3 pickup + particle fixture: a fresh manager + system and the
 *  staged strands (convey with fixedUpdate(dt, anchorZ) before measuring). */
export function stagePickups() {
  if (live.has("pickups")) return live.get("pickups");
  const mgr = createPickupManager(scene(), materialLibrary);
  const fx = createParticleSystem(scene(), materialLibrary);
  const S = P_STAGE;
  const staged = [];
  for (const spec of S.strand) {
    const rec = mgr.spawn(spec);
    if (rec) {
      rec.stageZ = spec.z; // anchor-relative offset (conveyor)
      staged.push(rec);
    }
  }
  let t = 0;
  let nextBurst = 0.6;
  let ambientOff = false;
  let flashed = false;

  window.__QA_PICKUPS = {
    max: mgr.max,
    count: () => mgr.count,
    records: mgr.records,
    mesh: mgr.mesh,
    material: mgr.material,
    cfg: CONFIG.PICKUPS, // probe reads collect windows (no duplication)
    particles: {
      live: () => fx.live,
      capacity: fx.max,
      object: fx.points,
      burst: (x, y, z, type) => fx.burst(x, y, z, type),
      /** Drive n particle steps synchronously (decay + heap probes). */
      run: (n) => {
        for (let i = 0; i < n; i++) fx.update(1 / 60);
      },
    },
    /** Hide/show the crate mesh + points (exact added-draw A/B). */
    show(on) {
      mgr.setVisible(on);
      fx.setVisible(on);
    },
    /** Spawn/release/collect passthroughs (probe's contract driver). */
    spawn(spec) {
      return mgr.spawn(spec);
    },
    release(rec) {
      mgr.release(rec);
    },
    tryCollect(p) {
      return mgr.tryCollect(p);
    },
    /** Stop/start the ambient burst cadence (quiet window for the probe). */
    quiet(on) {
      ambientOff = !!on;
    },
    /** Drive n fixed steps synchronously — the whole per-frame surface
     *  (pulse + miss scans + particle decay) for the heap micro-probe. */
    run(n) {
      const miss = { x: 0, z: 1e9 };
      for (let i = 0; i < n; i++) {
        mgr.fixedUpdate(1 / 60);
        mgr.tryCollect(miss);
        fx.update(1 / 60);
      }
    },
    /** One page, two direct scene renders: system hidden vs shown. Returns
     *  the exact added main-pass draw/tri cost (nothing casts shadows). */
    measure() {
      const { renderer, scene, camera } = window.__QA_AUDIT;
      mgr.setVisible(false);
      fx.setVisible(false);
      renderer.info.reset();
      renderer.render(scene, camera);
      const offC = renderer.info.render.calls;
      const offT = renderer.info.render.triangles;
      mgr.setVisible(true);
      fx.setVisible(true);
      renderer.info.reset();
      renderer.render(scene, camera);
      const onC = renderer.info.render.calls;
      const onT = renderer.info.render.triangles;
      return {
        off: { calls: offC, tris: offT },
        on: { calls: onC, tris: onT },
        deltaCalls: onC - offC,
        deltaTris: onT - offT,
        live: mgr.count,
        points: fx.live,
      };
    },
  };

  const handle = {
    manager: mgr,
    particles: fx,
    /** Convey the strands, tick the pulse, ambient bursts, integrate. */
    fixedUpdate(dt, anchorZ) {
      t += dt;
      for (let i = 0; i < staged.length; i++) staged[i].z = anchorZ + staged[i].stageZ;
      mgr.flush();
      mgr.fixedUpdate(dt);
      if (!ambientOff && t >= nextBurst) {
        nextBurst = t + S.burstEvery;
        const rec = staged[Math.floor(t / S.burstEvery) % staged.length];
        fx.burst(rec.x, 0.35, rec.z, "pickup");
      }
      fx.update(dt);
    },
    /** Burst pair ahead of the anchor, frozen at full fade (capture use). */
    readyFlash(anchorZ) {
      if (flashed) return;
      flashed = true;
      const F = S.flash;
      fx.burst(F.pickup.lane * CONFIG.LANE_W, 0.35, anchorZ + F.pickup.z, "pickup");
      fx.burst(F.death.lane * CONFIG.LANE_W, 0.4, anchorZ + F.death.z, "death");
      fx.update(0);
    },
  };
  live.set("pickups", handle);
  return handle;
}
