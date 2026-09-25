import * as THREE from 'three';

import { ACCENTS, NON_ACCENT_COLORS } from '../render/tuning';
import type { Entity, EntityVisual, SpawnType } from './Entity';

/**
 * Code-built meshes for the entity roster — primitives + emissive materials
 * only, per the art spec. Geometry and materials are shared module
 * singletons: building an entity visual allocates a few THREE.Objects and a
 * closure, never a buffer, so a full level load stays cheap and retries reuse
 * the exact same pool (no per-frame allocation anywhere).
 *
 * Color language: cyan = good (packages, jump pods), magenta = bad (slugs,
 * asteroids), red/pink = health (hearts), white/yellow = reward rings, red =
 * the trap ring, per spec. The three rings also carry distinct SHAPE cues so
 * color-blind players can tell them apart: white = smooth single rim, yellow
 * = dashed outer outline, red = double rim (plus its smaller lane-placed size).
 */

// Colors come from the shared render-tuning envelope (src/render/tuning.ts);
// sRGB-sourced tuples declare their color space so the Color ends up exactly
// as the hex literals they replace.
const PACKAGE_COLOR = new THREE.Color().setRGB(...NON_ACCENT_COLORS.package, THREE.SRGBColorSpace);
const PACKAGE_RIBBON_COLOR = new THREE.Color(...ACCENTS.packageRibbon.color); // overdriven → feeds bloom
const HEART_COLOR = 0xff4f7d; // not in the tuning envelope — stays local
const HEART_GLOW = new THREE.Color(...ACCENTS.heart.color);
const SLUG_COLOR = 0xd81fb5; // not in the tuning envelope — stays local
const SLUG_GLOW = new THREE.Color(...ACCENTS.slug.color);
const ASTEROID_COLOR = new THREE.Color().setRGB(...NON_ACCENT_COLORS.asteroid, THREE.SRGBColorSpace);
const ASTEROID_GLOW = new THREE.Color(...ACCENTS.asteroidWire.color); // magenta hazard rim
const WHITE_RING_COLOR = new THREE.Color(...ACCENTS.whiteRing.color); // overdriven white
const YELLOW_RING_COLOR = new THREE.Color(...ACCENTS.yellowRing.color); // overdriven yellow
const RED_RING_COLOR = new THREE.Color(...ACCENTS.redRing.color); // overdriven red — the trap
const POD_GLOW = new THREE.Color(...ACCENTS.pod.color); // overdriven cyan — the good launch

/** How far floating pickups hover above the road surface. */
const PACKAGE_HOVER = 1.25;
const HEART_HOVER = 1.35;
/** Center height of the road-spanning rings (bottom half hides under the road → arch). */
const RING_HOVER = 1.15;
const RING_RADIUS = 7.4;
const RING_TUBE = 0.3;
/** Red trap ring: smaller, lane-placed, dodgeable (gameplay radius 4.2). */
const RED_RING_RADIUS = 4.2;
/** Jump pod launch strip: spans the road, slightly longer than the road width. */
const POD_STRIP_WIDTH = 14.6;
const POD_STRIP_LENGTH = 6;
/** Asteroid visual radius (gameplay radius 3.0; the rock sits a touch smaller). */
const ASTEROID_RADIUS = 2.7;
/** Precomputed rock shapes — variant selection is driven by the entity seed. */
const ASTEROID_VARIANTS = 4;
const ASTEROID_WIRE_SCALE = 1.03;

// -- Shared geometry/material singletons (created once per process). --------

const packageGeometry = new THREE.BoxGeometry(1.0, 1.0, 1.0);
const packageRibbonGeometry = new THREE.BoxGeometry(1.08, 0.18, 0.22);
const packageRibbonGeometry2 = new THREE.BoxGeometry(0.22, 0.18, 1.08);
const packageMaterial = new THREE.MeshStandardMaterial({
  color: PACKAGE_COLOR,
  emissive: new THREE.Color(PACKAGE_COLOR).multiplyScalar(0.55),
  roughness: 0.35,
  metalness: 0.25,
});
const ribbonMaterial = new THREE.MeshBasicMaterial({ color: PACKAGE_RIBBON_COLOR });

