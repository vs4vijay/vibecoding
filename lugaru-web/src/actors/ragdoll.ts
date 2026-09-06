/**
 * Task 12 — ragdoll bodies spawned from the rig on KO.
 *
 * For every bone the rig declares, we create a Rapier dynamic rigid body with
 * a capsule collider aligned to the bone segment. Ball (spherical) joints
 * connect parent ↔ child at the joint origins exactly where the rig hierarchy
 * places them. The ragdoll takes over the rig's three.js matrices: at
 * `spawnRagdoll` time the rig root is placed at the origin and every bone
 * matrix is written by `handle.update()` each step, so visual and physics
 * stay synchronised without any ongoing animation clip input.
 *
 * Density is uniform across bones so the total mass equals the caller's
 * requested `massKg`; rapier computes each collider's mass from its capsule
 * volume using the same analytic formula we use for density, so the sum
 * matches to floating-point precision.
 */
import * as RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { BoneName, Rig } from './skeleton';
import type { PhysicsWorld } from '../world/physics';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RagdollBonePose {
  pos: { x: number; y: number; z: number };
  quat: { x: number; y: number; z: number; w: number };
}

export interface RagdollHandle {
  /** Current world pose of every bone, updated by `update()`. */
  bones: Record<BoneName, RagdollBonePose>;
  /** True once all rigid bodies are sleeping or near-rest. */
  settled: boolean;
  /** Read body transforms and write them into the rig's bone matrices. */
  update(): void;
  /** Remove all rigid bodies from the physics world. */
  dispose(): void;
}

export interface Impulse {
  /** Direction (need not be normalised internally). */
  dir: { x: number; y: number; z: number };
  /**
   * Impulse magnitude in kg·m/s applied uniformly across the ragdoll bodies
   * (each body gets `dir * (massFraction * force)`). An additional spin kick
   * at the chest produces a dramatic rotation.
   */
  force: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Bones that hang from their joint (limbs — capsule offset -len/2). */
const LIMB_BONES = new Set<BoneName>([
  'armLU', 'armLL', 'armRU', 'armRL',
  'legLU', 'legLL', 'legRU', 'legRL',
]);

const ALL_BONES: BoneName[] = [
  'pelvis', 'spine', 'head',
  'armLU', 'armLL', 'armRU', 'armRL',
  'legLU', 'legLL', 'legRU', 'legRL',
];

/** Shoulder / hip lateral offset (metres) — matches buildRig's `sideX`. */
const SIDE_X = 0.09;

// Reusable scratch THREE objects (allocated once, reused per call).
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _mat = new THREE.Matrix4();

// Cache the axis-alignment quaternion from local Y toward a direction.
const _from = new THREE.Vector3(0, 1, 0);
const _to = new THREE.Vector3();
const _UP180: RAPIER.Rotation = { x: 1, y: 0, z: 0, w: 0 };

/**
 * Shortest-arc rotation from the local +Y axis toward `dir` (normalised).
 * Falls back to a 180° rotation about +X when the vectors are antiparallel.
 */
function bodyQuat(dir: { x: number; y: number; z: number }): RAPIER.Rotation {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  _to.set(dir.x / len, dir.y / len, dir.z / len);
  if (_from.dot(_to) < -1 + 1e-6) return _UP180;
  _quat.setFromUnitVectors(_from, _to);
  return { x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w };
}

/** Analytic capsule volume matching rapier's computation. */
function capsuleVolume(halfH: number, r: number): number {
  return Math.PI * r * r * (2 * halfH + (4 / 3) * r);
}

// ---------------------------------------------------------------------------
// Joint table — derivable from boneLen, no magic numbers
// ---------------------------------------------------------------------------

interface JointSpec {
  parent: BoneName;
  child: BoneName;
  /** Parent-local anchor offset. */
  anchor: { x: number; y: number; z: number };
}

function buildJointTable(boneLen: Record<BoneName, number>): JointSpec[] {
  const tl = boneLen.pelvis;
  const cl = boneLen.spine;
  return [
    { parent: 'pelvis', child: 'spine',      anchor: { x: 0,       y: tl,                  z: 0 } },
    { parent: 'spine',  child: 'head',       anchor: { x: 0,       y: cl,                  z: 0 } },
    { parent: 'spine',  child: 'armLU',      anchor: { x: SIDE_X,  y: cl * 0.8,            z: -tl * 0.18 } },
    { parent: 'spine',  child: 'armRU',      anchor: { x: -SIDE_X, y: cl * 0.8,            z: -tl * 0.18 } },
    { parent: 'armLU',  child: 'armLL',      anchor: { x: 0,       y: -boneLen.armLU,      z: 0 } },
    { parent: 'armRU',  child: 'armRL',      anchor: { x: 0,       y: -boneLen.armRU,      z: 0 } },
    { parent: 'pelvis', child: 'legLU',      anchor: { x: SIDE_X,  y: 0,                   z: tl * 0.15 } },
    { parent: 'pelvis', child: 'legRU',      anchor: { x: -SIDE_X, y: 0,                   z: tl * 0.15 } },
    { parent: 'legLU',  child: 'legLL',      anchor: { x: 0,       y: -boneLen.legLU,      z: 0 } },
    { parent: 'legRU',  child: 'legRL',      anchor: { x: 0,       y: -boneLen.legRU,      z: 0 } },
  ];
}

// ---------------------------------------------------------------------------
// spawnRagdoll
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  /** Total ragdoll mass in kg (default 50 — species mass should be passed). */
  massKg?: number;
  /** Linear damping on every ragdoll body (default 0.35 — calms joint jitter). */
  linearDamping?: number;
  /** Angular damping on every ragdoll body (default 0.8 — calms joint jitter). */
  angularDamping?: number;
}

