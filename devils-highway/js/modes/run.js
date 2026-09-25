/**
 * @file modes/run.js — the RUN mode (run-core-loop task 4.3): on-foot runner
 * on the shared highway. Implements the Mode contract against the 3.x entity
 * systems + 4.2 director:
 *
 *   enter(ctx)   ctx = { scene, world, input, audio, save, hud, seed,
 *                        staged, startZ, endRun } (main.js builds it).
 *                world.setGameplay(true) FIRST (4.1: before the first
 *                world.update with our focus), then constructs/attaches the
 *                pooled systems (built once per session, re-added per enter —
 *                no GPU churn across retry cycles), re-baselines the run.
 *   exit()       releases everything (director reset + manager resets),
 *                world.setGameplay(false), strips scene objects so the menu
 *                attract carries zero gameplay draws.
 *   restart(z)   fresh run without an exit/enter round-trip (retry, pause
 *                RESTART, menu select) — the pooled path: world.reset()'s
 *                inactive burst already released the chunk manifests; this
 *                re-baselines focus and clears every pool + the ledger.
 *   fixedUpdate  THE sim step (60 Hz, main.js GAME-only): stepwise speed ramp
 *                (CONFIG.RUN) -> focus advance (focus IS player z; main.js
 *                reads .focus and feeds world.update + the camera dolly) ->
 *                player.fixedUpdate(dt, speed) -> director.fixedUpdate(dt,
 *                focus) (zombie approach + manager passes) -> fx -> pickup
 *                collect (score.onPickup + burst) -> death checks. 5.2 adds
 *                audio side-effects ONLY (never state inputs): whoosh/jump/
 *                swish on ACCEPTED player transitions, pickup blip at
 *                collect, death sting at the impact; shell/UI confirms live
 *                in main.js (the documented 5.2 split).
 *   update       player.updateRender(alpha) (bible rule 5) + the 5.1 HUD
 *                push (score.snapshot() -> ctx.hud when present); entities
 *                ride the fixed-step matrices.
 *   cameraRig()  CONFIG.RIGS.run with the lane term riding the player
 *                (RUN.camFollowX) so edge lanes keep the runner in frame;
 *                main.js lerps toward it on the exact menu-dolly path.
 *   hudLayout()  placement contract for 5.1's HUD (root class "hud-run";
 *                main.js mounts the DOM HUD under it on activation).
 *   stagedScenarios() "gauntlet" QA staging (6.1/6.2): a conveyed tableau —
 *                obstacle band + chasing pack + pickup strand held at fixed
 *                offsets ahead of the focus every fixed step — plus a scripted
 *                autopilot (pose variety) and a ready-flip flash pair so
 *                freeze=1 captures hold both burst types. Deterministic
 *                framing regardless of warm-frame timing (the 4.2 lesson).
 *                Staged runs skip the death check (QA-only exception) so a
 *                long drain window can never end the capture.
 *
 * Death paths (spec): solid obstacle hit (obstacles.collide on the LIVE
 * profile) or zombie contact (radial vs profile x/z, feet below RUN.evadeY —
 * jumping evades, landing does not) -> player.die() + death burst -> a short
 * live-world settle (RUN.deathSettleS: the crumple eases in while the world
 * still ticks) -> shell endRun(score.snapshot()). Fires exactly once.
 *
 * QA (?qa=1 only, wired by main.js): window.__QA_RUN = systems() — the live
 * player/managers/ledger/director + step(dt) (one full mode step, for heap
 * and E2E probes). Replaces 4.2's __QA_SPAWN preview surface.
 */
import { CONFIG } from "../core/config.js";
import { materialLibrary } from "../core/assets.js";
import { createPlayer } from "../entities/player.js";
import { createZombieManager } from "../entities/zombies.js";
import { createObstacleManager } from "../entities/obstacles.js";
import { createPickupManager } from "../entities/pickups.js";
import { createParticleSystem } from "../entities/particles.js";
import { createScore } from "../game/score.js";
import { createSpawnDirector } from "../game/director.js";

