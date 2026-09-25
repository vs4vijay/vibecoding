/**
 * @file entities/zombies.js — pooled instanced gameplay zombie manager
 * (run-core-loop design 5, task 3.1). ONE InstancedMesh poses every live
 * zombie's 14 body parts as per-part instances of a single unit sphere —
 * limb swing via instance matrix composition, no skinning rig, no per-frame
 * allocation (module-scope scratch quaternions/vectors, Matrix4.compose into
 * instanceMatrix) — and a second InstancedMesh carries the emissive eye
 * chips (2 per zombie, eyeshine clone of the shared `reflector` amber).
 * 2 added draw calls total; <= CONFIG.ZOMBIES.max live figures. Materials
 * are the shared library's `shambler` (sickly olive; per-part instanceColor
 * = skin/clothing tone groups x per-zombie variance — instanceColor only
 * scales diffuse in r172, which is exactly the variance channel wanted
 * here) and the eye clone (uniform-only, so no new shader program).
 *
 * API contract (spawn director 4.2 / mode 4.3 consume this):
 *   const mgr = createZombieManager(scene, lib); // once per session
 *   const z = mgr.spawn(spec);  // -> live record to mutate, or null (full)
 *     spec { x | lane (-1|0|1), y, z, ry, pose: "shamble"|"run"|"lunge",
 *            speed (m/s, informational + default gait), gaitHz (override),
 *            scale, tint (0-1 variance stream), phase (0-TAU) }
 *   Movement is CALLER-OWNED: each fixed step write z.x / z.y / z.z / z.ry
 *   (plain fields on the record), optionally z.pose / z.gaitHz / z.scale,
 *   then call mgr.fixedUpdate(dt) AFTER movement. The manager never moves a
 *   zombie — it eases pose parameters, advances the gait phase and rewrites
 *   the instance matrices around whatever the caller wrote. z.speed is
 *   stored for the caller's convenience only.
 *   mgr.release(z)   // recycle one (its record is reused by later spawns)
 *   mgr.reset()      // release all (pooled; no allocation)
 *   mgr.count / mgr.max / mgr.records  // live count, capacity, record array
 *   mgr.gaitHzFor(speed, pose, id)     // m/s -> gait cycles/s (stride)
 *   mgr.setVisible(on)                 // QA draw A/B; fixedUpdate re-shows
 * Determinism: the manager consumes NO rng — per-zombie phase/tint derive
 * from the pool slot (golden-ratio streams) unless the spec overrides them,
 * so the director's seeded streams alone decide placement (bible rule 7).
 * Rig anatomy (RIG below) sits beside the composer that poses it — the
 * chunks.js shambler precedent; every gait/behaviour number is
 * CONFIG.ZOMBIES.
 */
import * as THREE from "three";
import { CONFIG } from "../core/config.js";

// Module-scope scratch (bible hot-path rule: nothing allocates per frame).
const _m = new THREE.Matrix4();
const _dead = new THREE.Matrix4().makeScale(0, 0, 0); // parked instance slots
const _e = new THREE.Euler();
const _qr = new THREE.Quaternion(); // root: yaw + sway roll
const _qt = new THREE.Quaternion(); // torso: hunch
const _qh = new THREE.Quaternion(); // head
const _q1 = new THREE.Quaternion(); // per-part world orientation (composed)
const _q2 = new THREE.Quaternion(); // joint temps
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const _q5 = new THREE.Quaternion();
const _va = new THREE.Vector3(); // root world position (per zombie per step)
const _vb = new THREE.Vector3(); // part centres on their way into compose
const _vc = new THREE.Vector3(); // joint pivots (root frame)
const _vd = new THREE.Vector3(); // _off() target: rotated joint offsets
const _ve = new THREE.Vector3(); // head/eye staging
const _s = new THREE.Vector3();
const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);

