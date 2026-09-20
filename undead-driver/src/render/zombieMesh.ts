import * as THREE from "three";
import type { Zombie, ZombiePool, ZombieType } from "../game/zombies";

// Death tumble duration mirrors ZombiePool's internal DEATH_TUMBLE_S (=1 s).
const DEATH_TUMBLE_S = 1;
/** Sink depth reached at the end of the death tumble. */
const DEAD_SINK_M = 1.6;
const BRUTE_SCALE = 1.5;
const HEAD_COLOR = 0xc7cda6;
const SKIN_COLOR = 0xa8b58a;
const HEAD_MAT = new THREE.MeshLambertMaterial({ color: HEAD_COLOR });
const SKIN_MAT = new THREE.MeshLambertMaterial({ color: SKIN_COLOR });

const TORSO_COLOR: Record<ZombieType, number> = {
  walker: 0x86a05a,
  runner: 0xc9d16a,
  brute: 0x9b4232,
};

/** Per-type torso tints applied via instanceColor (white base material). */
const TORSO_TINT: Record<ZombieType, THREE.Color> = {
  walker: new THREE.Color(TORSO_COLOR.walker),
  runner: new THREE.Color(TORSO_COLOR.runner),
  brute: new THREE.Color(TORSO_COLOR.brute),
};
/** Shared torso material; the per-instance color carries the type tint. */
const TORSO_MAT = new THREE.MeshLambertMaterial({ color: 0xffffff });

/** Shared scratch transform for composing instance matrices. */
const SCRATCH = new THREE.Object3D();

// Telegraph ground flash: one flat additive disc per zombie slot under a
// telegraphing zombie. Same fade trick as the obstacle warning rings — with
// AdditiveBlending the per-instance color IS the fade (black adds nothing),
// so the pulse just lerps black→red across the telegraph window; no
// per-instance opacity. Radius covers the zombie's footprint plus margin.
const FLASH_TELEGRAPH_S = 0.35; // mirrors ZombiePool's internal TELEGRAPH_S
const FLASH_BASE_R = 0.9;
/** Ground y, just above the road to avoid z-fighting (rings sit at 0.04). */
const FLASH_Y = 0.05;
const FLASH_RED = 0xff2418; // same warning red as the obstacle rings
const FLASH_RED_COLOR = new THREE.Color(FLASH_RED);
const FLASH_BLACK_COLOR = new THREE.Color(0x000000);
/** Shared scratch color for the black→red pulse lerp (no allocation). */
const FLASH_SCRATCH_COLOR = new THREE.Color();
/** Scale range across the telegraph window: swells as the leap approaches. */
const FLASH_SCALE_MIN = 0.8;
const FLASH_SCALE_MAX = 1.3;
/** Brightness floor so the flash pops in immediately, then intensifies. */
const FLASH_BRIGHT_MIN = 0.3;
/** Parking depth under the road, matching the zombie parts' hidden slot. */
const FLASH_PARK_Y = -50;

type Slot = {
  torso: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
  arms: [THREE.InstancedMesh, THREE.InstancedMesh];
};

export type ZombieBindings = {
  slots: Slot[];
  flash: THREE.InstancedMesh;
};

/**
 * Four InstancedMesh body parts (torso/head/armL/armR), `capacity` instances
 * each: the whole horde costs 4 draw calls instead of 4 per zombie. Plus one
 * InstancedMesh of telegraph ground-flash discs (5th draw call). Slot i owns
 * instance i of every part; poses compose into a scratch Object3D.
 */
