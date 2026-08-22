import * as THREE from "three";
import type { ObstacleKind, ObstaclePool } from "../game/obstacles";

const WRECK_COLOR = 0x4a3a30;
const WRECK_ROOF_COLOR = 0x33261e;
const BARRIER_COLOR = 0x8a7a3a;
const STRIPE_COLOR = 0xd9b13b;

export type ObstacleBindings = {
  slots: {
    root: THREE.Group;
    wreck: THREE.Group;
    barrier: THREE.Group;
    kind: ObstacleKind;
  }[];
};

/**
 * One static mesh rig per pool slot. Wreck: rusted hulk box + darker cabin.
 * Barrier: long low fence plank + reflective stripe. update() toggles
 * visibility/kind and mutates transforms only.
 */
export function createObstacleMeshes(
  scene: THREE.Scene,
  capacity: number,
): ObstacleBindings {
  const wreckGeo = new THREE.BoxGeometry(2.4, 1.1, 4.4);
  const wreckCabinGeo = new THREE.BoxGeometry(2.0, 0.6, 1.6);
  const wreckMat = new THREE.MeshLambertMaterial({ color: WRECK_COLOR });
  const wreckCabinMat = new THREE.MeshLambertMaterial({
    color: WRECK_ROOF_COLOR,
  });
  const plankGeo = new THREE.BoxGeometry(6.8, 0.5, 1.2);
  const plankMat = new THREE.MeshLambertMaterial({ color: BARRIER_COLOR });
  const stripeGeo = new THREE.BoxGeometry(6.8, 0.16, 0.3);
  const stripeMat = new THREE.MeshBasicMaterial({ color: STRIPE_COLOR });

  const slots: ObstacleBindings["slots"] = [];
  for (let i = 0; i < capacity; i++) {
    const root = new THREE.Group();
    const wreck = new THREE.Group();
    const hull = new THREE.Mesh(wreckGeo, wreckMat);
    hull.position.y = 0.55;
    const cabin = new THREE.Mesh(wreckCabinGeo, wreckCabinMat);
    cabin.position.set(0, 1.35, -0.2);
    cabin.rotation.z = 0.06; // settled tilt
    wreck.add(hull, cabin);

    const barrier = new THREE.Group();
    const plank = new THREE.Mesh(plankGeo, plankMat);
    plank.position.y = 0.45;
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.y = 0.74;
    barrier.add(plank, stripe);

    root.add(wreck, barrier);
    root.visible = false;
    scene.add(root);
    slots.push({ root, wreck, barrier, kind: "wreck" });
  }
  return { slots };
}

/**
 * Per-frame binding: walk pool slots by index, show/pose the active ones.
 * (ObstaclePool exposes no index iterator, so active lookup is by scan —
 * capacity 16, allocation-free.)
 */
export function syncObstacleMeshes(
  bindings: ObstacleBindings,
  obstacles: ObstaclePool,
  carZ: number,
): void {
  let i = 0;
  obstacles.forEachNear(carZ - 200, carZ + 200, (o) => {
    const slot = bindings.slots[i++];
    if (!slot) return;
    slot.root.visible = true;
    slot.root.position.set(o.x, 0, o.z);
    const showWreck = o.kind === "wreck";
    slot.wreck.visible = showWreck;
    slot.barrier.visible = !showWreck;
  });
  for (; i < bindings.slots.length; i++) bindings.slots[i].root.visible = false;
}

/** Hides everything; called on run reset. */
export function resetObstacleMeshes(bindings: ObstacleBindings): void {
  for (const slot of bindings.slots) slot.root.visible = false;
}