const heartMaterial = new THREE.MeshStandardMaterial({
  color: HEART_COLOR,
  emissive: HEART_GLOW.clone().multiplyScalar(0.35),
  roughness: 0.3,
  metalness: 0.1,
});
const heartGlowMaterial = new THREE.MeshBasicMaterial({ color: HEART_GLOW });

const slugMaterial = new THREE.MeshStandardMaterial({
  color: SLUG_COLOR,
  emissive: SLUG_GLOW.clone().multiplyScalar(0.5),
  roughness: 0.4,
  metalness: 0.2,
});
const slugEyeMaterial = new THREE.MeshBasicMaterial({ color: SLUG_GLOW });

/** Classic bezier heart, extruded and centered; built once. */
function createHeartGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0.25, 0.25);
  shape.bezierCurveTo(0.25, 0.25, 0.2, 0, 0, 0);
  shape.bezierCurveTo(-0.3, 0, -0.3, 0.35, -0.3, 0.35);
  shape.bezierCurveTo(-0.3, 0.55, -0.1, 0.77, 0.25, 0.95);
  shape.bezierCurveTo(0.6, 0.77, 0.8, 0.55, 0.8, 0.35);
  shape.bezierCurveTo(0.8, 0.35, 0.8, 0, 0.5, 0);
  shape.bezierCurveTo(0.35, 0, 0.25, 0.25, 0.25, 0.25);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geometry.center();
  geometry.scale(1.35, 1.35, 1.35);
  return geometry;
}

const heartGeometry = createHeartGeometry();
const heartHaloGeometry = new THREE.SphereGeometry(0.95, 14, 10);

const slugBodyGeometry = new THREE.CapsuleGeometry(0.55, 0.9, 6, 20);
const slugStalkGeometry = new THREE.CylinderGeometry(0.05, 0.08, 0.4, 6);
const slugEyeGeometry = new THREE.SphereGeometry(0.11, 10, 8);

const ringGeometry = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 12, 56);
const redRingGeometry = new THREE.TorusGeometry(RED_RING_RADIUS, RING_TUBE, 12, 44);
const whiteRingMaterial = new THREE.MeshBasicMaterial({ color: WHITE_RING_COLOR });
const yellowRingMaterial = new THREE.MeshBasicMaterial({ color: YELLOW_RING_COLOR });
const redRingMaterial = new THREE.MeshBasicMaterial({ color: RED_RING_COLOR });

// -- Color-blind-safe shape language (in addition to color, per Phase 6). ----
// The three rings are told apart by SILHOUETTE as well as hue:
//   white  — smooth single rim (the plain arch: ladder up)
//   yellow — dashed outer outline of radial ticks (smart bomb)
//   red    — double rim, inner + outer torus (the trap)
const RING_DASH_COUNT = 22;
const ringDashGeometry = new THREE.BoxGeometry(0.72, 0.16, 0.3); // long axis = tangential
const ringDashMaterial = new THREE.MeshBasicMaterial({ color: YELLOW_RING_COLOR });
const redRingInnerGeometry = new THREE.TorusGeometry(RED_RING_RADIUS - 0.85, RING_TUBE * 0.45, 8, 44);

/** Radial tick ring following the torus's outer edge (yellow ring's dashes). */
function createRingDashes(): THREE.Group {
  const dashes = new THREE.Group();
  dashes.name = 'ring-dashes';
  const radius = RING_RADIUS + RING_TUBE + 0.3;
  for (let i = 0; i < RING_DASH_COUNT; i += 1) {
    const angle = (i / RING_DASH_COUNT) * Math.PI * 2;
    const dash = new THREE.Mesh(ringDashGeometry, ringDashMaterial);
    dash.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    dash.rotation.z = angle + Math.PI / 2; // long axis tangent to the circle
    dashes.add(dash);
  }
  return dashes;
}

