import * as THREE from "three";
import type { Zombie, ZombiePool, ZombieType } from "../game/zombies";

// Death tumble duration mirrors ZombiePool's internal DEATH_TUMBLE_S (=1 s).
const DEATH_TUMBLE_S = 1;
/** Sink depth reached at the end of the death tumble. */
const DEAD_SINK_M = 1.6;
const BRUTE_SCALE = 1.5;
const HEAD_COLOR = 0x93a06a;
const SKIN_COLOR = 0x5f7350;

const TORSO_COLOR: Record<ZombieType, number> = {
  walker: 0x6b7d4f,
  runner: 0x7d8b4a,
  brute: 0x8b3a2e,
};

const TORSO_MAT: Record<ZombieType, THREE.MeshLambertMaterial> = {
  walker: new THREE.MeshLambertMaterial({ color: TORSO_COLOR.walker }),
  runner: new THREE.MeshLambertMaterial({ color: TORSO_COLOR.runner }),
  brute: new THREE.MeshLambertMaterial({ color: TORSO_COLOR.brute }),
};

type Slot = {
  root: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  arms: THREE.Mesh[];
};

export type ZombieBindings = {
  slots: Slot[];
};

/**
 * One static mesh rig per pool slot (stable objects — bind once, mutate
 * transforms after). Torso + head + two arm boxes; brute slots scale 1.5.
 */
export function createZombieMeshes(
  scene: THREE.Scene,
  capacity: number,
): ZombieBindings {
  const torsoGeo = new THREE.BoxGeometry(0.5, 0.9, 0.3);
  const headGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const armGeo = new THREE.BoxGeometry(0.14, 0.62, 0.14);

  const headMat = new THREE.MeshLambertMaterial({ color: HEAD_COLOR });
  const skinMat = new THREE.MeshLambertMaterial({ color: SKIN_COLOR });

  const slots: Slot[] = [];
  for (let i = 0; i < capacity; i++) {
    const root = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, TORSO_MAT.walker);
    torso.position.y = 0.85;
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.48;
    const armL = new THREE.Mesh(armGeo, skinMat);
    const armR = new THREE.Mesh(armGeo, skinMat);
    armL.position.set(-0.34, 1.15, 0);
    armR.position.set(0.34, 1.15, 0);
    root.add(torso, head, armL, armR);
    root.visible = false;
    scene.add(root);
    slots.push({ root, torso, head, arms: [armL, armR] });
  }
  return { slots };
}

/**
 * Per-frame binding for every slot. Poses:
 * cling — arms up gripping the car flank with a per-slot bob; telegraph —
 * squash to y*0.7; dead — tumble rotation and sink below the road; else
 * upright sprint lean with pumping arms.
 *
 * Pool x/z are car-relative; placed into world space around (carX, carZ).
 * Iterates pool order so slot i always binds pool slot i (stable indices).
 */
export function updateZombieMeshes(
  bindings: ZombieBindings,
  zombies: ZombiePool,
  carX: number,
  carZ: number,
  nowS: number,
): void {
  let i = 0;
  for (const z of zombies.allSlots()) bind(bindings.slots[i++], z, carX, carZ, nowS);
  for (; i < bindings.slots.length; i++) bindings.slots[i].root.visible = false;
}
/** Hides every slot; called on run reset. */
export function resetZombieMeshes(bindings: ZombieBindings): void {
  for (const slot of bindings.slots) slot.root.visible = false;
}

function bind(
  slot: Slot,
  z: Zombie,
  carX: number,
  _carZ: number,
  nowS: number,
): void {
  if (!z.active) {
    slot.root.visible = false;
    return;
  }
  slot.root.visible = true;
  slot.torso.material = TORSO_MAT[z.type];
  const brute = z.type === "brute" ? BRUTE_SCALE : 1;
  // Pool x is car-relative for clingers (flank offset) and road-space for
  // everyone else; pool z is already world space (spawner/cling math).
  const worldX = z.state === "clinging" ? carX + z.x : z.x;
  slot.root.position.set(worldX, z.y, z.z);
  slot.root.scale.set(brute, brute, brute);
  slot.root.rotation.set(0, 0, 0);
  if (z.state === "clinging") {
    poseClinging(slot, z, nowS);
  } else if (z.state === "dead") {
    poseDead(slot, z);
  } else {
    poseRunning(slot, z, nowS);
    if (z.state === "telegraphing") slot.root.scale.y *= 0.7;
  }
}

function poseClinging(slot: Slot, z: Zombie, nowS: number): void {
  // Arms up over the head gripping the hull; bob phase keyed by zombie id.
  slot.root.position.y += Math.max(Math.sin(nowS * 9 + z.id * 2.1) * 0.08, 0);
  for (const arm of slot.arms) {
    arm.rotation.set(Math.PI * 0.95, 0, 0);
    arm.position.y = 1.55;
  }
  slot.head.rotation.x = -0.25;
}

/** Ragdoll: pitch/tumble by deathT, sinking under the road as it decays. */
function poseDead(slot: Slot, z: Zombie): void {
  slot.root.rotation.x = z.deathT * 6;
  slot.root.rotation.z = z.deathT * 3.5;
  slot.root.position.y -= Math.min(z.deathT / DEATH_TUMBLE_S, 1) * DEAD_SINK_M;
}

/** Upright sprint: slight forward lean, arms pumping back. */
function poseRunning(slot: Slot, z: Zombie, nowS: number): void {
  const pump = Math.sin(nowS * 11 + z.id) * 0.7;
  slot.arms[0].rotation.set(pump * 0.9, 0, 0.2);
  slot.arms[1].rotation.set(-pump * 0.9, 0, -0.2);
  slot.arms[0].position.y = 1.05;
  slot.arms[1].position.y = 1.05;
  slot.head.rotation.x = 0;
  slot.root.rotation.x = 0.18;
}
