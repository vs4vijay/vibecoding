/**
 * @file qa/player_stage.js — QA fixture for the player (task-3.4 staging;
 * since task 4.3 the PROBES install it in-page over __QA_AUDIT.scene —
 * main.js no longer constructs or ticks it; the live game runs the real
 * RUN mode's own player). Lives beside qa/hooks.js — runtime QA-gated code
 * outside the js/ byte budget (the 3.4 report documents the split; the
 * 3.1-3.3 stages moved to qa/entity_stage.js in 4.3). Drives the player
 * exactly like the mode will: a caller-owned z conveyor, a fixed cadence,
 * and an autopilot action loop. `&qaact=jump|slide|left|right|dead` pins one
 * action and freezes the player mid-action (hold thresholds below) so
 * captures hold a deterministic pose — drive the pinning from the probe
 * (nothing ticks this stage in rAF anymore). window.__QA_PLAYER serves
 * .qa/player_probe.mjs. Never construct on play paths.
 */
import { CONFIG } from "./../js/core/config.js";
import { createPlayer } from "./../js/entities/player.js";

// Staging constants (QA-only — deliberately NOT gameplay CONFIG; 3.4 report).
const STAGE = {
  zAhead: 7, // player conveyor offset ahead of the dolly (m)
  speed: 7.5, // cadence input (m/s — CRUISE.run)
  every: 1.3, // s between autopilot actions
  actions: ["left", "right", "jump", "slide"],
  // qaact hold thresholds: jump = just past the apex (vy m/s), slide/dead =
  // pose weight settled, lanes = half a lane ease done.
  freezeAt: { jump: 0.3, slide: 0.95, dead: 0.95, laneT: 0.5 },
};

/**
 * @param {THREE.Scene} scene
 * @param {import("./../js/core/assets.js").materialLibrary} lib
 */
export function createPlayerStage(scene, lib) {
  const player = createPlayer(scene, lib);
  const pin = new URLSearchParams(window.location.search).get("qaact");
  let anchor = 20;
  let t = 0;
  let next = 1.1;
  let ai = 0;
  let fired = false;
  let frozen = false;
  let autoOn = true;

  function fire(a) {
    if (a === "left") player.requestLeft();
    else if (a === "right") player.requestRight();
    else if (a === "jump") player.requestJump();
    else if (a === "slide") player.requestSlide();
    else if (a === "dead") player.die();
  }

  function holdReady() {
    const F = STAGE.freezeAt;
    if (pin === "jump") return player.state === "jump" && player.vy <= F.jump;
    if (pin === "slide") return player.state === "slide" && player.w.slide >= F.slide;
    if (pin === "dead") return player.w.dead >= F.dead;
    if (pin === "left" || pin === "right") {
      return player.laneT >= F.laneT && player.laneT < 1; // hold mid-ease
    }
    return false;
  }

  function step(dt) {
    if (!frozen) {
      t += dt;
      if (pin) {
        if (!fired && player.state === "run") { fired = true; fire(pin); }
        if (fired && holdReady()) frozen = true;
      } else if (autoOn && t >= next) {
        next = t + STAGE.every;
        fire(STAGE.actions[ai++ % STAGE.actions.length]);
      }
    }
    player.z = anchor + STAGE.zAhead;
    player.fixedUpdate(frozen ? 0 : dt, STAGE.speed);
  }

  window.__QA_PLAYER = {
    player,
    cfg: CONFIG.PLAYER, // probe reads tunables (no config duplication)
    stage: STAGE,
    /** Quiet the capture autopilot (probe drives requests itself). */
    auto(on) { autoOn = !!on; },
    /** n synchronous fixed+render steps (the whole hot path — heap probe). */
    run(n) {
      for (let i = 0; i < n; i++) {
        player.fixedUpdate(1 / 60, STAGE.speed);
        player.updateRender(0.5);
      }
    },
    /** updateRender(alpha), then report the interpolated root/hip pose. */
    sample(alpha) {
      player.updateRender(alpha);
      return {
        x: player.group.position.x,
        y: player.group.position.y,
        z: player.group.position.z,
        lean: player.group.rotation.z,
        hip: player.hips.position.y,
      };
    },
    /** One page, two direct renders: root hidden vs shown — the exact added
     *  draw/tri cost of the character (main + shadow passes together). */
    measure() {
      const { renderer, scene, camera } = window.__QA_AUDIT;
      player.group.visible = false;
      renderer.info.reset();
      renderer.render(scene, camera);
      const offC = renderer.info.render.calls;
      const offT = renderer.info.render.triangles;
      player.group.visible = true;
      renderer.info.reset();
      renderer.render(scene, camera);
      const onC = renderer.info.render.calls;
      const onT = renderer.info.render.triangles;
      return {
        off: { calls: offC, tris: offT },
        on: { calls: onC, tris: onT },
        deltaCalls: onC - offC,
        deltaTris: onT - offT,
      };
    },
    /** Shadow-pass A/B: every mesh's castShadow off vs on, all visible. */
    measureShadow() {
      const { renderer, scene, camera } = window.__QA_AUDIT;
      const set = (on) => player.group.traverse((o) => { if (o.isMesh) o.castShadow = on; });
      set(false);
      renderer.info.reset();
      renderer.render(scene, camera);
      const off = renderer.info.render.calls;
      set(true);
      renderer.info.reset();
      renderer.render(scene, camera);
      const on = renderer.info.render.calls;
      return { mainOnly: off, withShadow: on, shadowDelta: on - off };
    },
  };

  return {
    player,
    fixedUpdate(dt, dollyZ) {
      anchor = dollyZ;
      step(dt);
    },
    update(alpha) {
      player.updateRender(alpha);
    },
  };
}
