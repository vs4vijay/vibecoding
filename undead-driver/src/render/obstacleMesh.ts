import * as THREE from "three";
import { CONFIG } from "../config";
import type { ObstacleKind, ObstaclePool } from "../game/obstacles";

// Albedos sit well above the 0x2b2b31 road so hazards read at ~90 m through
// dusk fog (0x3a2012, near 60 / far 160 → ~30% fogged at that range).
const WRECK_COLOR = 0x6f5a4a;
const WRECK_ROOF_COLOR = 0x4d3d31;
const BARRIER_COLOR = 0x9c8f5c;
const STRIPE_COLOR = 0xd9b13b;

// Chevron face markings: unlit high-contrast pair (same lamp trick as the
// car's MeshBasicMaterial lights — full albedo regardless of scene lighting).
const CHEVRON_ORANGE = 0xff7a1a;
const CHEVRON_OFFWHITE = 0xf2ead8;
// Rear brake lights, matching the car tail-light red.
const BRAKE_LIGHT_COLOR = 0xff2a1a;

// Warning rings: one flat additive ring per obstacle slot on the road. With
// AdditiveBlending the per-instance color IS the fade (black adds nothing), so
// proximity just lerps black→red — no per-instance opacity. Outer radius clears
// the widest footprint (barrier halfW 3.4 → corner radius ≈3.45); y sits just
// above the road to avoid z-fighting.
const RING_INNER_R = 3.5;
const RING_OUTER_R = 4.2;
const RING_Y = 0.04;
const RING_RED = 0xff2418;
const RING_RED_COLOR = new THREE.Color(RING_RED);
const RING_BLACK_COLOR = new THREE.Color(0x000000);
/** Shared scratch color for the black→red proximity lerp (no allocation). */
const RING_SCRATCH_COLOR = new THREE.Color();
/** Shared scratch transform for composing ring instance matrices. */
const RING_SCRATCH = new THREE.Object3D();
/** Parking depth under the road, matching the zombie parts' hidden slot. */
const RING_PARK_Y = -50;

/**
 * Ring intensity for an obstacle at world z relative to the car: 1 adjacent,
 * fading linearly to 0 at warnDist, clamped. Pure; exported for tests.
 */
export function obstacleWarnT(z: number, carZ: number, warnDist: number): number {
  const t = 1 - (z - carZ) / warnDist;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export type ObstacleBindings = {
  slots: {
    root: THREE.Group;
    wreck: THREE.Group;
    barrier: THREE.Group;
    kind: ObstacleKind;
  }[];
  rings: THREE.InstancedMesh;
};

/** Point in the barrier-face plane (x right, y up); z is fixed per vertex. */
type Pt = { x: number; y: number };

/**
 * Barrier car-facing rectangle, inset from the plank face (z = -0.6) so the
 * base frame shows and the quads never z-fight. +z is the car's travel
 * direction, so the face the player sees is the plank's -z side.
 */
const CHEV_X0 = -3.36;
const CHEV_X1 = 3.36;
const CHEV_Y0 = 0.22;
const CHEV_Y1 = 0.68;
const CHEV_Z = -0.62;
const CHEV_PERIOD = 0.85;
const CHEV_SHEAR = 0.5; // 45° lean across the 0.46 m face height, roughly

/** Sutherland–Hodgman clip of a convex polygon against X0 <= x <= X1. */
function clipBandX(poly: Pt[], x0: number, x1: number): Pt[] {
  let out = poly;
  const passes: { limit: number; keepGe: boolean }[] = [
    { limit: x0, keepGe: true },
    { limit: x1, keepGe: false },
  ];
  for (const { limit, keepGe } of passes) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      const b = src[(i + 1) % src.length];
      const aIn = keepGe ? a.x >= limit : a.x <= limit;
      const bIn = keepGe ? b.x >= limit : b.x <= limit;
      if (bIn) {
        if (!aIn) out.push(liftToX(a, b, limit));
        out.push(b);
      } else if (aIn) {
        out.push(liftToX(a, b, limit));
      }
    }
    if (out.length < 3) return [];
  }
  return out;
}

