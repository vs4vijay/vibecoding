import * as THREE from "three";
import { fbm2, mulberry32 } from "../util/Rng";
import { Props } from "./Props";
import { GrassField } from "./GrassField";
import { GrainField } from "../gameplay/GrainField";
import { Anthill } from "../gameplay/Anthill";
import { Apple } from "./Apple";
import type { SpringSeeds } from "../gameplay/SpringSeeds";

/**
 * The meadow diorama. `heightAt` is the single authoritative walkable ground
 * height (terrain + smooth prop bumps + the anthill mound + the fallen apple's
 * analytic top surface + any live spring-seed stalk) — controller, camera,
 * grass and the ant's foot IK all sample it. It is pure and cheap (a handful
 * of noise calls).
 */
export class Meadow {
  readonly group = new THREE.Group();
  readonly props: Props;
  readonly grains: GrainField;
  readonly anthill: Anthill;
  readonly grass: GrassField;
  readonly apple: Apple;
  /** Late-bound by Game (needs the controller); contributes stalk-top ground. */
  springSeeds: SpringSeeds | null = null;

  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed | 0;
    // Props register their walkable bumps before anything samples heightAt.
    this.props = new Props(seed ^ 0x9e3779b9, (x, z) => this.terrainHeight(x, z));
    this.group.add(this.props.group);
    this.group.add(this.buildGround());
    // The apple landmark registers its walkable top before grain scatter so
    // the rich ledge patch lands on real surface heights.
    this.apple = new Apple(seed ^ 0x3ad1c0de, (x, z) => this.terrainHeight(x, z));
    this.group.add(this.apple.group);
    // Grain nodes scatter before the grass so blades keep clear of them. The
    // mound lands in its reserved clearing; every grain sits r > 2.35 out,
    // where the mound profile is zero, so sampling order stays deterministic.
    this.grains = new GrainField(this, seed ^ 0x1a2b3c4d);
    this.group.add(this.grains.group);
    this.anthill = new Anthill(seed ^ 0x0dd11e5, (x, z) => this.terrainHeight(x, z), {
      grainGeo: this.grains.grainGeo,
      grainMat: this.grains.grainMat,
    });
    this.group.add(this.anthill.group);
    this.grass = new GrassField(this, seed ^ 0x51f3a7c1);
    this.group.add(this.grass.mesh);
    for (const m of this.grass.extraMeshes) this.group.add(m);
  }

  /** Terrain-only height (no prop bumps) — used for prop placement. */
  terrainHeight(x: number, z: number): number {
    const r = Math.hypot(x, z);
    const flat = THREE.MathUtils.smoothstep(r, 5, 26); // keep the spawn area calm
    const rolling = fbm2(x * 0.045, z * 0.045, 3, this.seed) * 0.7;
    const micro = fbm2(x * 0.21 + 13, z * 0.21 + 7, 2, this.seed + 11) * 0.06 * (0.3 + 0.7 * flat);
    // Big silhouettes far out so the horizon is not a flat line.
    const distant = fbm2(x * 0.011 + 31, z * 0.011 + 17, 3, this.seed + 23) * 0.5 + 0.5;
    const ridge = Math.pow(Math.max(distant, 0), 1.7) * 9 * THREE.MathUtils.smoothstep(r, 32, 95);
    return rolling * flat + micro + ridge;
  }

  /** Walkable ground height: terrain + prop bumps + mound + apple + seed stalks. */
  heightAt(x: number, z: number): number {
    // The anthill lands after the grain scatter (which never samples inside
    // its radius), hence the optional chain during construction only.
    const base = this.terrainHeight(x, z) + this.props.bumpHeight(x, z) + (this.anthill?.heightAt(x, z) ?? 0);
    // High surfaces (apple top, spring-seed stalks) are ABSOLUTE heights: take
    // whichever is higher so the edges blend into the ground instead of
    // stepping. Returns 0 from those samplers when out of footprint — guard on
    // > 0 so that out-of-footprint 0 can never beat a NEGATIVE walkable base
    // (it used to mask the seed domes entirely on dipped ground, which made
    // those spring seeds impossible to stand on and dead as launch pads).
    const appleY = this.apple.heightAt(x, z);
    if (appleY > 0 && appleY > base) return appleY;
    const seedY = this.springSeeds?.heightAt(x, z) ?? 0;
    if (seedY > 0 && seedY > base) return seedY;
    return base;
  }

  /** Terrain gradient (dh/dx, dh/dz) via finite differences. */
  slopeAt(x: number, z: number, out: THREE.Vector2): THREE.Vector2 {
    const e = 0.09;
    out.set(
      (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e),
      (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e),
    );
    return out;
  }

  private buildGround(): THREE.Mesh {
    const size = 360;
    const segs = 288;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const detail = Meadow.buildDetailTexture(this.seed ^ 0x51ed270b);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const tmp = new THREE.Color();
    const tmp2 = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.terrainHeight(x, z);
      pos.setY(i, h);

      // Mottled grass greens, kept a touch muted so blades pop against it.
      // (The tiling detail texture multiplies on top and darkens ~25%, so the
      // palette here runs deliberately bright.)
      const mottle = fbm2(x * 0.13, z * 0.13, 3, this.seed + 41);
      const broad = fbm2(x * 0.033 + 71, z * 0.033 + 29, 2, this.seed + 53);
      c.set(0x578a34).lerp(tmp.set(0x48792c), mottle * 0.5 + 0.5);
      c.offsetHSL(0, 0, broad * 0.05);
      // Clover patches read bluer/deeper.
      const clover = THREE.MathUtils.smoothstep(fbm2(x * 0.05 + 40, z * 0.05 + 9, 2, this.seed + 43), 0.12, 0.5);
      c.lerp(tmp.set(0x427c4a), clover * 0.6);
      // Warmer, drier tone with distance.
      c.lerp(tmp.set(0x93ab55), THREE.MathUtils.smoothstep(Math.hypot(x, z), 22, 75) * 0.45);
      // Worn dirt around the future anthill (origin), noise-edged, muted so
      // the amber ant pops against it.
      const edgeNoise = fbm2(x * 0.6, z * 0.6, 2, this.seed + 47) * 0.55;
      const dirt = 1 - THREE.MathUtils.smoothstep(Math.hypot(x, z) + edgeNoise, 1.2, 2.3);
      c.lerp(tmp2.set(0x7a654a).lerp(tmp.set(0x68543c), mottle * 0.5 + 0.5), dirt * 0.9);

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    mat.map = detail;
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    return ground;
  }

  /**
   * Tiling dirt/soil detail at the 5–50 cm scale (a 360-unit plane with 40
   * repeats gives ~9-unit ≈ 10 cm tiles). Multi-octave noise plus discrete
   * speckle flecks; stays in linear space (no colorSpace conversion) so the
   * multiply against vertex colors is predictable. Deterministic via seed.
   */
  private static buildDetailTexture(seed: number): THREE.Texture {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const broad = fbm2(x * 0.03, y * 0.03, 2, seed + 31);
        const mid = fbm2(x * 0.09, y * 0.09, 2, seed + 37);
        const fine = fbm2(x * 0.28, y * 0.28, 2, seed + 41);
        const n = 0.72 + broad * 0.3 + mid * 0.21 + fine * 0.135;
        // Warm/cool soil tint patches.
        const r = Math.min(1, Math.max(0, n * (1 + broad * 0.18)));
        const g = Math.min(1, Math.max(0, n * (1 + broad * 0.05)));
        const b = Math.min(1, Math.max(0, n * (1 - broad * 0.2)));
        const i = (y * size + x) * 4;
        img.data[i] = Math.round(r * 255);
        img.data[i + 1] = Math.round(g * 255);
        img.data[i + 2] = Math.round(b * 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Discrete litter: darker crumb flecks and pale grains.
    const rng = mulberry32(seed + 97);
    for (let i = 0; i < 1400; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const w = 1 + rng() * 2.4;
      ctx.fillStyle = rng() < 0.6 ? "rgba(30,24,14,0.32)" : "rgba(216,202,162,0.26)";
      ctx.fillRect(x, y, w, w * (0.5 + rng()));
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(56, 56);
    tex.anisotropy = 8;
    return tex;
  }
}