/** Gauntlet staging spec (stagedScenarios() returns this verbatim). */
const STAGED = {
  gauntlet: {
    // Camera glide menu-rig -> run-rig before the ready freeze (freeze=1
    // would otherwise hold the lerp mid-flight — the documented 3.4 class).
    settleS: 2.6,
    // Autopilot cadence: one action per slot, looped. Conveyed hazards never
    // arrive, so these are pure pose variety for the hero still.
    auto: { first: 0.9, every: 1.7, actions: ["jump", "left", "slide", "right"] },
    // Conveyed tableau: re-anchored at focus + z each fixed step. Offsets
    // keep everything in chunks 1-2 (director-grace at the default start),
    // so the tableau is the hero and director spawns stay background depth.
    convey: [
      { kind: "obstacle", type: "low", lane: 0, z: 22 },
      { kind: "zombie", lane: 0, z: 30, pose: "run", speed: 2.8 },
      { kind: "zombie", lane: 0, z: 33, pose: "run", speed: 2.6 },
      { kind: "zombie", lane: 1, z: 37, pose: "lunge", speed: 3.1 },
      { kind: "pickup", lane: -1, z: 40 },
      { kind: "pickup", lane: -1, z: 42.2 },
      { kind: "pickup", lane: -1, z: 44.4 },
      { kind: "pickup", lane: -1, z: 46.6 },
      { kind: "pickup", lane: -1, z: 48.8 },
      { kind: "obstacle", type: "gantry", lane: 0, z: 56 },
      { kind: "obstacle", type: "block", lane: 1, z: 63 },
    ],
    // Ready-flip burst pair (3.3 pattern): freeze=1 holds both burst types
    // at full fade in frame.
    flash: { pickup: { lane: 0, z: 6 }, death: { lane: 1, z: 9.5 } },
  },
};

const HUD_LAYOUT = { root: "hud-run" }; // 5.1 mounts the DOM HUD under this class

/**
 * @returns {Mode} the RUN mode (one instance per session, main.js-owned).
 */