// Rig anatomy (metres; authored constants — see the file header). Forward is
// local +z; ry = PI faces down-road at the player camera. ~1.75 m standing,
// hips soft-flexed so the shamble reads dead-weighted.
const RIG = {
  hipY: 0.88, // pelvis centre above the ground plane
  torsoPivot: 0.1, // pelvis top -> torso joint
  pelvis: [0.36, 0.2, 0.24],
  torso: [0.42, 0.52, 0.28],
  head: [0.24, 0.26, 0.25],
  shoulder: [0.25, 0.44], // x half-offset, height above the torso pivot
  upperArm: [0.12, 0.34, 0.13],
  forearm: [0.1, 0.32, 0.11],
  hipX: 0.12,
  thigh: [0.17, 0.4, 0.18],
  shin: [0.13, 0.38, 0.14],
  foot: [0.13, 0.1, 0.3],
  neck: [0.12, 0.16, 0.12], // fills the hunch gap between torso top and skull
  eye: [0.066, 0.034, 0.02], // eyeshine chips on the head's +z face
  // Chip centers sit ~1.5 cm PROUD of the skull ellipsoid (surface z at
  // this xy is ~0.1): a flat chip tangent to the curved skull z-fights
  // into invisibility — half the chip depth must stay outside.
  eyeLocal: [0.062, 0.026, 0.105],
};
const PARTS_PER = 14; // pelvis, torso, head, neck, 2x(upper arm, forearm, thigh, shin, foot)

// Per-part tone group -> CONFIG.ZOMBIES.tones key (shirt covers torso and
// sleeves, pants the legs, boots the feet; skin the head/neck/forearms).
const TONES = ["pants", "shirt", "skin", "skin", "shirt", "shirt", "skin",
  "skin", "pants", "pants", "pants", "pants", "boot", "boot"];
const POSE_KEYS = ["shamble", "run", "lunge"];

/**
 * @param {THREE.Scene} scene
 * @param {import("../core/assets.js").materialLibrary} lib
 */
