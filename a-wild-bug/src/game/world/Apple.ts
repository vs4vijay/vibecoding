import * as THREE from "three";
import { fbm2 } from "../util/Rng";

/**
 * The fallen apple — the meadow's authored landmark and the "high ledge" the
 * spring-seed launches reach. It lies on its side, half-buried, with a big
 * bite hollow (cream flesh + seeds), a bent stem, a drooping leaf and dew
 * drops. Exactly like the anthill, the walkable surface is the SAME analytic
 * function that shapes the mesh (ellipsoid top surface minus a smooth bite
 * bowl), so the ant walks precisely on what it sees — no physics engine, just
 * heightAt math composed in Meadow.
 */

export const APPLE = {
  x: 6.5,
  z: -3.5,
  /** Long-axis bearing (local +u = the stem end). */
  yaw: -0.55,
  /** Semi-axes: along axis, vertical, lateral. */
  a: 0.98,
  b: 0.8,
  c: 0.88,
  /** How deep the center sits below its rest height (half-buried read). */
  sink: 0.34,
  /** Bite scoop: smooth bowl centered in local (u, v), radius, depth. */
  bite: { u: 0.3, v: -0.18, r: 0.34, depth: 0.3 },
} as const;

/** Authored spots on the apple's top (apple-local u,v). */
const TOP_SPOTS: [number, number][] = [
  [-0.16, 0.1], // landing 0 — primary launch target
  [-0.42, 0.28], // patch
  [-0.58, -0.06], // patch
  [-0.34, -0.3], // patch
  [0.02, 0.36], // landing 1 — alternate target (clear of the bite hollow)
  [-0.16, 0.42], // patch
  [-0.62, 0.2], // patch
];

/** Spot indices the spring seeds alternate between (kept clear of the patch). */
const LANDING_SPOTS = [0, 4];
/** Spot indices carrying the rich grain patch (the windfall). */
const PATCH_SPOTS = [1, 2, 3, 5, 6];

export class Apple {
  readonly group = new THREE.Group();
  /** World center of the ellipsoid. */
  readonly center = new THREE.Vector3();
  /** World Y of the crest (walkable high point). */
  readonly topY: number;

  private readonly a = APPLE.a;
  private readonly b = APPLE.b;
  private readonly c = APPLE.c;
  private readonly cosY = Math.cos(APPLE.yaw);
  private readonly sinY = Math.sin(APPLE.yaw);
  /** Bite sphere center in local apple space. */
  private readonly biteLocal = new THREE.Vector3();
  private readonly dewMat: THREE.MeshPhysicalMaterial;

