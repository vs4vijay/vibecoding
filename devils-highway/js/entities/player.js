/**
 * @file entities/player.js — the RUN player: the ONE hierarchical character
 * (run-core-loop design 5, task 3.4). Real THREE.Group hierarchy — hips →
 * pelvis + spine → torso/head/2 arms, hips → 2×(thigh→shin) — no instancing,
 * no skinning. 11 meshes / 11 draws: one mesh + library material per
 * articulated body (runnerJacket/Pants/Skin/Boot; rigid details merge into
 * the body's geometry), ~0.3k tris; castShadow = CONFIG.PLAYER.castShadow.
 * Full API contract + semantics: qa/reports/run-core-loop.md Task 3.4.
 * Render interpolation (bible rule 5): animated scalars snapshot prev/cur
 * per fixed step; updateRender(alpha) lerps them into the transforms (the
 * zombie poses skip this — the player is center-frame and must not pop).
 *
 * API (mode 4.3): createPlayer(scene, lib); requestLeft/Right/Jump/Slide()
 * — edge-latched; jump/slide fire ONLY from run (mid-air/sliding = ignored,
 * a slide is never cancelled); lane changes fire in any live state, clamped
 * at the outer lanes (edge request = no-op). The MODE writes player.z each
 * fixed step (focus z IS player z) then fixedUpdate(dt, speed) — speed
 * drives cadence only. profile {x,z,y0,y1,state} (LIVE) feeds
 * obstacles.collide(): run 0..standTop; jump y0 = arc y, y1 = y + jumpTop;
 * slide y1 = slideTop for exactly slideTime (clears the gantry, not the
 * low — 3.2 collide table). updateRender(alpha) every rendered frame;
 * die()/reset(); getters state x lane z vy laneT w; group / hips.
 */