/**
 * How many consecutive update() calls a body must stay below the settle
 * speed/spin thresholds before it is force-slept. Jittering joint chains
 * never reach Rapier's own sleep threshold; a calm-run counter tames them
 * (standard cosmetic-ragdoll practice) without freezing mid-flight motion.
 */
const CALM_STEPS_TO_SLEEP = 20;

export function spawnRagdoll(
  world: PhysicsWorld,
  rig: Rig,
  impulse: Impulse,
  opts: SpawnOptions = {},
): RagdollHandle {
  const massKg = opts.massKg ?? 50;
  const linDamp = opts.linearDamping ?? 0.35;
  const angDamp = opts.angularDamping ?? 0.8;

  // ---- capture bone world transforms ----
  rig.root.updateMatrixWorld(true);

  // ---- compute per-bone capsule geometry + total volume ----
  interface BoneGeo {
    name: BoneName;
    len: number;
    isLimb: boolean;
    halfH: number;
    radius: number;
    up: boolean;
    worldPos: THREE.Vector3;
    worldQuat: THREE.Quaternion;
    /** Local offset of the capsule centre from the bone origin. */
    capsuleOffsetY: number;
  }
  const bones: Record<BoneName, BoneGeo> = {} as Record<BoneName, BoneGeo>;
  let totalVolume = 0;
  for (const name of ALL_BONES) {
    const len = rig.boneLen[name];
    const isLimb = LIMB_BONES.has(name);
    // Capsule sized to the SEGMENT: halfH + radius == len/2, so the capsule
    // spans exactly joint→joint (end spheres included) and never overlaps
    // the neighbour capsule's segment. Radius clamped for the narrow 0.09m
    // limb spacing.
    const r = Math.min(Math.max(len * 0.18, 0.03), 0.055);
    const hh = Math.max(len / 2 - r, 0.01);
    const v = capsuleVolume(hh, r);
    totalVolume += v;
    // The joint origin is at the bone's Object3D position in the rig's
    // coordinate tree; the world position of the joint is what we pass
    // to `setTranslation`. The capsule along local ±Y is offset from
    // the bone origin by ±len/2 so it straddles the segment between
    // this joint and the child joint.
    bones[name] = {
      name,
      len,
      isLimb,
      halfH: hh,
      radius: r,
      up: !isLimb,
      worldPos: _pos.copy(rig.bones[name].getWorldPosition(_pos)).clone(),
      worldQuat: _quat.copy(rig.bones[name].getWorldQuaternion(_quat)).clone(),
      capsuleOffsetY: isLimb ? -len / 2 : len / 2,
    };
  }
  const density = massKg / totalVolume;

  // ---- spawn clearance: lift the whole ragdoll out of the terrain ----
  // Feet touch the ground in the idle pose, so foot capsules start with
  // their radius BELOW the heightfield. Spawning interpenetrated makes the
  // solver violently expel the bodies (the ragdoll never settles). Compute
  // the deepest capsule penetration and raise every body by the deficit.
  const groundAt = (x: number, z: number): number => world.castGround(x, z);
  let lift = 0;
  for (const geo of Object.values(bones)) {
    const centerY = geo.worldPos.y + geo.capsuleOffsetY;
    const lowest = centerY - geo.halfH - geo.radius;
    const g = groundAt(geo.worldPos.x, geo.worldPos.z);
    const deficit = g - lowest;
    if (deficit > lift) lift = deficit;
  }
  lift += 0.01; // slack so the first contact is a gentle touch, not a fight
  if (lift > 0) {
    for (const geo of Object.values(bones)) {
      geo.worldPos.y += lift;
    }
  }

  // ---- rigid bodies + capsule colliders ----
  const bodies = new Map<BoneName, RAPIER.RigidBody>();
  /** Consecutive calm update() calls per body — drives force-sleep. */
  const calmFor = new Map<BoneName, number>();
  for (const geo of Object.values(bones)) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(geo.worldPos.x, geo.worldPos.y, geo.worldPos.z)
      .setRotation({ x: geo.worldQuat.x, y: geo.worldQuat.y, z: geo.worldQuat.z, w: geo.worldQuat.w })
      .setLinearDamping(linDamp)
      .setAngularDamping(angDamp);
    const body = world.raw.createRigidBody(desc);
    const collider = RAPIER.ColliderDesc.capsule(geo.halfH, geo.radius)
      .setTranslation(0, geo.capsuleOffsetY, 0)
      .setFriction(0.8)
      .setDensity(density)
      // Collision groups: ragdoll bones collide with the WORLD (group 1)
      // but NOT with each other (group 2 excluded from the filter).
      // Self-intersecting jointed capsules make the solver fight the joints
      // forever; world-only collision is the standard cosmetic-ragdoll setup.
      .setCollisionGroups((0x0002 << 16) | 0x0001);
    world.raw.createCollider(collider, body);
    bodies.set(geo.name, body);
  }

  // ---- ball (spherical) joints ----
  for (const spec of buildJointTable(rig.boneLen)) {
    const pb = bodies.get(spec.parent);
    const cb = bodies.get(spec.child);
    if (!pb || !cb) continue;
    world.raw.createImpulseJoint(
      RAPIER.JointData.spherical(spec.anchor, { x: 0, y: 0, z: 0 }),
      pb,
      cb,
      true,
    );
  }

  // ---- apply impulse ----
  const dirLen = Math.hypot(impulse.dir.x, impulse.dir.y, impulse.dir.z) || 1;
  const ndx = impulse.dir.x / dirLen;
  const ndy = impulse.dir.y / dirLen;
  const ndz = impulse.dir.z / dirLen;
  const dv = impulse.force / massKg; // uniform velocity kick (m/s)
  for (const [name, body] of bodies) {
    const m = body.mass();
    body.applyImpulse({ x: ndx * dv * m, y: ndy * dv * m, z: ndz * dv * m }, true);
  }
  // Extra spin kick at the chest (spine body) — push at its world origin
  // so the offset from centre-of-mass produces a torque.
  const spineBody = bodies.get('spine')!;
  const spineMass = spineBody.mass();
  const extraDv = (impulse.force * 0.25) / massKg;
  const spineWPos = bones.spine.worldPos;
  spineBody.applyImpulseAtPoint(
    { x: ndx * extraDv * spineMass, y: ndy * extraDv * spineMass, z: ndz * extraDv * spineMass },
    { x: spineWPos.x, y: spineWPos.y, z: spineWPos.z },
    true,
  );

  // ---- zero the rig root so local transforms == world transforms ----
  rig.root.position.set(0, 0, 0);
  rig.root.rotation.set(0, 0, 0);
  rig.root.scale.set(1, 1, 1);
  rig.root.updateMatrix();
  for (const bone of Object.values(rig.bones)) {
    bone.matrixAutoUpdate = false;
  }

  // ---- build the handle ----
  const handle: RagdollHandle = {
    bones: {} as Record<BoneName, RagdollBonePose>,
    settled: false,
    update() { /* filled below */ },
    dispose() { for (const b of bodies.values()) world.raw.removeRigidBody(b); },
  };
  for (const geo of Object.values(bones)) {
    const body = bodies.get(geo.name)!;
    const t = body.translation();
    const r = body.rotation();
    handle.bones[geo.name] = {
      pos: { x: t.x, y: t.y, z: t.z },
      quat: { x: r.x, y: r.y, z: r.z, w: r.w },
    };
  }
  handle.update = function update(): void {
    let allSettled = true;
    for (const [name, body] of bodies) {
      const t = body.translation();
      const r = body.rotation();
      const pose = handle.bones[name];
      pose.pos.x = t.x;
      pose.pos.y = t.y;
      pose.pos.z = t.z;
      pose.quat.x = r.x;
      pose.quat.y = r.y;
      pose.quat.z = r.z;
      pose.quat.w = r.w;
      // Write the rig bone's three.js matrix directly (root is at origin
      // so bone.matrixWorld = bone.matrix, no parent chain to worry about).
      const obj = rig.bones[name];
      _pos.set(t.x, t.y, t.z);
      _quat.set(r.x, r.y, r.z, r.w);
      _mat.compose(_pos, _quat, _scale);
      obj.matrix.copy(_mat);
      obj.matrixWorldNeedsUpdate = true;
      // Settled = sleeping or very slow. Jittering joint chains never reach
      // Rapier's own sleep threshold, so a calm run of updates force-sleeps
      // the body (counts as settled on the next update).
      const v = body.linvel();
      const w = body.angvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      const spin = Math.hypot(w.x, w.y, w.z);
      if (!body.isSleeping()) {
        if (speed > 0.1 || spin > 0.6) {
          allSettled = false;
          calmFor.set(name, 0);
        } else {
          const calm = (calmFor.get(name) ?? 0) + 1;
          calmFor.set(name, calm);
          if (calm >= CALM_STEPS_TO_SLEEP) body.sleep();
        }
      }
    }
    handle.settled = allSettled;
  };

  return handle;
}
// ---------------------------------------------------------------------------
// Ragdoll culling [Task 20] — oldest settled ragdolls culled beyond cap.
// ---------------------------------------------------------------------------

/**
 * Remove settled ragdolls beyond `max` from the list, oldest first.
 * Culled ragdolls have their rigid bodies removed from the physics world.
 */
export function cullSettledRagdolls(ragdolls: RagdollHandle[], max: number): void {
  while (ragdolls.length > max) {
    // Find the oldest settled ragdoll (scan from front = oldest).
    let idx = -1;
    for (let i = 0; i < ragdolls.length; i++) {
      if (ragdolls[i].settled) { idx = i; break; }
    }
    if (idx < 0) break; // none settled yet — keep all
    ragdolls[idx].dispose();
    ragdolls.splice(idx, 1);
  }
}