  constructor(seed: number, terrainHeight: (x: number, z: number) => number) {
    const groundY = terrainHeight(APPLE.x, APPLE.z);
    this.center.set(APPLE.x, groundY + this.b - APPLE.sink, APPLE.z);
    this.topY = this.center.y + this.b;
    const biteSurf = this.localSurfaceY(APPLE.bite.u, APPLE.bite.v);
    this.biteLocal.set(APPLE.bite.u, biteSurf - APPLE.bite.depth, APPLE.bite.v);

    this.group.position.copy(this.center);
    this.group.rotation.y = APPLE.yaw;

    this.dewMat = new THREE.MeshPhysicalMaterial({
      color: 0xd8eef2,
      roughness: 0.06,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      transparent: true,
      opacity: 0.62,
      envMapIntensity: 1.4,
    });

    this.buildBody(seed);
    this.buildStemAndLeaf();
    this.buildDew();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  // --- analytic walkable surface -------------------------------------------

  /** World → apple-local (u along the stem axis, v lateral). */
  private toLocal(x: number, z: number): { u: number; v: number } {
    const dx = x - this.center.x;
    const dz = z - this.center.z;
    return { u: this.cosY * dx - this.sinY * dz, v: this.sinY * dx + this.cosY * dz };
  }

  /** World ← apple-local (u, v). */
  private toWorld(u: number, v: number): { x: number; z: number } {
    return {
      x: this.center.x + this.cosY * u + this.sinY * v,
      z: this.center.z - this.sinY * u + this.cosY * v,
    };
  }

  /** Local (u, v) → local surface height relative to the apple center. */
  private localSurfaceY(u: number, v: number): number {
    const q = (u / this.a) * (u / this.a) + (v / this.c) * (v / this.c);
    if (q >= 1) return -Infinity;
    return this.b * Math.sqrt(1 - q);
  }

  /**
   * Walkable apple surface at world (x, z): the ellipsoid top minus the bite
   * scoop, as an ABSOLUTE world Y. Returns 0 outside the footprint (Meadow
   * treats 0 as "no apple here" and keeps the ground height).
   */
  heightAt(x: number, z: number): number {
    const { u, v } = this.toLocal(x, z);
    const sy = this.localSurfaceY(u, v);
    if (sy === -Infinity) return 0;
    let y = this.center.y + sy;
    // Bite scoop: the SAME smooth bowl the mesh carves (see buildBody), so the
    // ant walks precisely on the visible hollow — no rim cliff, no mismatch.
    y -= this.scoopDepth(Math.hypot(u - APPLE.bite.u, v - APPLE.bite.v));
    return y;
  }

  /** Bite bowl depth at horizontal distance d from the bite center (0 outside). */
  private scoopDepth(d: number): number {
    const r = APPLE.bite.r;
    if (d >= r) return 0;
    const f = 1 - (d / r) * (d / r);
    return APPLE.bite.depth * f * f * Math.sqrt(f); // flush at the rim, deepest mid-bowl
  }

  /** True when (x, z) sits over the apple footprint (+ margin). */
  contains(x: number, z: number, margin = 0.2): boolean {
    const { u, v } = this.toLocal(x, z);
    const uu = u / (this.a + margin);
    const vv = v / (this.c + margin);
    return uu * uu + vv * vv < 1;
  }

  /** 0..1 grass density (0 = no grass over the apple). */
  grassMask(x: number, z: number): number {
    const { u, v } = this.toLocal(x, z);
    const d = Math.hypot(u / this.a, v / this.c);
    return THREE.MathUtils.smoothstep(d, 0.92, 1.12);
  }

  /** Authored spot i on the apple top, world space. */
  topSpot(i: number): THREE.Vector3 {
    const [u, v] = TOP_SPOTS[i % TOP_SPOTS.length];
    const w = this.toWorld(u, v);
    return new THREE.Vector3(w.x, this.heightAt(w.x, w.z), w.z);
  }

  get topSpotCount(): number {
    return TOP_SPOTS.length;
  }

  /** Launch landing spot (round-robin between the two clear pads). */
  landingSpot(i: number): THREE.Vector3 {
    return this.topSpot(LANDING_SPOTS[i % LANDING_SPOTS.length]);
  }

  get landingSpotCount(): number {
    return LANDING_SPOTS.length;
  }

  /** Rich-grain-patch spots on the crest (the high-route windfall). */
  patchSpot(i: number): THREE.Vector3 {
    return this.topSpot(PATCH_SPOTS[i % PATCH_SPOTS.length]);
  }

  get patchSpotCount(): number {
    return PATCH_SPOTS.length;
  }

  // --- mesh ------------------------------------------------------------------

  /**
   * The apple body: a lobed, dimpled ellipsoid whose vertices inside the bite
   * sphere are clamped onto that sphere — a real concave bite with no hole,
   * exactly matching the analytic walkable surface. Red skin with a green
   * blush and cream flesh at the bite.
   */
  private buildBody(seed: number): void {
    const geo = new THREE.SphereGeometry(1, 52, 34);
    geo.scale(this.a, this.b, this.c);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const r = APPLE.bite.r;
    const p = new THREE.Vector3();
    const skin = new THREE.Color();
    const cRed = new THREE.Color(0xc04028);
    const cRedDeep = new THREE.Color(0x9c2c1c);
    const cGreen = new THREE.Color(0x93a838);
    const cFlesh = new THREE.Color(0xf2e4b6);
    const cRim = new THREE.Color(0x7c3a20);

    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);

      // Stem-end dimple (+u) and calyx dimple (−u): pull the cross-section in
      // near the axial poles so the ends read as apple, not capsule.
      const axial = p.x / this.a;
      const dimpleEnd = axial > 0
        ? THREE.MathUtils.smoothstep(axial, 0.55, 0.98) * 0.34
        : THREE.MathUtils.smoothstep(-axial, 0.55, 0.98) * 0.2;
      p.y *= 1 - dimpleEnd;
      p.z *= 1 - dimpleEnd;

      // Five subtle vertical lobes around the long axis.
      const phi = Math.atan2(p.y, p.z);
      const lobe = 1 + 0.026 * Math.sin(5 * phi + p.x * 1.4);
      p.y *= lobe;
      p.z *= lobe;

      // Bite scoop: inside the bite footprint (upper surface only) sink the
      // vertex by the shared bowl — the same scoopDepth() heightAt() walks.
      // The old outward sphere-projection snapped surface vertices ONTO the
      // bite sphere, whose top pokes above the skin: the bite rendered as a
      // smooth brown DOME growing out of the apple.
      const bdx = p.x - this.biteLocal.x;
      const bdz = p.z - this.biteLocal.z;
      const biteD = Math.hypot(bdx, bdz);
      const inBite = biteD < r && p.y > this.biteLocal.y - 0.2;
      if (inBite) p.y -= this.scoopDepth(biteD);
      pos.setXYZ(i, p.x, p.y, p.z);

      // Skin: green toward the buried underside and one cheek, red elsewhere;
      // cream flesh inside the bite, bruised brown at the rim.
      const n = fbm2(p.x * 2.3 + p.z, p.y * 2.3 + p.x * 0.7, 2, seed + 5) * 0.5;
      const t = THREE.MathUtils.clamp(0.62 + p.y / (this.b * 1.7) + n * 0.42, 0, 1);
      skin.copy(cGreen).lerp(cRed, THREE.MathUtils.smoothstep(t, 0.28, 0.72));
      skin.lerp(cRedDeep, THREE.MathUtils.smoothstep(-p.y, 0.1, this.b * 0.9) * 0.5);
      if (inBite) {
        skin.copy(cFlesh).lerp(cRim, THREE.MathUtils.smoothstep(biteD / r, 0.5, 0.95));
      }
      colors[i * 3] = skin.r;
      colors[i * 3 + 1] = skin.g;
      colors[i * 3 + 2] = skin.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.4,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.38,
      envMapIntensity: 0.9,
    });
    this.group.add(new THREE.Mesh(geo, mat));
  }

  /** Bent stem at the axial +u pole, with one drooping apple leaf. */
  private buildStemAndLeaf(): void {
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 });
    const base = new THREE.Vector3(this.a * 0.93, 0.05, 0);
    const curve = new THREE.CatmullRomCurve3([
      base.clone(),
      base.clone().add(new THREE.Vector3(0.09, 0.16, 0.03)),
      base.clone().add(new THREE.Vector3(0.2, 0.26, 0.08)),
      base.clone().add(new THREE.Vector3(0.27, 0.22, 0.12)),
    ]);
    const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.028, 6, false), stemMat);
    this.group.add(stem);

    const leafGeo = Apple.buildLeafGeo();
    const leaf = new THREE.Mesh(leafGeo, Apple.leafMat);
    leaf.scale.setScalar(0.5);
    leaf.position.copy(base).add(new THREE.Vector3(0.16, 0.24, 0.06));
    leaf.rotation.set(0.5, 0.7, 1.9);
    this.group.add(leaf);
  }

  /** Glassy dew drops settled into the top surface (authored spots). */
  private buildDew(): void {
    const spots: [number, number, number][] = [
      [0.12, 0.42, 0.032],
      [-0.4, 0.3, 0.026],
      [0.52, 0.12, 0.022], // kept clear of the bite bowl (was at [0.35, 0.05])
      [-0.12, -0.5, 0.03],
      [0.05, 0.15, 0.02],
    ];
    for (const [u, v, s] of spots) {
      const drop = new THREE.Mesh(Apple.dropGeo, this.dewMat);
      drop.scale.set(s, s * 0.72, s);
      const y = this.localSurfaceY(u, v);
      drop.position.set(u, y + s * 0.3, v);
      this.group.add(drop);
    }
  }

  private static dropGeo = new THREE.SphereGeometry(1, 14, 10);

  private static leafMat = new THREE.MeshStandardMaterial({
    color: 0x5c8a38,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });

  /** Pointed apple leaf, origin at the stem end, lying along +x. */
  private static buildLeafGeo(): THREE.BufferGeometry {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.22, 0.13, 0.42, 0.02);
    s.quadraticCurveTo(0.22, -0.13, 0, 0);
    const geo = new THREE.ShapeGeometry(s, 12);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setZ(i, z + Math.sin(x * 7) * 0.008); // slight ripple
    }
    geo.computeVertexNormals();
    return geo;
  }
}