export function createRunMode() {
  const R = CONFIG.RUN;
  const FX = CONFIG.PARTICLES.types; // burst origin heights (pickup y / death y)
  const contactR2 = R.contactR * R.contactR;
  const rig = { ...CONFIG.RIGS.run }; // live rig scratch (lane-follow below)

  let ctx = null;
  let sceneRef = null;
  let built = false;
  let entered = false;
  let player = null;
  let zombies = null;
  let obstacles = null;
  let pickups = null;
  let fx = null;
  let score = null;
  let director = null;

  let focus = 0; // mode-owned focus z (== player z; main.js syncs the dolly)
  let baseline = 0; // run-start focus (distance stat)
  let speed = R.speedStart;
  let dying = 0; // death-settle countdown; 0 = alive
  let dead = false;
  let gaunt = null; // staged gauntlet state (null unless staged)

  /** Stepwise ramp: pure function of distance covered (CONFIG.RUN table). */
  function rampSpeed(d) {
    if (d <= 0) return R.speedStart;
    const s = R.speedStart + Math.floor(d / R.stepDist) * R.speedStep;
    return s < R.speedMax ? s : R.speedMax;
  }

  /** Pooled systems are built once per session; enter/exit only attach. */
  function buildOnce(c) {
    if (built) return;
    built = true;
    sceneRef = c.scene;
    const lib = materialLibrary;
    player = createPlayer(c.scene, lib);
    zombies = createZombieManager(c.scene, lib);
    obstacles = createObstacleManager(c.scene, lib);
    pickups = createPickupManager(c.scene, lib);
    fx = createParticleSystem(c.scene, lib);
    score = createScore();
    // Registers the world chunk callbacks exactly once (4.2 contract).
    director = createSpawnDirector({
      world: c.world, seed: c.seed, zombies, obstacles, pickups,
    });
  }

  function addScene() {
    sceneRef.add(player.group);
    sceneRef.add(zombies.meshes.body, zombies.meshes.eyes);
    sceneRef.add(obstacles.meshes.low, obstacles.meshes.gantry, obstacles.meshes.block);
    sceneRef.add(pickups.mesh);
    sceneRef.add(fx.points);
  }

  function removeScene() {
    sceneRef.remove(player.group);
    sceneRef.remove(zombies.meshes.body, zombies.meshes.eyes);
    sceneRef.remove(obstacles.meshes.low, obstacles.meshes.gantry, obstacles.meshes.block);
    sceneRef.remove(pickups.mesh);
    sceneRef.remove(fx.points);
  }

  /** Lay the staged gauntlet (conveyed records carry their offsets). */
  function initStage() {
    gaunt = null;
    if (!ctx || ctx.staged !== "gauntlet") return;
    const G = STAGED.gauntlet;
    gaunt = { obs: [], picks: [], zoms: [], t: 0, next: G.auto.first, ai: 0, flashed: false };
    for (let i = 0; i < G.convey.length; i++) {
      const s = G.convey[i];
      let r = null;
      if (s.kind === "obstacle") {
        r = obstacles.spawn({ type: s.type, lane: s.lane, z: focus + s.z });
        if (r) gaunt.obs.push(r);
      } else if (s.kind === "pickup") {
        r = pickups.spawn({ lane: s.lane, z: focus + s.z });
        if (r) gaunt.picks.push(r);
      } else {
        r = zombies.spawn({
          lane: s.lane, z: focus + s.z, ry: Math.PI,
          pose: s.pose, speed: s.speed,
        });
        if (r) gaunt.zoms.push(r);
      }
      if (r) r.stageZ = s.z;
    }
  }

  /** Fresh run state (enter and every retry/restart). */
  function fresh(startZ) {
    focus = startZ;
    baseline = startZ;
    speed = R.speedStart;
    dying = 0;
    dead = false;
    score.reset();
    player.reset();
    director.reset(); // world.reset() already fired the inactive burst on retry
    zombies.reset();
    obstacles.reset();
    pickups.reset();
    fx.reset();
    player.group.visible = true;
    initStage();
  }

  /** Radial zombie contact vs the live profile (spec: ground level). */
  function zombieContact() {
    const px = player.profile.x;
    const recs = zombies.records;
    for (let i = 0; i < recs.length; i++) {
      const z = recs[i];
      if (!z.alive) continue;
      const dx = z.x - px;
      const dz = z.z - player.profile.z;
      if (dx * dx + dz * dz < contactR2 && player.profile.y0 < R.evadeY) return z;
    }
    return null;
  }

  /** Gauntlet conveyor: hold every staged record at its offset (the manager
   *  matrix passes compose from these in director.fixedUpdate). */
  function stageConvey() {
    const g = gaunt;
    for (let i = 0; i < g.obs.length; i++) g.obs[i].z = focus + g.obs[i].stageZ;
    obstacles.flush();
    for (let i = 0; i < g.picks.length; i++) g.picks[i].z = focus + g.picks[i].stageZ;
    pickups.flush();
    for (let i = 0; i < g.zoms.length; i++) g.zoms[i].z = focus + g.zoms[i].stageZ;
  }

  /** Gauntlet autopilot: cadenced pose actions (STAGED.gauntlet.auto). */
  function stageAutopilot(dt) {
    const A = STAGED.gauntlet.auto;
    gaunt.t += dt;
    if (gaunt.t < gaunt.next) return;
    gaunt.next = gaunt.t + A.every;
    const a = A.actions[gaunt.ai++ % A.actions.length];
    if (a === "jump") player.requestJump();
    else if (a === "slide") player.requestSlide();
    else if (a === "left") player.requestLeft();
    else player.requestRight();
  }

  function fixedUpdate(dt) {
    if (!entered || dead) return;
    score.distance = focus - baseline;
    if (dying > 0) {
      // Death settle: the world stays live (manager passes animate the
      // pack; particles fade) while the crumple eases in, then ONE endRun.
      dying -= dt;
      player.z = focus;
      player.fixedUpdate(dt, 0);
      director.fixedUpdate(dt, focus);
      fx.update(dt);
      if (dying <= 0) {
        dead = true;
        ctx.endRun(score.snapshot());
      }
      return;
    }
    focus += rampSpeed(focus - baseline) * dt;
    if (gaunt) stageConvey(); // records ride the fresh focus into the passes
    player.z = focus;
    // 5.2 audio side-effects on ACCEPTED transitions only: the player
    // latches requests (mid-air/edge no-ops), so voices read the live
    // state change, never the raw action. Observer, not state input.
    const st0 = player.state;
    const lane0 = player.lane;
    player.fixedUpdate(dt, speed);
    if (player.lane !== lane0) ctx.audio.whoosh();
    else if (player.state === "jump" && st0 !== "jump") ctx.audio.jump();
    else if (player.state === "slide" && st0 !== "slide") ctx.audio.swish();
    director.fixedUpdate(dt, focus);
    fx.update(dt);
    if (gaunt) stageAutopilot(dt);
    score.distance = focus - baseline;
    const pick = pickups.tryCollect(player.profile);
    if (pick) {
      score.onPickup(1);
      fx.burst(pick.x, FX.pickup.y, pick.z, "pickup");
      if (ctx.audio) ctx.audio.pickup(); // 5.2 collect blip
    }
    // Death checks (skipped in staged captures — QA-only, see header).
    if (gaunt) return;
    if (obstacles.collide(player.profile) || zombieContact()) {
      player.die();
      fx.burst(player.profile.x, FX.death.y, focus, "death");
      if (ctx.audio) ctx.audio.death(); // 5.2 sting at the impact, not at endRun
      dying = R.deathSettleS;
    }
  }

  return {
    /** Mode contract ----------------------------------------------------- */

    enter(c) {
      ctx = c;
      buildOnce(c);
      addScene();
      c.world.setGameplay(true); // 4.1: BEFORE the first world.update (restream)
      entered = true;
      fresh(c.startZ);
    },

    exit() {
      if (!entered) return;
      entered = false;
      dead = true;
      director.reset();
      zombies.reset();
      obstacles.reset();
      pickups.reset();
      fx.reset();
      removeScene();
      ctx.world.setGameplay(false); // attract dressing restreams (4.1)
      ctx = null;
    },

    fixedUpdate,

    /** Gameplay actions (main.js routing, design 6): the 2.1 action strings. */
    handleAction(action) {
      if (!entered) return;
      // Chase rigs face +z, so screen-right is world −x (right = fwd × up):
      // the actions are screen-space intents and map to the mirrored lane.
      if (action === "left") player.requestRight();
      else if (action === "right") player.requestLeft();
      else if (action === "jump") player.requestJump();
      else if (action === "slide") player.requestSlide();
    },

    update(_dt, alpha) {
      if (!entered) return;
      player.updateRender(alpha);
      // 5.1 HUD push (render tick; main.js calls update() in GAME only and
      // never while frozen/paused, so the numerals hold when the sim does).
      // snapshot() rewrites one reused object — zero allocation.
      if (ctx.hud) ctx.hud.update(score.snapshot());
    },

    /** null until entered — main.js falls back to CONFIG.RIGS[mode|menu]. */
    cameraRig() {
      if (!entered) return null;
      rig.laneX0 = CONFIG.RIGS.run.laneX0 + player.group.position.x * R.camFollowX;
      return rig;
    },

    hudLayout() {
      // 5.1 contract: the HUD mounts under this root class; slots/labels are
      // the HUD's own (distance/score/pickups numerals + touch pause chip).
      return HUD_LAYOUT;
    },

    stagedScenarios() {
      return STAGED;
    },

    /** Mode extensions ---------------------------------------------------- */

    /** Fresh-run reset without exit/enter (retry / pause RESTART). */
    restart(startZ) {
      if (!entered) return;
      fresh(startZ);
    },

    /** QA staging hook (main.js, ready flip): freeze-safe burst pair. */
    onReady(focusZ) {
      if (!gaunt || gaunt.flashed) return;
      gaunt.flashed = true;
      const F = STAGED.gauntlet.flash;
      fx.burst(F.pickup.lane * CONFIG.LANE_W, FX.pickup.y, focusZ + F.pickup.z, "pickup");
      fx.burst(F.death.lane * CONFIG.LANE_W, FX.death.y, focusZ + F.death.z, "death");
      fx.update(0);
    },

    /** Live reads. */
    get focus() {
      return entered ? focus : null;
    },
    get staged() {
      return gaunt ? "gauntlet" : null;
    },

    /** ?qa=1 handle (main.js publishes as window.__QA_RUN). */
    systems() {
      return {
        player,
        zombies,
        obstacles,
        pickups,
        fx,
        score,
        director,
        focus: () => focus,
        speed: () => speed,
        step: fixedUpdate, // one full mode step (heap / E2E probes)
      };
    },
  };
}