import * as THREE from "three";
import { CONFIG } from "../core/config.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}
function tube(r0, r1, h, x, y, z) {
  return new THREE.CylinderGeometry(r0, r1, h, 6).translate(x, y, z);
}
function ball(r, x, y, z) {
  return new THREE.SphereGeometry(r, 7, 6).translate(x, y, z);
}
// Positions+normals only: the runner materials are untextured (no UV need).
function merge(list) {
  const pos = [], nor = [];
  for (const g of list) {
    const n = g.toNonIndexed();
    pos.push(...n.attributes.position.array);
    nor.push(...n.attributes.normal.array);
    g.dispose();
    n.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

// Rig anatomy (metres; authored constants beside the composer — the zombies
// RIG precedent). Forward is +z (the run direction); standing ~1.8 m.
const RIG = {
  hipY: 0.88, spinePivot: 0.1, shoulder: [0.26, 0.38], hipX: 0.11,
  thighLen: 0.42, elbow: 0.55, // baked forearm bend (rad, hand toward +z)
};

/** One material per articulated body; rigid details merge into its geometry. */
function buildParts() {
  const fArm = tube(0.058, 0.048, 0.26, 0, 0, 0).rotateX(-RIG.elbow)
    .translate(0, -0.3 - Math.cos(RIG.elbow) * 0.13, Math.sin(RIG.elbow) * 0.13);
  return {
    pelvis: box(0.34, 0.2, 0.24, 0, 0, 0),
    torso: merge([
      box(0.4, 0.48, 0.26, 0, 0.24, 0), // jacket shell
      box(0.44, 0.14, 0.3, 0, 0.04, 0), // hem flare
      box(0.3, 0.36, 0.14, 0, 0.26, -0.19), // backpack
    ]),
    head: merge([
      box(0.11, 0.12, 0.12, 0, 0.06, 0), // neck
      ball(0.125, 0, 0.25, 0.01), // skull — rounded like the zombie family; a bare box read as a toy at QA close cam (6.3)
    ]),
    uArm: tube(0.075, 0.06, 0.3, 0, -0.15, 0),
    fArm,
    thigh: tube(0.088, 0.072, RIG.thighLen, 0, -RIG.thighLen / 2, 0),
    shin: merge([
      tube(0.066, 0.05, 0.38, 0, -0.19, 0),
      box(0.11, 0.085, 0.25, 0, -0.4, 0.06), // boot, toes +z
    ]),
  };
}

/**
 * @param {THREE.Scene} scene
 * @param {import("../core/assets.js").materialLibrary} lib
 */
export function createPlayer(scene, lib) {
  const P = CONFIG.PLAYER;
  const mats = {
    jacket: lib.get("runnerJacket"),
    pants: lib.get("runnerPants"),
    skin: lib.get("runnerSkin"),
    boot: lib.get("runnerBoot"),
  };
  const g = buildParts();
  const node = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    if (geo) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = P.castShadow;
      m.receiveShadow = false;
      grp.add(m);
    }
    parent.add(grp);
    return grp;
  };

  const root = new THREE.Group();
  root.name = "player";
  const hips = new THREE.Group();
  root.add(hips);
  node(g.pelvis, mats.pants, hips);
  const spine = node(null, null, hips, 0, RIG.spinePivot, 0);
  node(g.torso, mats.jacket, spine);
  const head = node(g.head, mats.skin, spine, 0, 0.48, 0);
  const armL = node(g.uArm, mats.jacket, spine, RIG.shoulder[0], RIG.shoulder[1], 0);
  const armR = node(g.uArm, mats.jacket, spine, -RIG.shoulder[0], RIG.shoulder[1], 0);
  node(g.fArm, mats.skin, armL);
  node(g.fArm, mats.skin, armR);
  const legL = node(g.thigh, mats.pants, hips, RIG.hipX, -0.06, 0);
  const legR = node(g.thigh, mats.pants, hips, -RIG.hipX, -0.06, 0);
  const shinL = node(g.shin, mats.boot, legL, 0, -RIG.thighLen, 0);
  const shinR = node(g.shin, mats.boot, legR, 0, -RIG.thighLen, 0);
  scene.add(root);

  // Fixed-step pose state; scalars snapshot prev/cur for updateRender.
  // hz starts at the gait band midpoint (the resting cadence).
  const cur = {
    x: 0, y: 0, phase: 0, hz: (P.gaitHz[0] + P.gaitHz[1]) / 2,
    lean: 0, slide: 0, tuck: 0, dead: 0,
  };
  const prev = { ...cur };
  let state = "run";
  let lane = 0, laneFrom = 0, laneT = 1, laneDir = 1;
  let vy = 0, slideT = 0;
  let z = 0, prevZ = 0;
  const req = { left: false, right: false, jump: false, slide: false };
  const profile = { x: 0, z: 0, y0: 0, y1: P.profile.standTop, state };

  const gaitHz = (speed) => speed > 0
    ? clamp(speed / P.stride, P.gaitHz[0], P.gaitHz[1])
    : (P.gaitHz[0] + P.gaitHz[1]) / 2;

  function startLane(d) {
    const nl = clamp(lane + d, -1, 1);
    if (nl === lane) return; // clamped at the outer lanes: no-op
    laneFrom = cur.x; // re-targets mid-ease from the current body position
    lane = nl;
    laneDir = d;
    laneT = 0;
  }

  /** One fixed step; dt 0 (frozen warmup) rewrites the same frame. */
  function fixedUpdate(dt, speed = 0) {
    for (const k in cur) prev[k] = cur[k];
    prevZ = z;
    const ease = 1 - Math.exp(-dt * P.poseEase);
    if (req.left) { req.left = false; if (state !== "dead") startLane(-1); }
    if (req.right) { req.right = false; if (state !== "dead") startLane(1); }
    if (req.jump) { req.jump = false; if (state === "run") { state = "jump"; vy = P.jump.v0; } }
    if (req.slide) { req.slide = false; if (state === "run") { state = "slide"; slideT = P.slideTime; } }
    if (laneT < 1) {
      laneT = Math.min(1, laneT + dt / P.laneChangeTime);
      cur.x = lerp(laneFrom, lane * CONFIG.LANE_W, smooth(laneT));
    }
    cur.lean += ((laneT < 1 ? -laneDir * P.laneLean : 0) - cur.lean) * ease;
    if (state === "jump") { // parabolic arc; land snaps back to the run cycle
      vy -= P.jump.gravity * dt;
      cur.y += vy * dt;
      if (cur.y <= 0) { cur.y = 0; vy = 0; state = "run"; }
    } else if (state === "slide") {
      slideT -= dt;
      if (slideT <= 0) { slideT = 0; state = "run"; }
    } else if (state === "dead") {
      cur.y += -cur.y * ease;
    }
    if (state === "run") { // cadence frozen while an action pose owns the limbs
      cur.hz += (gaitHz(speed) - cur.hz) * ease;
      cur.phase = (cur.phase + TAU * cur.hz * dt) % TAU;
    }
    cur.tuck += ((state === "jump" ? 1 : 0) - cur.tuck) * ease;
    cur.slide += ((state === "slide" ? 1 : 0) - cur.slide) * ease;
    cur.dead += ((state === "dead" ? 1 : 0) - cur.dead) * ease;
    profile.x = cur.x;
    profile.z = z;
    profile.y0 = state === "jump" ? cur.y : 0;
    profile.y1 = state === "slide" ? P.profile.slideTop
      : state === "jump" ? cur.y + P.profile.jumpTop : P.profile.standTop;
    profile.state = state;
  }

  /** Render-side interpolation (any alpha; allocation-free). */
  function updateRender(alpha) {
    const T = P.pose;
    const dd = cur.phase - prev.phase;
    const ph = prev.phase + (dd < -Math.PI ? dd + TAU : dd > Math.PI ? dd - TAU : dd) * alpha;
    const sw = lerp(prev.slide, cur.slide, alpha);
    const tw = lerp(prev.tuck, cur.tuck, alpha);
    const dw = lerp(prev.dead, cur.dead, alpha);
    const rw = Math.max(0, 1 - sw - tw - dw);
    const sn = Math.sin(ph);
    root.position.set(lerp(prev.x, cur.x, alpha), lerp(prev.y, cur.y, alpha), lerp(prevZ, z, alpha));
    root.rotation.z = lerp(prev.lean, cur.lean, alpha);
    hips.position.y = RIG.hipY + T.bob * (0.5 - 0.5 * Math.cos(ph * 2)) * rw
      + T.tuck.hip * tw - (RIG.hipY - T.slide.hip) * sw - (RIG.hipY - T.dead.hip) * dw;
    const pitch = T.leanFwd * rw + T.tuck.lean * tw + T.slide.lean * sw + T.dead.lean * dw;
    spine.rotation.x = pitch;
    spine.rotation.z = sn * T.sway * rw;
    head.rotation.x = -pitch * T.headCounter;
    for (let s = 0; s < 2; s++) {
      const o = s * Math.PI;
      const leg = s ? legR : legL;
      const shin = s ? shinR : shinL;
      const arm = s ? armR : armL;
      leg.rotation.x = -Math.sin(ph + o) * T.legAmp * rw
        + (T.tuck.leg + (s ? -0.12 : 0.12)) * tw + T.slide.leg * sw + (s ? -0.25 : 0.35) * dw;
      shin.rotation.x = (T.kneeBase + T.kneeAmp * Math.max(0, Math.sin(ph + o + 2.8))) * rw
        + T.tuck.knee * tw + T.slide.knee * sw + 0.4 * dw;
      arm.rotation.x = (Math.sin(ph + o) * T.armAmp - T.armFwd) * rw
        + T.tuck.arm * tw + T.slide.arm * sw + 0.4 * dw;
      const spl = 0.1 * rw + 0.9 * dw; // dead arms fling out
      arm.rotation.z = s ? -spl : spl;
    }
  }

  function die() {
    if (state !== "dead") state = "dead";
  }

  function reset() {
    state = "run";
    lane = 0; laneFrom = 0; laneT = 1; laneDir = 1;
    vy = 0; slideT = 0; z = 0; prevZ = 0;
    for (const k in req) req[k] = false;
    for (const k in cur) { cur[k] = 0; prev[k] = 0; }
    cur.hz = prev.hz = gaitHz(0);
    fixedUpdate(0, 0);
    updateRender(1);
  }

  return {
    group: root,
    hips,
    profile, // LIVE — read after fixedUpdate, pass straight to collide()
    requestLeft() { req.left = true; },
    requestRight() { req.right = true; },
    requestJump() { req.jump = true; },
    requestSlide() { req.slide = true; },
    fixedUpdate,
    updateRender,
    die,
    reset,
    get state() { return state; },
    get x() { return cur.x; },
    get lane() { return lane; },
    get z() { return z; },
    set z(v) { z = v; },
    get vy() { return vy; },
    get laneT() { return laneT; },
    get w() { return cur; }, // live pose weights (QA read; incl. phase/hz)
  };
}