export function createZombieManager(scene, lib) {
  const Z = CONFIG.ZOMBIES;
  const max = Z.max;
  // One unit sphere serves every body part via instance scale — smooth
  // ellipsoid limbs/torso/head keep the figure stylized-organic (the
  // dressing shambler's sphere-head language) instead of blocky: 80 tris x
  // 14 parts = 1120 tris per figure on screen. RADIUS 0.5 (spans +-0.5 —
  // the BoxGeometry convention) so RIG dims are full sizes. Eye chips stay
  // flat boxes (a 12-tri chip half-sunk into the skull sphere reads as a
  // glowing lens).
  const ball = new THREE.SphereGeometry(0.5, 8, 6);
  const chip = new THREE.BoxGeometry(1, 1, 1);

  const body = new THREE.InstancedMesh(ball, lib.get("shambler"), max * PARTS_PER);
  body.name = "zombieBodies";
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * PARTS_PER * 3), 3);
  body.castShadow = Z.castShadow; // false holds the +2 gate: renderer.info counts shadow-pass draws
  body.receiveShadow = false;
  body.frustumCulled = false; // instances move with caller positions
  body.count = 0;
  body.visible = false;

  // Eyeshine: the reflector read pushed into a threat signal — a parameter
  // clone (uniform-only change, same compiled program) whose intensity rides
  // whatever chunks.js baked for the time of day, x CONFIG.ZOMBIES.eyeGlow.
  const eyeMat = lib.get("reflector").clone();
  eyeMat.name = "zombieEyes";
  eyeMat.emissiveIntensity = lib.get("reflector").emissiveIntensity * Z.eyeGlow;

  const eyes = new THREE.InstancedMesh(chip, eyeMat, max * 2);
  eyes.name = "zombieEyes";
  eyes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  eyes.castShadow = false;
  eyes.receiveShadow = false;
  eyes.frustumCulled = false;
  eyes.count = 0;
  eyes.visible = false;

  for (let i = 0; i < max * PARTS_PER; i++) body.setMatrixAt(i, _dead);
  for (let i = 0; i < max * 2; i++) eyes.setMatrixAt(i, _dead);
  scene.add(body, eyes);

  const pool = new Array(max);
  for (let i = 0; i < max; i++) {
    pool[i] = {
      alive: false,
      id: i,
      // caller-owned placement / intent (see contract above)
      x: 0, y: 0, z: 0, ry: Math.PI, speed: 0, scale: 1,
      pose: "shamble", gaitHz: 1, phase: 0,
      // eased pose state (blended toward CONFIG.ZOMBIES.poses[z.pose])
      _hz: 1, _leg: 0, _knee: 0, _arm: 0, _reach: 0, _splay: 0,
      _elbow: 0, _hunch: 0, _drop: 0, _bob: 0, _roll: 0, _head: 0,
      _col: new Float32Array(PARTS_PER * 3), // spawn-time instanceColor source
    };
  }
  let high = -1; // highest live slot (release scans down)
  let live = 0;

  /** Part matrix write: scale the unit box to the part's dims and compose. */
  function put(im, slot, v, q, d, k) {
    _s.set(d[0] * k, d[1] * k, d[2] * k);
    _m.compose(v, q, _s);
    im.setMatrixAt(slot, _m);
  }

  /** Joint-offset helper: _vd = offset rotated into the joint's frame. One
   *  call per statement (shared scratch). */
  function off(q, x, y, z) {
    return _vd.set(x, y, z).applyQuaternion(q);
  }

  /** Seed the eased pose state at its target so a fresh zombie is born
   *  mid-stride (no blend-in from a standing default). */
  function snapPose(z) {
    const t = Z.poses[z.pose] || Z.poses.shamble;
    z._hz = z.gaitHz;
    z._leg = t.leg;
    z._knee = t.knee;
    z._arm = t.arm;
    z._reach = t.reach;
    z._splay = t.splay;
    z._elbow = t.elbow;
    z._hunch = t.hunch;
    z._drop = t.drop;
    z._bob = t.bob;
    z._roll = t.roll;
    z._head = t.head;
  }

  return {
    max,
    meshes: { body, eyes },

    get count() {
      return live;
    },

    get records() {
      return pool;
    },

    /** m/s -> gait cycles/s: stride length clamped into the pose's hz band,
     *  scaled by a per-slot tempo factor (0.9-1.1) so a pack never moves in
     *  lockstep. speed <= 0 rests at the band midpoint. */
    gaitHzFor(speed, pose = "run", id = 0) {
      const hz = (Z.poses[pose] || Z.poses.run).hz;
      const k = 0.9 + frac(id * 0.37) * 0.2;
      if (!(speed > 0)) return ((hz[0] + hz[1]) / 2) * k;
      return Math.min(Math.max(speed / Z.stride, hz[0]), hz[1]) * k;
    },

    /**
     * Take one record from the pool. Returns null when all `max` are live —
     * the caller owns back-pressure (director skips / mode releases).
     * @returns {object|null} The live record (mutate z.x/z.z/z.ry per step).
     */
    spawn(spec = {}) {
      let id = -1;
      for (let i = 0; i < max; i++) {
        if (!pool[i].alive) {
          id = i;
          break;
        }
      }
      if (id < 0) return null;
      const z = pool[id];
      z.alive = true;
      live++;
      z.x = spec.x !== undefined ? spec.x : (spec.lane || 0) * CONFIG.LANE_W;
      z.y = spec.y || 0;
      z.z = spec.z || 0;
      z.ry = spec.ry !== undefined ? spec.ry : Math.PI;
      z.pose = POSE_KEYS.includes(spec.pose) ? spec.pose : "shamble";
      z.scale = spec.scale || 1;
      z.speed = spec.speed || 0;
      z.gaitHz = spec.gaitHz || this.gaitHzFor(z.speed, z.pose, id);
      z.phase = spec.phase !== undefined ? spec.phase : frac(id * 0.618034) * TAU;
      snapPose(z);
      // Per-zombie skin variance around the shared olive (pale sickly lift
      // + green/grey drift), then the part tone groups — written once per
      // spawn; colors never change per step.
      const t = spec.tint !== undefined ? spec.tint : frac(id * 0.7548776);
      const T = Z.tones;
      const sr = 1 + T.skinLift + Math.sin(t * 12.9898) * T.skinVar;
      const sg = 1 + T.skinLift + Math.sin(t * 7.7317 + 2.1) * T.skinVar;
      const sb = 1 + T.skinLift + Math.sin(t * 5.3383 + 4.2) * T.skinVar;
      const col = z._col;
      for (let p = 0; p < PARTS_PER; p++) {
        const tone = TONES[p];
        let tr = sr, tg = sg, tb = sb;
        if (tone === "shirt") {
          const k = T.shirt * (1 + Math.sin(t * 9.41 + 1) * T.shirtVar);
          tr = sr * k; tg = sg * k; tb = sb * k;
        } else if (tone === "pants") {
          const k = T.pants * (1 + Math.sin(t * 4.17 + 3) * T.pantsVar);
          tr = sr * k; tg = sg * k; tb = sb * k;
        } else if (tone === "boot") {
          tr = sr * T.boot; tg = sg * T.boot; tb = sb * T.boot;
        }
        col[p * 3] = tr;
        col[p * 3 + 1] = tg;
        col[p * 3 + 2] = tb;
      }
      body.instanceColor.array.set(col, id * PARTS_PER * 3);
      body.instanceColor.needsUpdate = true;
      if (id > high) high = id;
      return z;
    },

    release(zombie) {
      if (!zombie || !zombie.alive) return;
      zombie.alive = false;
      live--;
      const b = zombie.id * PARTS_PER;
      for (let p = 0; p < PARTS_PER; p++) body.setMatrixAt(b + p, _dead);
      eyes.setMatrixAt(zombie.id * 2, _dead);
      eyes.setMatrixAt(zombie.id * 2 + 1, _dead);
      body.instanceMatrix.needsUpdate = true;
      eyes.instanceMatrix.needsUpdate = true;
      while (high >= 0 && !pool[high].alive) high--;
      if (high < 0) {
        body.visible = eyes.visible = false;
        body.count = eyes.count = 0;
      }
    },

    /** Pooled reset (mode restart / retry): recycle everything. */
    reset() {
      for (let i = 0; i < max; i++) this.release(pool[i]);
    },

    /** QA draw A/B hook; fixedUpdate re-shows while anything is live. */
    setVisible(on) {
      body.visible = eyes.visible = !!on;
    },

    /**
     * Pose pass — call once per fixed step AFTER the caller moved zombies.
     * dt 0 (frozen warmup) rewrites the current poses, allocation-free.
     * @param {number} dt
     */
    fixedUpdate(dt) {
      if (high < 0 || live === 0) return;
      const ease = 1 - Math.exp(-dt * Z.poseEase);
      for (let i = 0; i <= high; i++) {
        const z = pool[i];
        if (!z.alive) continue;
        const t = Z.poses[z.pose] || Z.poses.shamble;
        z._hz += (z.gaitHz - z._hz) * ease;
        z._leg += (t.leg - z._leg) * ease;
        z._knee += (t.knee - z._knee) * ease;
        z._arm += (t.arm - z._arm) * ease;
        z._reach += (t.reach - z._reach) * ease;
        z._splay += (t.splay - z._splay) * ease;
        z._elbow += (t.elbow - z._elbow) * ease;
        z._hunch += (t.hunch - z._hunch) * ease;
        z._drop += (t.drop - z._drop) * ease;
        z._bob += (t.bob - z._bob) * ease;
        z._roll += (t.roll - z._roll) * ease;
        z._head += (t.head - z._head) * ease;
        z.phase = (z.phase + TAU * z._hz * dt) % TAU;

        const ph = z.phase;
        const sn = Math.sin(ph);
        const b = z.id * PARTS_PER;
        const eb = z.id * 2;
        const k = z.scale;
        // Root: caller position + step bob (two footfalls per cycle) + sway
        // roll (weight shift every step). YXZ keeps the roll in the yawed
        // frame — the shambler dressing trick.
        const hip = RIG.hipY - z._drop - z._bob * (0.5 - 0.5 * Math.cos(ph * 2));
        _qr.setFromEuler(_e.set(0, z.ry, sn * z._roll, "YXZ"));
        _va.set(z.x, z.y + hip, z.z);
        // 0 pelvis: rigid with the root.
        put(body, b, _va, _qr, RIG.pelvis, k);
        // 1 torso: hunch + a breathing wobble, counter-rolled to the sway.
        _qt.setFromEuler(_e.set(
          z._hunch + Math.sin(ph * 2 + 1) * 0.035, 0, -sn * z._roll * 0.5));
        _vb.set(0, RIG.torsoPivot, 0).applyQuaternion(_qt).applyQuaternion(_qr).add(_va);
        _q1.copy(_qr).multiply(_qt);
        put(body, b + 1, _vb, _q1, RIG.torso, k);
        // 2 head: rides the hunched torso but stays lifted toward its target
        // (dead eyes forward — the chase read).
        _vc.set(0, RIG.torsoPivot + RIG.torso[1], 0).applyQuaternion(_qt); // neck top
        _qh.copy(_qt).multiply(_q2.setFromEuler(_e.set(
          -z._hunch * 0.55 + z._head + Math.sin(ph + 2) * 0.05, 0, sn * 0.05)));
        _ve.set(0, RIG.head[1] / 2, 0).applyQuaternion(_qh).add(_vc); // head centre
        _vb.copy(_ve).applyQuaternion(_qr).add(_va);
        _q1.copy(_qr).multiply(_qh);
        put(body, b + 2, _vb, _q1, RIG.head, k);
        // 3 neck: fills the hunch gap between torso top and skull.
        _vb.copy(_vc).add(off(_qh, 0, RIG.neck[1] * 0.3, 0));
        _vb.applyQuaternion(_qr).add(_va);
        put(body, b + 3, _vb, _q1, RIG.neck, k);
        // Eye chips ride the head pose, anchored at the head CENTRE (_ve —
        // the neck-top pivot would bury them at chin height inside the
        // torso hunch).
        for (let e = 0; e < 2; e++) {
          _vb.set((e === 0 ? 1 : -1) * RIG.eyeLocal[0], RIG.eyeLocal[1], RIG.eyeLocal[2])
            .applyQuaternion(_qh).add(_ve).applyQuaternion(_qr).add(_va);
          put(eyes, eb + e, _vb, _q1, RIG.eye, k);
        }
        // Limb pairs: left leads at ph, right at ph+PI; arms counter their
        // own-side leg. Negative rotation.x swings a hanging limb forward.
        for (let s = -1; s <= 1; s += 2) {
          const armPh = ph + (s < 0 ? Math.PI : 0);
          const legPh = ph + (s < 0 ? 0 : Math.PI);
          const w = s < 0 ? 0 : 1; // slot parity: left pair first
          // Shoulders hang off the hunched torso.
          _vc.set(s * RIG.shoulder[0], RIG.torsoPivot + RIG.shoulder[1], 0)
            .applyQuaternion(_qt);
          // 4/5 upper arm, 6/7 forearm: swing + lunge reach, elbows curled
          // forward (the grasping read), slight outward splay.
          _q4.copy(_qt).multiply(_q3.setFromEuler(_e.set(
            -(Math.sin(armPh) * z._arm + z._reach), 0, s * z._splay)));
          _vb.copy(_vc).add(off(_q4, 0, -RIG.upperArm[1] / 2, 0));
          _q1.copy(_qr).multiply(_q4);
          _vb.applyQuaternion(_qr).add(_va);
          put(body, b + 4 + w, _vb, _q1, RIG.upperArm, k);
          _vd.copy(_vc).add(off(_q4, 0, -RIG.upperArm[1], 0)); // elbow
          _q5.copy(_q4).multiply(_q3.setFromEuler(_e.set(
            -(z._elbow + 0.3 * Math.max(0, Math.sin(armPh))), 0, 0)));
          _vb.copy(_vd).add(off(_q5, 0, -RIG.forearm[1] / 2, 0));
          _q1.copy(_qr).multiply(_q5);
          _vb.applyQuaternion(_qr).add(_va);
          put(body, b + 6 + w, _vb, _q1, RIG.forearm, k);
          // 8/9 thigh, 10/11 shin, 12/13 foot: hips sit in the rigid pelvis;
          // knees flex only on the recovery swing; feet counter-rotate so
          // the toes stay near the ground.
          _vc.set(s * RIG.hipX, -0.02, 0);
          _q4.copy(_q3.setFromEuler(_e.set(-Math.sin(legPh) * z._leg, 0, s * 0.035)));
          _vb.copy(_vc).add(off(_q4, 0, -RIG.thigh[1] / 2, 0));
          _q1.copy(_qr).multiply(_q4);
          _vb.applyQuaternion(_qr).add(_va);
          put(body, b + 8 + w, _vb, _q1, RIG.thigh, k);
          const flex = 0.15 + z._knee * Math.max(0, Math.sin(legPh + 0.55));
          _vd.copy(_vc).add(off(_q4, 0, -RIG.thigh[1], 0)); // knee
          _q5.copy(_q4).multiply(_q3.setFromEuler(_e.set(flex, 0, 0)));
          _vb.copy(_vd).add(off(_q5, 0, -RIG.shin[1] / 2, 0));
          _q1.copy(_qr).multiply(_q5);
          _vb.applyQuaternion(_qr).add(_va);
          put(body, b + 10 + w, _vb, _q1, RIG.shin, k);
          _vd.add(off(_q5, 0, -RIG.shin[1], 0)); // ankle
          _q2.copy(_q5).multiply(_q3.setFromEuler(_e.set(-flex * 0.7, 0, 0)));
          _vb.copy(_vd).add(off(_q2, 0, -RIG.foot[1] / 2, RIG.foot[2] * 0.25));
          _q1.copy(_qr).multiply(_q2);
          _vb.applyQuaternion(_qr).add(_va);
          put(body, b + 12 + w, _vb, _q1, RIG.foot, k);
        }
      }
      body.count = (high + 1) * PARTS_PER;
      eyes.count = (high + 1) * 2;
      body.visible = eyes.visible = true;
      body.instanceMatrix.needsUpdate = true;
      eyes.instanceMatrix.needsUpdate = true;
    },
  };
}