/** Intersection of edge a→b with the vertical line x = limit. */
function liftToX(a: Pt, b: Pt, limit: number): Pt {
  const t = (limit - a.x) / (b.x - a.x);
  return { x: limit, y: a.y + (b.y - a.y) * t };
}

/**
 * Build-time: alternating diagonal chevron stripes across the barrier face as
 * ONE vertex-colored geometry (orange/off-white parallelograms, exactly clipped
 * to the face) → a single extra draw call per barrier.
 */
function buildChevronFace(): THREE.BufferGeometry {
  const orange = new THREE.Color(CHEVRON_ORANGE);
  const white = new THREE.Color(CHEVRON_OFFWHITE);
  const pos: number[] = [];
  const col: number[] = [];
  // Half-period stripes alternate, so together they tile the face exactly.
  const half = CHEV_PERIOD / 2;
  // One extra half-stripe of overhang each way so clipping fills both ends.
  const kStart = Math.floor((CHEV_X0 - CHEV_SHEAR) / half) - 1;
  const kEnd = Math.ceil(CHEV_X1 / half) + 1;
  for (let k = kStart; k <= kEnd; k++) {
    const xb = k * half;
    const color = ((k % 2) + 2) % 2 === 0 ? orange : white;
    // CCW in XY: bottom-left → bottom-right → top-right → top-left.
    const poly = clipBandX(
      [
        { x: xb, y: CHEV_Y0 },
        { x: xb + half, y: CHEV_Y0 },
        { x: xb + half + CHEV_SHEAR, y: CHEV_Y1 },
        { x: xb + CHEV_SHEAR, y: CHEV_Y1 },
      ],
      CHEV_X0,
      CHEV_X1,
    );
    for (let i = 1; i + 1 < poly.length; i++) {
      // Reversed fan winding → normals face -z, toward the chase camera.
      const fan = [poly[0], poly[i + 1], poly[i]];
      for (const p of fan) {
        pos.push(p.x, p.y, CHEV_Z);
        col.push(color.r, color.g, color.b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/**
 * Build-time: the wreck's two rear brake lights merged into ONE geometry
 * (boxes protruding 0.04 from the hull's -z rear face) → one extra draw per
 * wreck. Position-only concat, the same minimal pattern world.ts uses.
 */
function buildBrakeLights(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-0.78, 0.78]) {
    const geo = new THREE.BoxGeometry(0.34, 0.18, 0.08);
    geo.translate(sx, 0.7, -2.2); // hull rear face is at z = -2.2
    parts.push(geo.toNonIndexed());
  }
  const total = parts.reduce((n, g) => n + g.getAttribute("position").count, 0);
  const merged = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    merged.set(g.getAttribute("position").array as Float32Array, o);
    o += g.getAttribute("position").array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(merged, 3));
  out.computeVertexNormals();
  for (const g of parts) g.dispose();
  return out;
}

/**
 * One static mesh rig per pool slot. Wreck: brightened rusted hulk box + cabin
 * + emissive rear brake lights. Barrier: long low fence plank + reflective top
 * stripe + high-contrast chevron face. update() toggles visibility/kind and
 * mutates transforms only. Also builds ONE InstancedMesh of proximity warning
 * rings (ring i ↔ slot i, additive, black→red by gap to the car).
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
  const brakeGeo = buildBrakeLights();
  const brakeMat = new THREE.MeshBasicMaterial({ color: BRAKE_LIGHT_COLOR });
  const plankGeo = new THREE.BoxGeometry(6.8, 0.5, 1.2);
  const plankMat = new THREE.MeshLambertMaterial({ color: BARRIER_COLOR });
  const stripeGeo = new THREE.BoxGeometry(6.8, 0.16, 0.3);
  const stripeMat = new THREE.MeshBasicMaterial({ color: STRIPE_COLOR });
  const chevronGeo = buildChevronFace();
  const chevronMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  const slots: ObstacleBindings["slots"] = [];
  for (let i = 0; i < capacity; i++) {
    const root = new THREE.Group();
    const wreck = new THREE.Group();
    const hull = new THREE.Mesh(wreckGeo, wreckMat);
    hull.position.y = 0.55;
    const cabin = new THREE.Mesh(wreckCabinGeo, wreckCabinMat);
    cabin.position.set(0, 1.35, -0.2);
    cabin.rotation.z = 0.06; // settled tilt
    const brakes = new THREE.Mesh(brakeGeo, brakeMat);
    wreck.add(hull, cabin, brakes);

    const barrier = new THREE.Group();
    const plank = new THREE.Mesh(plankGeo, plankMat);
    plank.position.y = 0.45;
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.y = 0.74;
    const chevrons = new THREE.Mesh(chevronGeo, chevronMat);
    barrier.add(plank, stripe, chevrons);

    root.add(wreck, barrier);
    root.visible = false;
    scene.add(root);
    slots.push({ root, wreck, barrier, kind: "wreck" });
  }

  // One InstancedMesh of flat warning rings, ring i bound to slot i. Additive
  // blending: instance color carries the whole fade, depthWrite off so hazards
  // never punch holes in each other's glow.
  const ringGeo = new THREE.RingGeometry(RING_INNER_R, RING_OUTER_R, 40);
  ringGeo.rotateX(-Math.PI / 2); // lie flat on the road
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, // instance color multiplies through
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, capacity);
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rings.frustumCulled = false; // instances span the visible band
  for (let i = 0; i < capacity; i++) {
    parkRing(rings, i);
    rings.setColorAt(i, RING_BLACK_COLOR); // allocates the instanceColor buffer
  }
  scene.add(rings);

  return { slots, rings };
}

/** Park ring instance i under the road so it never shades a pixel. */
function parkRing(rings: THREE.InstancedMesh, i: number): void {
  RING_SCRATCH.position.set(0, RING_PARK_Y, 0);
  RING_SCRATCH.rotation.set(0, 0, 0);
  RING_SCRATCH.scale.set(1, 1, 1);
  RING_SCRATCH.updateMatrix();
  rings.setMatrixAt(i, RING_SCRATCH.matrix);
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
    bindRing(bindings.rings, i - 1, o, carZ);
  });
  for (; i < bindings.slots.length; i++) {
    bindings.slots[i].root.visible = false;
    parkRing(bindings.rings, i);
    bindings.rings.setColorAt(i, RING_BLACK_COLOR);
  }
  bindings.rings.instanceMatrix.needsUpdate = true;
  if (bindings.rings.instanceColor) bindings.rings.instanceColor.needsUpdate = true;
}