export function createZombieMeshes(
  scene: THREE.Scene,
  capacity: number,
): ZombieBindings {
  const torsoGeo = new THREE.BoxGeometry(0.5, 0.9, 0.3);
  const headGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const armGeo = new THREE.BoxGeometry(0.14, 0.62, 0.14);
  const torsoMesh = new THREE.InstancedMesh(torsoGeo, TORSO_MAT, capacity);
  const headMesh = new THREE.InstancedMesh(headGeo, HEAD_MAT, capacity);
  const armLMesh = new THREE.InstancedMesh(armGeo, SKIN_MAT, capacity);
  const armRMesh = new THREE.InstancedMesh(armGeo, SKIN_MAT, capacity);
  for (const m of [torsoMesh, headMesh, armLMesh, armRMesh]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; // instances span the visible band
    scene.add(m);
  }
  const slots: Slot[] = [];
  for (let i = 0; i < capacity; i++) {
    slots.push({
      torso: torsoMesh,
      head: headMesh,
      arms: [armLMesh, armRMesh],
    });
  }

  // One InstancedMesh of flat telegraph flash discs, disc i bound to slot i.
  // Additive blending: instance color carries the whole pulse (black is
  // invisible), depthWrite off so discs never punch holes in the road glow.
  const flashGeo = new THREE.CircleGeometry(FLASH_BASE_R, 24);
  flashGeo.rotateX(-Math.PI / 2); // lie flat on the road
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, // instance color multiplies through
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flash = new THREE.InstancedMesh(flashGeo, flashMat, capacity);
  flash.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flash.frustumCulled = false; // instances span the visible band
  for (let i = 0; i < capacity; i++) {
    parkFlash(flash, i);
    flash.setColorAt(i, FLASH_BLACK_COLOR); // allocates the instanceColor buffer
  }
  scene.add(flash);

  return { slots, flash };
}

/**
 * Per-frame binding: compose every active zombie's part matrices from pool
 * state. Poses: cling — arms up gripping the car flank with a per-slot bob;
 * telegraph — squash to y*0.7 with a swelling ground flash beneath; dead —
 * tumble rotation and sink below the road; else upright sprint lean with
 * pumping arms. Slot i owns instance i of each part (stable indices); unused
 * instances park under the road.
 */
export function updateZombieMeshes(
  bindings: ZombieBindings,
  zombies: ZombiePool,
  carX: number,
  carZ: number,
  nowS: number,
): void {
  const parts = bindings.slots[0];
  const flash = bindings.flash;
  let used = 0;
  for (const z of zombies.allSlots()) {
    if (!z.active) continue;
    bind(parts, z, carX, carZ, nowS, used);
    bindFlash(flash, z, used);
    used++;
  }
  // Unused instances park under the road.
  for (let i = used; i < bindings.slots.length; i++) {
    hideInstance(parts, i);
    parkFlash(flash, i);
  }
  for (const m of [parts.torso, parts.head, parts.arms[0], parts.arms[1]]) {
    m.instanceMatrix.needsUpdate = true;
  }
  if (parts.torso.instanceColor) parts.torso.instanceColor.needsUpdate = true;
  flash.instanceMatrix.needsUpdate = true;
  if (flash.instanceColor) flash.instanceColor.needsUpdate = true;
}

/** Hides every zombie; called on run reset. */
export function resetZombieMeshes(bindings: ZombieBindings): void {
  const parts = bindings.slots[0];
  const flash = bindings.flash;
  for (let i = 0; i < bindings.slots.length; i++) {
    hideInstance(parts, i);
    parkFlash(flash, i);
    flash.setColorAt(i, FLASH_BLACK_COLOR);
  }
  for (const m of [parts.torso, parts.head, parts.arms[0], parts.arms[1]]) {
    m.instanceMatrix.needsUpdate = true;
  }
  flash.instanceMatrix.needsUpdate = true;
  if (flash.instanceColor) flash.instanceColor.needsUpdate = true;
}

/** Park flash instance i under the road so it never shades a pixel. */
function parkFlash(flash: THREE.InstancedMesh, i: number): void {
  SCRATCH.position.set(0, FLASH_PARK_Y, 0);
  SCRATCH.rotation.set(0, 0, 0);
  SCRATCH.scale.set(1, 1, 1);
  SCRATCH.updateMatrix();
  flash.setMatrixAt(i, SCRATCH.matrix);
}

/**
 * Pose flash instance i for zombie z: a ground disc that ignites at the start
 * of the telegraph and swells/brightens toward the leap, then vanishes the
 * moment the state leaves telegraphing (parked + black = invisible under
 * additive blending). Telegraphing zombies hold road-space x (only clingers
 * are car-relative), so no offset is needed.
 */
