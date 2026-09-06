import * as THREE from 'three';
import { buildTerrainMesh, heightAt } from '../world/terrain';
import type { WallBox } from '../world/walls';
import { BOULDER_CLUSTERS } from '../world/walls';
import type { Bush } from '../ai/perception';
import type { Rng } from '../core/rng';

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
}

const SKY = 0xbcd6e4;

/** Renderer + fog/sky + lights (2048 shadowmap sun, ±40 bounds) + terrain. */
export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 40, 110);

  const hemiLight = new THREE.HemisphereLight(0xdfeaff, 0x5a5140, 0.55);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff2d9, 1.35);
  sunLight.position.set(30, 48, 18);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  const cam = sunLight.shadow.camera;
  cam.left = -40;
  cam.right = 40;
  cam.top = 40;
  cam.bottom = -40;
  cam.near = 1;
  cam.far = 160;
  scene.add(sunLight);

  scene.add(buildTerrainMesh());

  return { renderer, scene, sunLight, hemiLight };
}

// ---------------------------------------------------------------------------
// Arena dressing [Task 17] — boulders, bushes, grass. Builders return an
// optional per-frame update handle; game.ts drives them with visual time +
// the wind vector. Geometry origins sit at the object's BASE so the sway
// pivots at the ground, not the centroid.
// ---------------------------------------------------------------------------

/** Per-frame wind response for a dressing layer. */
export interface SwayField {
  /** `wind` = WindSystem.vector (direction × strength). */
  update(timeSec: number, wind: { x: number; z: number }): void;
  dispose(): void;
}

/** Grass tuft count + spread (render dressing numbers, local like the fx pools). */
const GRASS_TUFT_COUNT = 350;
const GRASS_SPREAD_M = 45;
const GRASS_MAX_LEAN_RAD = 0.4;
const BUSH_MAX_LEAN_RAD = 0.12;

/** One instance's fixed transform + sway personality. */
interface SwayInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  phase: number;
  lean: number;
}

/**
 * One InstancedMesh whose instances all lean along the wind, pivoting at
 * their base: angle = maxLean × |wind| × (bias + sway wave per instance).
 * Per-instance matrices are recomposed per frame — a few hundred instances
 * is well under a millisecond.
 */
