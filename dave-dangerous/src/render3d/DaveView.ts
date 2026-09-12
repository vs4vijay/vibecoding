// src/render3d/DaveView.ts — hero character rig ("CATACOMB DEPTHS" overhaul).
// A layered-primitive adventurer ~1.9 units tall with fully procedural, eased
// animation: idle breathing, run cycle (amplitude ∝ speed), jump tuck/flare,
// landing squash & stretch on a damped spring, jetpack hover with twin
// flickering flames + warm light, and a crumple-and-spin death. Facing turns
// are short eased arcs through the camera, never instant mirrors.
//
// Hooks for core:
//   exhaustAnchor(): THREE.Vector3 — world-space jetpack exhaust point; feed it
//   to Particles.jetpackExhaust() each frame (this module never calls Particles).
import * as THREE from "three";
import { PALETTE, TILE } from "./palette";
import { PHYSICS } from "../core/types";
import { pbrSet } from "./textures";
import type { DaveView as DaveState } from "./viewTypes";

export interface DaveSyncOpts {
  jetpackHeld: boolean;
  facing: 1 | -1;
}

// --- proportions (world units; local y = 0 is the feet) ---------------------
const HIP_Y = 0.95;
const THIGH_LEN = 0.42;
const SHIN_LEN = 0.4;
const TORSO_Y = 0.95; // torso pivot (hips)
const HEAD_Y = 0.62; // head group above torso pivot
const SHOULDER_Y = 0.5;
const ARM_Z = 0.27;
const LEG_Z = 0.13;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
function easeOutCubic(t: number): number {
  const k = clamp(t, 0, 1);
  return 1 - Math.pow(1 - k, 3);
}