function bindFlash(
  flash: THREE.InstancedMesh,
  z: Zombie,
  index: number,
): void {
  if (z.state !== "telegraphing") {
    parkFlash(flash, index);
    flash.setColorAt(index, FLASH_BLACK_COLOR);
    return;
  }
  // 0 at telegraph entry → 1 at leap launch (clamped; the pool flips to
  // "leaping" inside the same step that carries telegraphT past the window).
  const t = Math.min(z.telegraphT / FLASH_TELEGRAPH_S, 1);
  const r = FLASH_BASE_R * (FLASH_SCALE_MIN + (FLASH_SCALE_MAX - FLASH_SCALE_MIN) * t);
  const bright = FLASH_BRIGHT_MIN + (1 - FLASH_BRIGHT_MIN) * t;
  SCRATCH.position.set(z.x, FLASH_Y, z.z);
  SCRATCH.rotation.set(0, 0, 0);
  SCRATCH.scale.set(r, 1, r);
  SCRATCH.updateMatrix();
  flash.setMatrixAt(index, SCRATCH.matrix);
  flash.setColorAt(
    index,
    FLASH_SCRATCH_COLOR.lerpColors(FLASH_BLACK_COLOR, FLASH_RED_COLOR, bright),
  );
}

/** Park instance i below the road so it never shades a pixel. */
function hideInstance(parts: Slot, i: number): void {
  SCRATCH.position.set(0, -50, 0);
  SCRATCH.rotation.set(0, 0, 0);
  SCRATCH.scale.set(1, 1, 1);
  SCRATCH.updateMatrix();
  parts.torso.setMatrixAt(i, SCRATCH.matrix);
  parts.head.setMatrixAt(i, SCRATCH.matrix);
  parts.arms[0].setMatrixAt(i, SCRATCH.matrix);
  parts.arms[1].setMatrixAt(i, SCRATCH.matrix);
}

function bind(
  slot: Slot,
  z: Zombie,
  carX: number,
  _carZ: number,
  nowS: number,
  index: number,
): void {
  slot.torso.setColorAt(index, TORSO_TINT[z.type]);
  const brute = z.type === "brute" ? BRUTE_SCALE : 1;
  // Pool x is car-relative for clingers (flank offset) and road-space for
  // everyone else; pool z is already world space (spawner/cling math).
  const worldX = z.state === "clinging" ? carX + z.x : z.x;
  SCRATCH.position.set(worldX, z.y, z.z);
  SCRATCH.rotation.set(0, 0, 0);
  SCRATCH.scale.set(brute, brute, brute);
  if (z.state === "telegraphing") SCRATCH.scale.y *= 0.7;

  // Arm pose per state; running pumps, clinging grips overhead.
  let armPitchL = 0.2;
  let armPitchR = -0.2;
  let armY = 1.05;
  if (z.state === "clinging") {
    // Arms up over the head gripping the hull; bob phase keyed by zombie id.
    SCRATCH.position.y += Math.max(Math.sin(nowS * 9 + z.id * 2.1) * 0.08, 0);
    armPitchL = Math.PI * 0.95;
    armPitchR = Math.PI * 0.95;
    armY = 1.55;
  } else if (z.state === "dead") {
    // Ragdoll: pitch/tumble by deathT, sinking under the road as it decays.
    SCRATCH.rotation.x = z.deathT * 6;
    SCRATCH.rotation.z = z.deathT * 3.5;
    SCRATCH.position.y -= Math.min(z.deathT / DEATH_TUMBLE_S, 1) * DEAD_SINK_M;
  } else {
    // Upright sprint: slight forward lean, arms pumping back in antiphase.
    const pump = Math.sin(nowS * 11 + z.id) * 0.63;
    armPitchL = pump;
    armPitchR = -pump;
    SCRATCH.rotation.x = 0.18;
  }

  SCRATCH.updateMatrix();
  slot.torso.setMatrixAt(index, SCRATCH.matrix);

  SCRATCH.position.y += 1.48;
  SCRATCH.updateMatrix();
  slot.head.setMatrixAt(index, SCRATCH.matrix);
  SCRATCH.position.y -= 1.48;

  placeArm(slot.arms[0], index, worldX + 0.34, armY, armPitchL);
  placeArm(slot.arms[1], index, worldX - 0.34, armY, armPitchR);
}

/** Compose one arm instance from its local offset relative to the torso base. */
function placeArm(
  mesh: THREE.InstancedMesh,
  index: number,
  x: number,
  y: number,
  pitch: number,
): void {
  SCRATCH.position.x = x;
  SCRATCH.position.y = y;
  SCRATCH.rotation.set(pitch, 0, 0);
  SCRATCH.updateMatrix();
  mesh.setMatrixAt(index, SCRATCH.matrix);
}