const podStripGeometry = new THREE.PlaneGeometry(POD_STRIP_WIDTH, POD_STRIP_LENGTH);
podStripGeometry.rotateX(-Math.PI / 2); // lie flat on the road (normal +Y)
const podStripMaterial = new THREE.MeshBasicMaterial({
  color: POD_GLOW,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const podChevronGeometry = new THREE.ConeGeometry(0.55, 1.2, 4);
const podChevronMaterial = new THREE.MeshBasicMaterial({ color: POD_GLOW });

// -- Asteroid rock shapes: precomputed, deterministic, shared. ---------------

/**
 * Position-hashed pseudo noise in [0, 1]. Duplicate vertices share exact
 * coordinates, so a pure function of position keeps the rock watertight.
 */
function rockNoise(x: number, y: number, z: number, seed: number): number {
  const d = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 0.6180339) * 43758.5453;
  return d - Math.floor(d);
}

/** Displaces one icosahedron into a craggy rock (two octaves, seeded). */
function createRockGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(ASTEROID_RADIUS, 1);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < positions.count; i += 1) {
    vertex.fromBufferAttribute(positions, i);
    const dir = vertex.clone().normalize();
    // Quantize the direction so the two noise octaves are stable per vertex.
    const n1 = rockNoise(Math.round(dir.x * 8), Math.round(dir.y * 8), Math.round(dir.z * 8), seed);
    const n2 = rockNoise(Math.round(dir.x * 19), Math.round(dir.y * 19), Math.round(dir.z * 19), seed + 7);
    const displacement = 1 + (0.62 * n1 + 0.38 * n2 - 0.5) * 0.62;
    vertex.copy(dir).multiplyScalar(ASTEROID_RADIUS * displacement);
    positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

const rockGeometries: readonly THREE.BufferGeometry[] = Array.from(
  { length: ASTEROID_VARIANTS },
  (_, index) => createRockGeometry(index * 1013904223 + 1),
);

const rockMaterial = new THREE.MeshStandardMaterial({
  color: ASTEROID_COLOR,
  emissive: new THREE.Color(ASTEROID_COLOR).multiplyScalar(0.18),
  roughness: 0.85,
  metalness: 0.15,
  flatShading: true, // faceted rock silhouette against the neon road
});
const rockWireMaterial = new THREE.MeshBasicMaterial({
  color: ASTEROID_GLOW,
  wireframe: true,
  transparent: true,
  opacity: 0.42,
});

/**
 * Shared animation scaffolding: every visual owns an inner pivot the Spawner
 * never touches, plus a decaying `pop` burst for pickup feedback.
 */
abstract class PopVisual implements EntityVisual {
  public readonly object = new THREE.Group();
  public readonly pivot = new THREE.Group();

  private popT = 0;
  private readonly baseScale = new THREE.Vector3(1, 1, 1);

  protected constructor() {
    this.object.add(this.pivot);
  }

  /** Sets the scale the pivot rests at (used to size hearts vs packages). */
  protected setBaseScale(scale: number): void {
    this.baseScale.setScalar(scale);
    this.pivot.scale.copy(this.baseScale);
  }

  public pop(): void {
    this.popT = 1;
  }

  /** Lets the pop burst decay; returns the current scale multiplier. */
  protected advancePop(dt: number): number {
    if (this.popT > 0) {
      this.popT = Math.max(0, this.popT - dt * 4.5);
    }
    return 1 + 0.65 * this.popT * this.popT;
  }

  protected applyScale(multiplier: number): void {
    this.pivot.scale.copy(this.baseScale).multiplyScalar(multiplier);
  }

  public abstract update(dt: number, elapsed: number): void;
}

// -- Package: cyan box with a ribbon, gentle spin + bob. ---------------------

class PackageVisual extends PopVisual {
  private readonly hover: number;

  constructor() {
    super();
    this.hover = PACKAGE_HOVER;

    const box = new THREE.Mesh(packageGeometry, packageMaterial);
    box.name = 'package-box';
    const ribbonA = new THREE.Mesh(packageRibbonGeometry, ribbonMaterial);
    const ribbonB = new THREE.Mesh(packageRibbonGeometry2, ribbonMaterial);
    this.pivot.add(box, ribbonA, ribbonB);
    this.pivot.position.y = this.hover;
    this.setBaseScale(1);
  }

  public update(dt: number, elapsed: number): void {
    this.pivot.rotation.y = elapsed * 1.7;
    this.pivot.position.y = this.hover + Math.sin(elapsed * 2.6) * 0.16;
    this.applyScale(this.advancePop(dt));
  }
}

// -- Heart: extruded heart primitive, pulse. ---------------------------------

class HeartVisual extends PopVisual {
  private readonly hover: number;

  constructor() {
    super();
    this.hover = HEART_HOVER;

    const heart = new THREE.Mesh(heartGeometry, heartMaterial);
    heart.name = 'heart-body';
    const halo = new THREE.Mesh(heartHaloGeometry, heartGlowMaterial);
    halo.name = 'heart-halo';
    halo.scale.set(1, 1, 0.35); // flat glow disc behind the heart
    halo.position.z = -0.35;
    this.pivot.add(heart, halo);
    this.pivot.position.y = this.hover;
    // ExtrudeGeometry is built in the XY plane; tip already points down after
    // the shape above — angle it to face the incoming player slightly.
    this.pivot.rotation.x = -0.25;
    this.setBaseScale(1);
  }

  public update(dt: number, elapsed: number): void {
    this.pivot.rotation.y = Math.sin(elapsed * 1.4) * 0.45;
    this.pivot.position.y = this.hover + Math.sin(elapsed * 3.4) * 0.12;
    this.applyScale(this.advancePop(dt) * (1 + 0.12 * Math.sin(elapsed * 4.2)));
  }
}

// -- Slug: squashed magenta capsule with an animated slither. -----------------

class SlugVisual extends PopVisual {
  constructor() {
    super();
    // lie along local z (forward), squash y so it hugs the road
    const body = new THREE.Mesh(slugBodyGeometry, slugMaterial);
    body.name = 'slug-body';
    body.rotation.x = -Math.PI / 2;
    body.scale.set(1, 0.55, 1);
    body.position.y = 0.3;
    this.pivot.add(body);

    for (const side of [-1, 1] as const) {
      const stalk = new THREE.Mesh(slugStalkGeometry, slugMaterial);
      stalk.position.set(side * 0.22, 0.5, -0.55);
      stalk.rotation.set(-0.5, 0, -side * 0.4);
      const eye = new THREE.Mesh(slugEyeGeometry, slugEyeMaterial);
      eye.position.y = 0.24;
      stalk.add(eye);
      this.pivot.add(stalk);
    }

    this.setBaseScale(1);
  }

  public update(dt: number, elapsed: number): void {
    const slither = Math.sin(elapsed * 6);
    this.pivot.scale.set(1 + 0.14 * slither, 1, 1 - 0.14 * slither);
    this.pivot.rotation.z = Math.sin(elapsed * 3) * 0.09;
    this.pivot.rotation.y = Math.sin(elapsed * 1.1) * 0.12;
    this.pivot.position.y = 0.06 * Math.abs(Math.sin(elapsed * 6));
    this.applyScale(this.advancePop(dt));
  }
}

// -- Asteroid: noise-displaced rock with a magenta hazard rim, slow tumble. --

class AsteroidVisual extends PopVisual {
  private readonly spinX: number;
  private readonly spinZ: number;

  constructor(seed: number) {
    super();
    const geometry = rockGeometries[seed % ASTEROID_VARIANTS];
    const rock = new THREE.Mesh(geometry, rockMaterial);
    rock.name = 'asteroid-rock';
    const wire = new THREE.Mesh(geometry, rockWireMaterial);
    wire.name = 'asteroid-rim';
    wire.scale.setScalar(ASTEROID_WIRE_SCALE);
    this.pivot.add(rock, wire);
    // Sink slightly into the road so the rock reads as resting, not floating.
    this.pivot.position.y = ASTEROID_RADIUS * 0.42;
    // Per-instance variation: scale + tumble axis/speed from the stable seed.
    const scale = 0.92 + ((seed >>> 8) % 24) / 100;
    this.setBaseScale(scale);
    this.spinX = 0.12 + ((seed >>> 3) % 18) / 100;
    this.spinZ = 0.08 + ((seed >>> 12) % 14) / 100;
  }

  public update(dt: number, elapsed: number): void {
    this.pivot.rotation.x = elapsed * this.spinX;
    this.pivot.rotation.z = elapsed * this.spinZ;
    this.applyScale(this.advancePop(dt));
  }
}

// -- Rings: road-spanning tori (bottom half under the road → glowing arch). --
// Shape cues ride the pivot so they spin and pop with the ring: white keeps a
// smooth rim, yellow adds the dashed outline, red (below) the double rim.

class RingVisual extends PopVisual {
  constructor(geometry: THREE.TorusGeometry, material: THREE.Material, dashes = false) {
    super();
    const torus = new THREE.Mesh(geometry, material);
    torus.name = 'ring';
    this.pivot.add(torus);
    if (dashes) this.pivot.add(createRingDashes());
    this.pivot.position.y = RING_HOVER;
    this.setBaseScale(1);
  }

  public update(dt: number, elapsed: number): void {
    this.pivot.rotation.z = elapsed * 0.85; // lazy spin around the travel axis
    this.pivot.position.y = RING_HOVER + Math.sin(elapsed * 1.8) * 0.1;
    this.applyScale(this.advancePop(dt));
  }
}

// -- Red ring: the trap. Same arch shape, smaller, lane-placed, dodgeable. ---
// Pulses like a heartbeat and carries a DOUBLE RIM (inner + outer torus) — the
// silhouette alone says "threat", no color required.

class RedRingVisual extends PopVisual {
  constructor() {
    super();
    const torus = new THREE.Mesh(redRingGeometry, redRingMaterial);
    torus.name = 'red-ring';
    const innerRim = new THREE.Mesh(redRingInnerGeometry, redRingMaterial);
    innerRim.name = 'red-ring-inner-rim';
    this.pivot.add(torus, innerRim);
    this.pivot.position.y = RING_HOVER;
    this.setBaseScale(1);
  }

  public update(dt: number, elapsed: number): void {
    this.pivot.rotation.z = elapsed * 0.85;
    this.pivot.position.y = RING_HOVER + Math.sin(elapsed * 1.8) * 0.1;
    this.applyScale(this.advancePop(dt) * (1 + 0.07 * Math.sin(elapsed * 5.2)));
  }
}

// -- Jump pod: a road-spanning cyan launch strip with bobbing up-chevrons. ----

class JumpPodVisual extends PopVisual {
  private readonly chevrons: THREE.Mesh[] = [];

  constructor() {
    super();
    const strip = new THREE.Mesh(podStripGeometry, podStripMaterial);
    strip.name = 'jump-pod-strip';
    strip.position.y = 0.07; // just above the road surface
    this.pivot.add(strip);

    // Three up-pointing chevrons across the road, bobbing in a wave — the
    // "launch here" signal that reads at speed and feeds the bloom pass.
    for (const lane of [-3.4, 0, 3.4]) {
      const chevron = new THREE.Mesh(podChevronGeometry, podChevronMaterial);
      chevron.name = 'jump-pod-chevron';
      chevron.position.set(lane, 0.7, 0);
      this.chevrons.push(chevron);
      this.pivot.add(chevron);
    }

    this.setBaseScale(1);
  }

  public update(dt: number, elapsed: number): void {
    for (let i = 0; i < this.chevrons.length; i += 1) {
      const phase = elapsed * 3.2 + i * 0.7;
      this.chevrons[i].position.y = 0.7 + ((Math.sin(phase) + 1) / 2) * 1.1;
      this.chevrons[i].rotation.y = elapsed * 0.9;
    }
    (podStripMaterial as THREE.MeshBasicMaterial).opacity = 0.3 + 0.1 * Math.sin(elapsed * 4);
    this.applyScale(this.advancePop(dt));
  }
}

export type EntityVisualFactory = (entity: Entity) => EntityVisual;

/** Factories for the spawnable roster, keyed by behavioral type. */
export const VISUAL_FACTORIES: Readonly<Record<SpawnType, EntityVisualFactory>> = {
  package: () => new PackageVisual(),
  heart: () => new HeartVisual(),
  slug: () => new SlugVisual(),
  asteroid: (entity) => new AsteroidVisual(entity.seed),
  whiteRing: () => new RingVisual(ringGeometry, whiteRingMaterial),
  yellowRing: () => new RingVisual(ringGeometry, yellowRingMaterial, true),
  redRing: () => new RedRingVisual(),
  jumpPod: () => new JumpPodVisual(),
};
