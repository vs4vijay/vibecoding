import * as THREE from "three";
import type { Zombie, ZombiePool, ZombieType } from "../game/zombies";

// Death tumble duration mirrors ZombiePool's internal DEATH_TUMBLE_S (=1 s).
const DEATH_TUMBLE_S = 1;
/** Sink depth reached at the end of the death tumble. */
const DEAD_SINK_M = 1.6;
const BRUTE_SCALE = 1.5;
const HEAD_COLOR = 0x93a06a;
const SKIN_COLOR = 0x5f7350;
const HEAD_MAT = new THREE.MeshLambertMaterial({ color: HEAD_COLOR });
const SKIN_MAT = new THREE.MeshLambertMaterial({ color: SKIN_COLOR });

const TORSO_COLOR: Record<ZombieType, number> = {
  walker: 0x6b7d4f,
  runner: 0x7d8b4a,
  brute: 0x8b3a2e,
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

type Slot = {
  torso: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
  arms: [THREE.InstancedMesh, THREE.InstancedMesh];
};

export type ZombieBindings = {
  slots: Slot[];
};

/**
 * Four InstancedMesh body parts (torso/head/armL/armR), `capacity` instances
 * each: the whole horde costs 4 draw calls instead of 4 per zombie. Slot i
 * owns instance i of every part; poses compose into a scratch Object3D.
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
  return { slots };
}

/**
 * Per-frame binding: compose every active zombie's part matrices from pool
 * state. Poses: cling — arms up gripping the car flank with a per-slot bob;
 * telegraph — squash to y*0.7; dead — tumble rotation and sink below the
 * road; else upright sprint lean with pumping arms. Slot i owns instance i
 * of each part (stable indices); unused instances park under the road.
 */
export function updateZombieMeshes(
  bindings: ZombieBindings,
  zombies: ZombiePool,
  carX: number,
  carZ: number,
  nowS: number,
): void {
  const parts = bindings.slots[0];
  let used = 0;
  for (const z of zombies.allSlots()) {
    if (!z.active) continue;
    bind(parts, z, carX, carZ, nowS, used);
    used++;
  }
  // Unused instances park under the road.
  for (let i = used; i < bindings.slots.length; i++) {
    hideInstance(parts, i);
  }
  for (const m of [parts.torso, parts.head, parts.arms[0], parts.arms[1]]) {
    m.instanceMatrix.needsUpdate = true;
  }
  if (parts.torso.instanceColor) parts.torso.instanceColor.needsUpdate = true;
}

/** Hides every zombie; called on run reset. */
export function resetZombieMeshes(bindings: ZombieBindings): void {
  const parts = bindings.slots[0];
  for (let i = 0; i < bindings.slots.length; i++) hideInstance(parts, i);
  for (const m of [parts.torso, parts.head, parts.arms[0], parts.arms[1]]) {
    m.instanceMatrix.needsUpdate = true;
  }
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