class InstancedSway implements SwayField {
  private readonly mesh: THREE.InstancedMesh;
  private readonly instances: SwayInstance[];
  private readonly maxLean: number;
  private readonly dummy = new THREE.Object3D();
  private readonly axis = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    instances: SwayInstance[],
    maxLean: number,
  ) {
    this.instances = instances;
    this.maxLean = maxLean;
    this.mesh = new THREE.InstancedMesh(geo, mat, instances.length);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    for (let i = 0; i < instances.length; i++) {
      const t = instances[i];
      this.dummy.position.set(t.x, t.y, t.z);
      this.dummy.scale.setScalar(t.scale);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    scene.add(this.mesh);
  }

  /** Slight per-instance albedo jitter — breaks up the clone look. */
  tint(baseHex: number, jitter: number, rng: Rng): this {
    const c = new THREE.Color();
    for (let i = 0; i < this.mesh.count; i++) {
      c.setHex(baseHex);
      const d = 1 - jitter / 2 + rng() * jitter;
      this.mesh.setColorAt(i, c.multiplyScalar(d));
    }
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
    return this;
  }

  update(timeSec: number, wind: { x: number; z: number }): void {
    const mag = Math.hypot(wind.x, wind.z);
    // Rotation axis ⊥ wind in the ground plane; +angle tips +Y along wind.
    if (mag > 1e-5) this.axis.set(wind.z / mag, 0, -wind.x / mag);
    else this.axis.set(1, 0, 0);

    const instances = this.instances;
    for (let i = 0; i < instances.length; i++) {
      const t = instances[i];
      const wave = 0.55 + 0.45 * Math.sin(timeSec * 1.7 + t.phase);
      const angle = this.maxLean * t.lean * mag * wave;
      this.dummy.position.set(t.x, t.y, t.z);
      this.dummy.quaternion.setFromAxisAngle(this.axis, angle);
      this.dummy.scale.setScalar(t.scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * Bush canopies: 3 icospheres per bush (trunk puff + two shoulder puffs)
 * as instanced clusters that sway with the wind. Renders the SAME bush
 * array the sim reads — positions only, no sim coupling.
 */
export function addBushes(scene: THREE.Scene, bushes: readonly Bush[], rng: Rng): SwayField {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  geo.translate(0, 1, 0); // origin at the sphere's base → sway pivots at ground
  const mat = new THREE.MeshStandardMaterial({ color: 0x3f5a35, flatShading: true });

  const instances: SwayInstance[] = [];
  for (const bush of bushes) {
    const size = bush.radius * 0.62;
    const r = bush.radius;
    instances.push({
      x: bush.pos.x,
      y: heightAt(bush.pos.x, bush.pos.z),
      z: bush.pos.z,
      scale: size,
      phase: 0,
      lean: 1,
    });
    instances.push({
      x: bush.pos.x + 0.34 * r,
      y: heightAt(bush.pos.x + 0.3, bush.pos.z + 0.2 * r) - 0.05,
      z: bush.pos.z + 0.2 * r,
      scale: size * 0.72,
      phase: 1.3,
      lean: 0.8,
    });
    instances.push({
      x: bush.pos.x - 0.3 * r,
      y: heightAt(bush.pos.x - 0.25, bush.pos.z - 0.3 * r) - 0.05,
      z: bush.pos.z - 0.3 * r,
      scale: size * 0.66,
      phase: 2.6,
      lean: 0.8,
    });
  }
  return new InstancedSway(scene, geo, mat, instances, BUSH_MAX_LEAN_RAD).tint(0x3f5a35, 0.24, rng);
}

/**
 * Dry grass tufts: instanced 4-blade cones scattered near the arena
 * center (fog swallows the rim), leaning with the wind — the second wind
 * tell the brief asks for.
 */
export function addGrassTufts(scene: THREE.Scene, rng: Rng): SwayField {
  const geo = new THREE.ConeGeometry(0.05, 0.42, 4);
  geo.translate(0, 0.21, 0); // base pivot
  const mat = new THREE.MeshStandardMaterial({ color: 0x77883f, flatShading: true });

  const instances: SwayInstance[] = [];
  for (let i = 0; i < GRASS_TUFT_COUNT; i++) {
    const x = (rng() * 2 - 1) * GRASS_SPREAD_M;
    const z = (rng() * 2 - 1) * GRASS_SPREAD_M;
    instances.push({
      x,
      y: heightAt(x, z),
      z,
      scale: 0.8 + rng() * 0.9,
      phase: rng() * Math.PI * 2,
      lean: 0.7 + rng() * 0.6,
    });
  }
  return new InstancedSway(scene, geo, mat, instances, GRASS_MAX_LEAN_RAD).tint(0x77883f, 0.3, rng);
}

/**
 * Boulder clusters: one flat-shaded rock mesh per WallBox (render twin of
 * the PhysicsWorld colliders game.ts adds from the same layout).
 */
export function addBoulders(scene: THREE.Scene, clusters: readonly (readonly WallBox[])[] = BOULDER_CLUSTERS): void {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const shades = [0x8a8578, 0x7f7a6e, 0x93907f];
  let s = 0;
  for (const cluster of clusters) {
    for (const box of cluster) {
      const mat = new THREE.MeshStandardMaterial({ color: shades[s % shades.length], flatShading: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(box.center.x, box.center.y, box.center.z);
      mesh.scale.set(box.halfExtents.x * 2, box.halfExtents.y * 2, box.halfExtents.z * 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      s++;
    }
  }
}