// Deterministic value noise for the cloth maps (no Math.random anywhere).
function ihash2(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(u: number, v: number, seed: number): number {
  const x = u * 8;
  const y = v * 8;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const ty = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
  const a = ihash2(xi, yi, seed);
  const b = ihash2(xi + 1, yi, seed);
  const c = ihash2(xi, yi + 1, seed);
  const d = ihash2(xi + 1, yi + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// --- procedural cloth maps (tiny 64px canvas, module-cached) -----------------
interface ClothMaps { map: THREE.CanvasTexture; rough: THREE.CanvasTexture }
let clothCache: ClothMaps | null = null;

function clothMaps(): ClothMaps {
  if (clothCache) return clothCache;
  const S = 64;
  const mk = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("DaveView: 2D canvas unavailable");
    return [c, ctx];
  };
  const [ca, actx] = mk();
  const [cr, rctx] = mk();
  const img = actx.createImageData(S, S);
  const rimg = rctx.createImageData(S, S);
  const base = new THREE.Color(PALETTE.daveCloth);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = vnoise(u, v, 71) * 0.65 + vnoise(u, v, 131) * 0.35;
      const weave = 0.5 + 0.5 * Math.sin(u * Math.PI * 32) * Math.sin(v * Math.PI * 32);
      const shade = 0.82 + 0.24 * n + 0.05 * weave;
      const j = (y * S + x) * 4;
      img.data[j] = Math.round(clamp(base.r * shade, 0, 1) * 255);
      img.data[j + 1] = Math.round(clamp(base.g * shade, 0, 1) * 255);
      img.data[j + 2] = Math.round(clamp(base.b * shade, 0, 1) * 255);
      img.data[j + 3] = 255;
      const r = Math.round(clamp(0.62 + 0.24 * n - 0.05 * weave, 0, 1) * 255);
      rimg.data[j] = r; rimg.data[j + 1] = r; rimg.data[j + 2] = r; rimg.data[j + 3] = 255;
    }
  }
  actx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  const map = new THREE.CanvasTexture(ca);
  map.colorSpace = THREE.SRGBColorSpace;
  const rough = new THREE.CanvasTexture(cr);
  for (const t of [map, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    t.anisotropy = 4;
    t.needsUpdate = true;
  }
  clothCache = { map, rough };
  return clothCache;
}

// --- pose channels (all eased; nothing snaps) --------------------------------
interface Pose {
  hipL: number; hipR: number; kneeL: number; kneeR: number;
  armL: number; armR: number; splayL: number; splayR: number;
  elbowL: number; elbowR: number;
  torso: number; twist: number; head: number; headYaw: number;
  bob: number; stretch: number;
}
// Fixed channel list (same set and order as the Pose fields) — avoids the
// per-frame Object.keys() allocation in lerpPose.
const POSE_KEYS: readonly (keyof Pose)[] = [
  "hipL", "hipR", "kneeL", "kneeR", "armL", "armR", "splayL", "splayR",
  "elbowL", "elbowR", "torso", "twist", "head", "headYaw", "bob", "stretch",
];
const POSE_DEFAULTS: Readonly<Pose> = {
  hipL: 0, hipR: 0, kneeL: 0.1, kneeR: 0.1, armL: 0, armR: 0,
  splayL: -0.08, splayR: 0.08, elbowL: 0.25, elbowR: 0.25,
  torso: 0, twist: 0, head: 0, headYaw: 0, bob: 0, stretch: 0,
};
function poseZero(): Pose {
  return { ...POSE_DEFAULTS };
}
/** Restore a pose to POSE_DEFAULTS in place (no allocation). */
function resetPose(p: Pose): void {
  for (const key of POSE_KEYS) p[key] = POSE_DEFAULTS[key];
}
// Shared per-frame lerp target — update() must resetPose() it before writing.
const POSE_TARGET: Pose = poseZero();
function lerpPose(cur: Pose, target: Pose, k: number): void {
  for (const key of POSE_KEYS) {
    cur[key] += (target[key] - cur[key]) * k;
  }
}

export class DaveView {
  readonly root = new THREE.Group();

  // rig references
  private turn: THREE.Group;
  private bodyGrp: THREE.Group;
  private torsoGrp: THREE.Group;
  private chest: THREE.Mesh;
  private headGrp: THREE.Group;
  private headBaseY: number;
  private thighL: THREE.Group; private thighR: THREE.Group;
  private kneeL: THREE.Group; private kneeR: THREE.Group;
  private shoulderL: THREE.Group; private shoulderR: THREE.Group;
  private elbowL: THREE.Group; private elbowR: THREE.Group;
  private gun: THREE.Group;
  private flameGrp: THREE.Group;
  private flamesOuter: THREE.Mesh[] = [];
  private flamesInner: THREE.Mesh[] = [];
  private jetLight: THREE.PointLight;

  // owned resources
  private ownedMats: THREE.Material[] = [];
  private ownedTex: THREE.Texture[] = [];
  private ownedGeos: THREE.BufferGeometry[] = [];

  // animation state
  private poseCur: Pose = poseZero();
  private runPhase = 0;
  private facingTarget: 1 | -1 = 1;
  private yawCur = 0; // eased facing yaw, range [-π, 0] (turn passes the camera)
  private velX = 0; private velY = 0;
  private grounded = true;
  private alive = true;
  private jetActive = false;
  private jetFuelN = 0;
  private prevVelY = 0;
  private prevGrounded = true;
  private deathT = -1; // <0 → alive; >=0 → seconds since death
  private spinAcc = 0;
  private spring = 0; private springV = 0; // landing squash spring
  private stretchCur = 0;
  private lightCur = 0;
  private exhaustVec = new THREE.Vector3();

  private geo<T extends THREE.BufferGeometry>(g: T): T { this.ownedGeos.push(g); return g; }
  private mat<T extends THREE.Material>(m: T): T { this.ownedMats.push(m); return m; }

  constructor(scene: THREE.Scene) {
    const cloth = clothMaps();
    this.ownedTex.push(cloth.map, cloth.rough);

    // --- materials -----------------------------------------------------
    const clothMat = this.mat(new THREE.MeshStandardMaterial({
      map: cloth.map, roughnessMap: cloth.rough, roughness: 1.0, metalness: 0.02,
    }));
    const trouserMat = this.mat(new THREE.MeshStandardMaterial({ color: PALETTE.daveDark, roughness: 0.9, metalness: 0.02 }));
    const skinMat = this.mat(new THREE.MeshStandardMaterial({ color: PALETTE.daveSkin, roughness: 0.55, metalness: 0 }));
    const hairMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x241812, roughness: 0.5, metalness: 0.05 }));
    const gold = pbrSet("gold");
    const brassMat = this.mat(new THREE.MeshStandardMaterial({
      map: gold.map, normalMap: gold.normalMap, roughnessMap: gold.roughnessMap,
      roughness: 0.42, metalness: 0.92,
    }));
    const metal = pbrSet("metal");
    const metalMat = this.mat(new THREE.MeshStandardMaterial({
      map: metal.map, normalMap: metal.normalMap, roughnessMap: metal.roughnessMap,
      roughness: 0.55, metalness: 0.8, color: 0x8b939c,
    }));
    const leatherMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x2c1d14, roughness: 0.85, metalness: 0.05 }));
    const eyeMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x140d0a, roughness: 0.25, metalness: 0.1 }));
    const flameOuterMat = this.mat(new THREE.MeshBasicMaterial({
      color: 0xff8a3a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const flameInnerMat = this.mat(new THREE.MeshBasicMaterial({
      color: 0xffe9b0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    }));

    // --- hierarchy -------------------------------------------------------
    this.turn = new THREE.Group(); // facing yaw + turn squeeze
    this.bodyGrp = new THREE.Group(); // bob + squash/stretch (pivot at feet)
    this.turn.add(this.bodyGrp);
    this.root.add(this.turn);

    // legs
    const buildLeg = (side: 1 | -1): [THREE.Group, THREE.Group] => {
      const thigh = new THREE.Group();
      thigh.position.set(0, HIP_Y, side * LEG_Z);
      const thighMesh = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.085, 0.26, 4, 10)), trouserMat);
      thighMesh.position.y = -0.21;
      thighMesh.castShadow = true;
      thigh.add(thighMesh);
      const knee = new THREE.Group();
      knee.position.y = -THIGH_LEN;
      const kneeCap = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.075, 10, 8)), brassMat);
      knee.add(kneeCap);
      const shin = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.068, 0.24, 4, 10)), trouserMat);
      shin.position.y = -0.2;
      shin.castShadow = true;
      knee.add(shin);
      const boot = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.26, 0.12, 0.16)), leatherMat);
      boot.position.set(0.04, -SHIN_LEN - 0.055, 0);
      boot.castShadow = true;
      knee.add(boot);
      const cuff = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.082, 0.078, 0.05, 10)), brassMat);
      cuff.position.y = -SHIN_LEN + 0.04;
      knee.add(cuff);
      thigh.add(knee);
      this.bodyGrp.add(thigh);
      return [thigh, knee];
    };
    [this.thighL, this.kneeL] = buildLeg(1);
    [this.thighR, this.kneeR] = buildLeg(-1);

    // torso
    this.torsoGrp = new THREE.Group();
    this.torsoGrp.position.y = TORSO_Y;
    this.bodyGrp.add(this.torsoGrp);

    const pelvis = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.17, 12, 10)), trouserMat);
    pelvis.scale.set(0.82, 0.62, 1.0);
    pelvis.position.y = 0.02;
    pelvis.castShadow = true;
    this.torsoGrp.add(pelvis);

    this.chest = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.2, 0.28, 6, 14)), clothMat);
    this.chest.scale.set(1.05, 1, 0.82);
    this.chest.position.y = 0.34;
    this.chest.castShadow = true;
    this.torsoGrp.add(this.chest);

    const belt = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.205, 0.215, 0.07, 14)), brassMat);
    belt.scale.z = 0.86;
    belt.position.y = 0.1;
    this.torsoGrp.add(belt);
    const buckle = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.05, 0.06, 0.03)), brassMat);
    buckle.position.set(0.2, 0.1, 0);
    this.torsoGrp.add(buckle);

    for (const side of [1, -1] as const) {
      const pad = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.09, 10, 8)), clothMat);
      pad.position.set(0, SHOULDER_Y + 0.02, side * ARM_Z);
      pad.castShadow = true;
      this.torsoGrp.add(pad);
      // chest strap
      const strap = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.05, 0.4, 0.035)), leatherMat);
      strap.position.set(0.17, 0.34, side * 0.11);
      strap.rotation.z = 0.12;
      this.torsoGrp.add(strap);
    }

    // backpack frame + jetpack (always visible; flames are state-driven)
    const pack = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.2, 0.4, 0.32)), metalMat);
    pack.position.set(-0.28, 0.3, 0);
    pack.castShadow = true;
    this.torsoGrp.add(pack);
    for (const side of [1, -1] as const) {
      const tank = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.085, 0.085, 0.46, 12)), brassMat);
      tank.position.set(-0.33, 0.28, side * 0.1);
      tank.castShadow = true;
      this.torsoGrp.add(tank);
      const cap = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.085, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2)), brassMat);
      cap.position.set(-0.33, 0.51, side * 0.1);
      this.torsoGrp.add(cap);
      const nozzle = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.05, 0.075, 0.09, 10)), metalMat);
      nozzle.position.set(-0.33, 0.02, side * 0.1);
      this.torsoGrp.add(nozzle);
    }

    // twin flames (additive, flicker driven in update)
    this.flameGrp = new THREE.Group();
    this.flameGrp.visible = false;
    this.torsoGrp.add(this.flameGrp);
    for (const side of [1, -1] as const) {
      const outer = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.07, 0.42, 10, 1, true)), flameOuterMat);
      outer.rotation.z = Math.PI; // apex down
      outer.position.set(-0.33, -0.24, side * 0.1);
      this.flameGrp.add(outer);
      this.flamesOuter.push(outer);
      const inner = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.036, 0.26, 8, 1, true)), flameInnerMat);
      inner.rotation.z = Math.PI;
      inner.position.set(-0.33, -0.17, side * 0.1);
      this.flameGrp.add(inner);
      this.flamesInner.push(inner);
    }

    // head
    this.headGrp = new THREE.Group();
    this.headGrp.position.y = HEAD_Y;
    this.headBaseY = HEAD_Y;
    this.torsoGrp.add(this.headGrp);
    const neck = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.06, 0.07, 0.09, 8)), skinMat);
    neck.position.y = 0.02;
    this.headGrp.add(neck);
    const skull = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.2, 16, 14)), skinMat);
    skull.scale.set(0.92, 1, 0.95);
    skull.position.set(0.01, 0.16, 0);
    skull.castShadow = true;
    this.headGrp.add(skull);
    const hair = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.21, 14, 12)), hairMat);
    hair.scale.set(0.95, 0.85, 1.02);
    hair.position.set(-0.035, 0.2, 0);
    hair.castShadow = true;
    this.headGrp.add(hair);
    const circlet = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.185, 0.02, 6, 18)), brassMat);
    circlet.rotation.x = Math.PI / 2;
    circlet.position.set(0.01, 0.25, 0);
    this.headGrp.add(circlet);
    for (const side of [1, -1] as const) {
      const eye = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.022, 6, 6)), eyeMat);
      eye.position.set(0.175, 0.17, side * 0.065);
      this.headGrp.add(eye);
    }

    // arms (near = +z)
    const buildArm = (side: 1 | -1): [THREE.Group, THREE.Group] => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.02, SHOULDER_Y, side * ARM_Z);
      const upper = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.062, 0.16, 4, 10)), clothMat);
      upper.position.y = -0.145;
      upper.castShadow = true;
      shoulder.add(upper);
      const cuff = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.068, 10, 8)), brassMat);
      cuff.position.y = -0.28;
      shoulder.add(cuff);
      const elbow = new THREE.Group();
      elbow.position.y = -0.29;
      const fore = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.052, 0.14, 4, 10)), clothMat);
      fore.position.y = -0.11;
      fore.castShadow = true;
      elbow.add(fore);
      const hand = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.065, 10, 8)), skinMat);
      hand.position.y = -0.25;
      elbow.add(hand);
      shoulder.add(elbow);
      this.torsoGrp.add(shoulder);
      return [shoulder, elbow];
    };
    [this.shoulderL, this.elbowL] = buildArm(1);
    [this.shoulderR, this.elbowR] = buildArm(-1);

    // gun — held in the near hand, shown when hasGun
    this.gun = new THREE.Group();
    this.gun.position.set(0.0, -0.25, 0.06);
    this.gun.visible = false;
    this.elbowL.add(this.gun);
    const gBody = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.1, 0.09, 0.06)), metalMat);
    this.gun.add(gBody);
    const gBarrel = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.2, 0.05, 0.05)), metalMat);
    gBarrel.position.set(0.13, 0.02, 0);
    this.gun.add(gBarrel);
    const gGrip = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.055, 0.12, 0.05)), leatherMat);
    gGrip.position.set(-0.03, -0.09, 0);
    gGrip.rotation.z = 0.32;
    this.gun.add(gGrip);
    const gSight = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.03, 0.03, 0.02)), brassMat);
    gSight.position.set(0.18, 0.06, 0);
    this.gun.add(gSight);

    // jetpack light — self-managed so dispose() is exact (LightingRig has no
    // removal API; intensity is modulated to 0 whenever the jet is off).
    this.jetLight = new THREE.PointLight(PALETTE.ember, 0, 5.5, 2);
    this.jetLight.position.set(0, 0, 0);
    scene.add(this.jetLight);

    this.root.name = "dave";
    scene.add(this.root);
  }

  /** World-space jetpack exhaust anchor for the VFX particle system. */
  exhaustAnchor(): THREE.Vector3 {
    this.flameGrp.updateWorldMatrix(true, false);
    this.flameGrp.getWorldPosition(this.exhaustVec);
    this.exhaustVec.y -= 0.12;
    return this.exhaustVec;
  }

  /** Push sim state into the rig; called every render frame. */
  sync(dave: DaveState, opts: DaveSyncOpts): void {
    // hitbox is pos+(4,2) 16×30 px → visual center x = pos.x+12; feet y = pos.y+32
    this.root.position.set((dave.pos.x + 12) / TILE, -(dave.pos.y + 32) / TILE, 0);
    this.facingTarget = opts.facing;
    this.velX = dave.vel.x;
    this.velY = dave.vel.y;
    this.grounded = dave.grounded;
    this.alive = dave.alive;
    this.jetActive = opts.jetpackHeld && dave.alive;
    this.jetFuelN = clamp(dave.jetpackFuel / 20, 0, 1);
    this.gun.visible = dave.hasGun;

    // landing: big downward velocity vanishing into the ground → squash impulse
    if (dave.alive && dave.grounded && !this.prevGrounded && this.prevVelY > 2.2) {
      this.springV -= Math.min(1, this.prevVelY / 7) * 3.6;
    }
    if (!dave.alive && this.deathT < 0) {
      this.deathT = 0;
      this.spinAcc = 0;
      this.springV -= 2.4;
    } else if (dave.alive && this.deathT >= 0) {
      // respawned (new life / new level): reset one-shot state cleanly
      this.deathT = -1;
      this.spinAcc = 0;
      this.spring = 0; this.springV = 0;
      this.yawCur = this.facingTarget === 1 ? 0 : -Math.PI;
      this.prevVelY = 0; this.prevGrounded = true;
    }
    this.prevVelY = dave.vel.y;
    this.prevGrounded = dave.grounded;
  }

  update(dt: number, time: number): void {
    const d = Math.min(dt, 0.1);
    let deathSink = 0;
    const speedN = clamp(Math.abs(this.velX) / PHYSICS.WALK_MAX, 0, 1.25);
    const rising = clamp(-this.velY / PHYSICS.JUMP_VELOCITY, 0, 1); // velY < 0 → rising
    const falling = clamp(this.velY / PHYSICS.MAX_FALL, 0, 1);

    const target = POSE_TARGET;
    resetPose(target);

    if (this.deathT >= 0) {
      // --- death: crumple, slow spin, sink --------------------------------
      this.deathT += d;
      const p = easeOutCubic(this.deathT / 0.55);
      target.hipL = target.hipR = -1.35 * p;
      target.kneeL = target.kneeR = 2.1 * p;
      target.torso = 0.85 * p;
      target.head = 0.5 * p;
      target.armL = target.armR = 0.9 * p;
      target.elbowL = target.elbowR = 0.2 + 0.9 * p;
      target.bob = -0.42 * p;
      target.stretch = -0.15 * p;
      target.twist = 0;
      this.spinAcc += 3.0 * Math.exp(-this.deathT * 1.15) * d; // slow decaying spin
      deathSink = -0.16 * clamp((this.deathT - 0.9) / 1.4, 0, 1);
    } else if (this.jetActive) {
      // --- jetpack hover: dangling legs, arms out, slight back-lean -------
      const sway = Math.sin(time * 3.1);
      target.hipL = -0.22 + 0.09 * sway;
      target.hipR = -0.3 + 0.09 * Math.sin(time * 3.1 + 1.2);
      target.kneeL = 0.55 + 0.12 * sway;
      target.kneeR = 0.62 + 0.12 * Math.sin(time * 3.1 + 1.2);
      target.armL = 0.42; target.armR = 0.3;
      target.splayL = -0.42; target.splayR = 0.38;
      target.elbowL = 0.5; target.elbowR = 0.62;
      target.torso = -0.08;
      target.head = 0.1;
      target.bob = 0.02 * Math.sin(time * 3.7);
      target.stretch = 0.04;
      target.twist = -0.06 * speedN;
      this.runPhase += d * 2;
    } else if (!this.grounded) {
      if (rising > falling) {
        // --- jump tuck -----------------------------------------------------
        target.hipL = -0.75; target.hipR = -0.55;
        target.kneeL = 1.35; target.kneeR = 1.05;
        target.armL = 1.15; target.armR = 0.9;
        target.elbowL = 0.7; target.elbowR = 0.85;
        target.splayL = -0.25; target.splayR = 0.2;
        target.torso = -0.06;
        target.head = 0.06;
        target.bob = 0.02;
        target.stretch = 0.09 * rising;
      } else {
        // --- falling flare --------------------------------------------------
        const flutter = 0.22 * Math.sin(time * 9);
        target.hipL = -0.28; target.hipR = -0.06;
        target.kneeL = 0.5; target.kneeR = 0.28;
        target.armL = 2.25 + flutter; target.armR = 2.5 - flutter;
        target.splayL = -0.3; target.splayR = 0.3;
        target.elbowL = 0.35; target.elbowR = 0.3;
        target.torso = 0.07;
        target.head = -0.08;
        target.stretch = -0.06 * falling;
      }
    } else {
      // --- ground: run cycle ∝ |vel.x|, idle breathing overlay ------------
      this.runPhase += d * (5.5 + 13.5 * speedN);
      const swing = Math.sin(this.runPhase) * 0.78 * speedN;
      const liftL = Math.max(0, Math.sin(this.runPhase + Math.PI * 0.5));
      const liftR = Math.max(0, Math.sin(this.runPhase + Math.PI * 1.5));
      target.hipL = swing;
      target.hipR = -swing;
      target.kneeL = 0.14 + 0.85 * liftL * speedN;
      target.kneeR = 0.14 + 0.85 * liftR * speedN;
      target.armL = -swing * 0.75;
      target.armR = swing * 0.75;
      target.elbowL = 0.3 + 0.45 * speedN;
      target.elbowR = 0.3 + 0.45 * speedN;
      target.torso = -0.15 * speedN;
      target.twist = -0.1 * speedN + 0.035 * Math.sin(time * 0.8) * (1 - speedN);
      target.head = 0.09 * speedN;
      target.bob = -0.045 * speedN * (0.5 + 0.5 * Math.cos(this.runPhase * 2));
      target.stretch = 0;
      if (speedN < 0.05) {
        // idle weight shift
        target.torso += 0.03 * Math.sin(time * 0.9);
        target.armL += 0.04 * Math.sin(time * 1.3);
        target.armR -= 0.04 * Math.sin(time * 1.3);
      }
    }

    // eased pose blend (fast — keeps gameplay readable, nothing snaps)
    const kPose = 1 - Math.exp(-d * 13);
    lerpPose(this.poseCur, target, kPose);
    const c = this.poseCur;
    this.thighL.rotation.z = c.hipL; this.kneeL.rotation.z = -c.kneeL;
    this.thighR.rotation.z = c.hipR; this.kneeR.rotation.z = -c.kneeR;
    this.shoulderL.rotation.z = c.armL; this.shoulderL.rotation.x = c.splayL;
    this.shoulderR.rotation.z = c.armR; this.shoulderR.rotation.x = c.splayR;
    this.elbowL.rotation.z = c.elbowL;
    this.elbowR.rotation.z = c.elbowR;
    this.torsoGrp.rotation.z = c.torso;
    this.torsoGrp.rotation.y = c.twist;
    this.headGrp.rotation.z = -0.55 * c.torso + c.head;
    this.headGrp.rotation.y = c.headYaw;
    this.bodyGrp.position.y = c.bob + deathSink;

    // facing: fast eased arc (~0.15s to settle), squeezed silhouette mid-turn
    const targetYaw = this.facingTarget === 1 ? 0 : -Math.PI;
    if (this.deathT < 0) {
      const kYaw = 1 - Math.exp(-d / 0.045);
      this.yawCur += (targetYaw - this.yawCur) * kYaw;
      this.turn.rotation.y = this.yawCur;
      this.turn.scale.x = 0.72 + 0.28 * Math.abs(Math.cos(this.yawCur));
    } else {
      this.turn.rotation.y = this.yawCur + this.spinAcc;
      this.turn.scale.x = 1;
    }

    // landing squash spring (damped) + air stretch
    this.springV += (-170 * this.spring - 11 * this.springV) * d;
    this.spring += this.springV * d;
    const kStretch = 1 - Math.exp(-d * 10);
    this.stretchCur += (c.stretch - this.stretchCur) * kStretch;
    const sq = clamp(this.spring, -0.32, 0.32);
    const sy = clamp((1 + this.stretchCur) * (1 + sq), 0.55, 1.45);
    const sxz = clamp(1 - sq * 0.55, 0.72, 1.25);
    this.bodyGrp.scale.set(sxz, sy, sxz);

    // idle breathing (subtle, always on while alive)
    const breath = this.alive ? Math.sin(time * 2.1) : 0;
    this.chest.scale.set(1.05 + 0.02 * breath, 1 + 0.035 * breath, 0.82 + 0.02 * breath);
    this.headGrp.position.y = this.headBaseY + 0.01 * Math.sin(time * 2.1 + 0.5);

    // --- jetpack flames + light ------------------------------------------
    const flameOn = this.jetActive && this.alive;
    this.flameGrp.visible = flameOn;
    if (flameOn) {
      const riseN = clamp(-this.velY / PHYSICS.JUMP_VELOCITY, 0, 1);
      const fuelScale = 0.7 + 0.3 * this.jetFuelN;
      for (let i = 0; i < this.flamesOuter.length; i++) {
        const side = i === 0 ? 1 : -1;
        const fl = 1 + 0.22 * Math.sin(time * 39 + side * 2.1) + 0.13 * Math.sin(time * 61 + side * 4.4);
        const outer = this.flamesOuter[i]!;
        outer.scale.set(0.9 + 0.2 * fl, fuelScale * (1 + 0.35 * riseN) * fl, 0.9 + 0.2 * fl);
        (outer.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.25 * fl;
        const inner = this.flamesInner[i]!;
        inner.scale.set(1, fuelScale * (1 + 0.3 * riseN) * (1.9 - fl), 1);
        (inner.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.2 * (1.7 - fl);
      }
    }
    const lightTarget = flameOn ? 2.3 + 0.9 * this.jetFuelN : 0;
    this.lightCur += (lightTarget - this.lightCur) * (1 - Math.exp(-d * 14));
    this.jetLight.intensity = this.lightCur * (flameOn ? 0.88 + 0.12 * Math.sin(time * 47) : 1);
    if (this.lightCur > 0.01) {
      this.jetLight.position.copy(this.exhaustAnchor());
    }
  }

  dispose(): void {
    this.jetLight.removeFromParent();
    this.jetLight.dispose();
    for (const g of this.ownedGeos) g.dispose();
    for (const m of this.ownedMats) m.dispose();
    for (const t of this.ownedTex) t.dispose();
    this.ownedGeos = []; this.ownedMats = []; this.ownedTex = [];
    this.root.removeFromParent();
  }
}