/** Pose ring instance i for obstacle o: glow by proximity, park when cold. */
function bindRing(
  rings: THREE.InstancedMesh,
  i: number,
  o: { x: number; z: number },
  carZ: number,
): void {
  const t = obstacleWarnT(o.z, carZ, CONFIG.readability.obstacleWarnDist);
  if (t > 0) {
    RING_SCRATCH.position.set(o.x, RING_Y, o.z);
    RING_SCRATCH.rotation.set(0, 0, 0);
    RING_SCRATCH.scale.set(1, 1, 1);
    RING_SCRATCH.updateMatrix();
    rings.setMatrixAt(i, RING_SCRATCH.matrix);
    rings.setColorAt(i, RING_SCRATCH_COLOR.lerpColors(RING_BLACK_COLOR, RING_RED_COLOR, t));
  } else {
    parkRing(rings, i);
    rings.setColorAt(i, RING_BLACK_COLOR);
  }
}

/** Hides everything; called on run reset. */
export function resetObstacleMeshes(bindings: ObstacleBindings): void {
  for (const slot of bindings.slots) slot.root.visible = false;
  for (let i = 0; i < bindings.slots.length; i++) {
    parkRing(bindings.rings, i);
    bindings.rings.setColorAt(i, RING_BLACK_COLOR);
  }
  bindings.rings.instanceMatrix.needsUpdate = true;
  if (bindings.rings.instanceColor) bindings.rings.instanceColor.needsUpdate = true;
}
