import * as THREE from "three";
import { fbm2, mulberry32, rangeRng, type Rng } from "../util/Rng";

/**
 * The anthill mound at the meadow origin — home base and the deposit point.
 * The visual mesh and the walkable height come from the SAME analytic profile
 * (a noise-roughened cone), so the ant walks exactly on what it sees: no
 * floating, no clipping. The entrance hole on the WNW flank (the side the dawn
 * sun hits) is the deposit trigger zone; delivered grains pile beside it — the
 * pile growing in the world IS the quota progress bar.
 */

export const MOUND = {
  /** Profile base radius (height reaches 0 here). */
  radius: 1.85,
  /**
   * Peak height above terrain. Deliberately taller than the surrounding grass
   * (blades run 0.55–1.55): the mound must crest the lawn to read as the home
   * base from gameplay cameras, and the ant's climb up it is part of the loop.
   */
  height: 1.0,
  /** Bearing of the entrance: WNW, where the dawn sun lands on the flank. */
  holeAzimuth: -1.88,
  holeDist: 0.72,
  holeRadius: 0.14,
  pileMax: 12,
} as const;

/** Shared grain geometry lives in GrainField; Anthill receives it to keep the
 *  delivered pile visually identical to carried grains. */
export interface AnthillDeps {
  grainGeo: THREE.BufferGeometry;
  grainMat: THREE.Material;
}

export class Anthill {
  readonly group = new THREE.Group();
  /** World position of the entrance hole (deposit target). */
  readonly holePos = new THREE.Vector3();
  /** Deposit trigger radius around the hole. */
  readonly holeRadius = 1.5 * MOUND.holeRadius + 0.32;

  private readonly seed: number;
  private readonly terrainHeight: (x: number, z: number) => number;
  private readonly pile: THREE.InstancedMesh;
  private readonly pileSlots: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number }[] = [];
  private readonly flash: THREE.Mesh;
  private readonly pileMat: THREE.MeshStandardMaterial;
  private flashT = 1; // 1 = finished
  private glintT = 1; // win shimmer clock driver, 1 = idle
  private pileCount = 0;
  private readonly crumbMat: THREE.MeshStandardMaterial;
  private crumbs: THREE.InstancedMesh | null = null;
  private readonly crumbData: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number }[] = [];
  private readonly camPos = new THREE.Vector3();
  private camValid = false;
  private lastCrumbCamX = NaN;
  private lastCrumbCamZ = NaN;
  private readonly scratchM = new THREE.Matrix4();
  private readonly scratchS = new THREE.Vector3();

  constructor(seed: number, terrainHeight: (x: number, z: number) => number, deps: AnthillDeps) {
    this.seed = seed | 0;
    this.terrainHeight = terrainHeight;

    this.crumbMat = new THREE.MeshStandardMaterial({
      color: 0xd8c4a4,
      roughness: 0.96,
      metalness: 0,
      map: Anthill.crumbTexture(this.seed ^ 0x1d3f5b7),
    });
    // NOTE: shared by instanced grit + the rim torus, none of which carry
    // vertex colors — keep vertexColors off here (a vertexColors material
    // without a color attribute renders BLACK).
    this.crumbMat.vertexColors = false;

    this.buildCone();

    const rng = mulberry32(seed ^ 0x5f356495);
    this.computeHolePos();
    this.buildHole(rng);
    this.buildCrumbs(rng);
    this.buildPebbles(mulberry32(seed ^ 0x2c9f7e11));

    // Delivered-grain pile beside the hole.
    this.pileMat = new THREE.MeshStandardMaterial({});
    this.pileMat.copy(deps.grainMat as THREE.MeshStandardMaterial);
    this.pile = new THREE.InstancedMesh(deps.grainGeo, this.pileMat, MOUND.pileMax);
    this.pile.castShadow = true;
    this.pile.receiveShadow = true;
    this.pile.frustumCulled = false;
    this.pile.count = 0;
    this.group.add(this.pile);
    this.buildPileSlots(mulberry32(seed ^ 0x71c3a9d));

    // Deposit flash: a soft expanding gold ring lying on the slope, oriented
    // tangent to the flank so it hugs the mound instead of slicing it.
    this.flash = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffe2a0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const fn = this.surfaceNormal(this.holePos.x, this.holePos.z, new THREE.Vector3());
    this.flash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fn);
    this.flash.position.copy(this.holePos).addScaledVector(fn, 0.02);
    this.flash.renderOrder = 6;
    this.group.add(this.flash);
  }

  /**
   * Walkable mound profile above the terrain: a full-bellied earthen cone —
   * slightly convex flanks (u^0.8) with a rounded crest — roughened by two
   * octaves of crumb lumps so it reads hand-sculpted, never a displaced cone
   * primitive. Must stay cheap (sampled by the ant, the camera clamp and the
   * follow-cam ground checks every frame) — two fbm calls.
   */
  heightAt(x: number, z: number): number {
    const r = Math.hypot(x, z);
    if (r >= MOUND.radius) return 0;
    const u = 1 - r / MOUND.radius;
    return this.moundProfile(u, x, z);
  }

  /** Mound-only height (above terrain) for profile parameter u ∈ (0,1]. */
  private moundProfile(u: number, x: number, z: number): number {
    // Trig-based lumps: smooth everywhere (no value-noise lattice creases for
    // raking light to catch), damped toward the crest so the packed-earth cap
    // sits on a smooth peak instead of a lump-carved dimple.
    const lumps =
      Math.sin(x * 2.1 + 1.3) * Math.sin(z * 1.7 + 0.6) * 0.055 +
      Math.sin(x * 1.05 + 4.2) * Math.cos(z * 0.9 + 2.1) * 0.065;
    const weight = Math.pow(u, 0.55) * (1 - Math.pow(u, 6) * 0.7) * (1 - THREE.MathUtils.smoothstep(u, 0.94, 1));
    return MOUND.height * Math.pow(Math.sin(u * (Math.PI / 2)), 0.9) + lumps * weight;
  }

  /** 0..1 grass density around the mound (dirt ring reads as kept ground). */
  grassMask(x: number, z: number): number {
    const r = Math.hypot(x, z);
    return THREE.MathUtils.smoothstep(r, MOUND.radius * 0.95, MOUND.radius + 0.5);
  }

  /** Deposit pile growth + plunk flash + win shimmer. */
  update(dt: number): void {
    if (this.flashT < 1) {
      this.flashT = Math.min(1, this.flashT + dt / 0.55);
      const f = this.flashT;
      const mat = this.flash.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - f) * 0.7;
      this.flash.scale.setScalar(0.1 + f * 0.5);
      this.flash.visible = f < 1;
    }
    // Win shimmer: gentle emissive breathing on the pile.
    const breathe = this.glintT < 1 ? Math.sin(this.glintT * Math.PI) : 0;
    this.glintT = Math.min(1, this.glintT + dt / 2.4);
    this.pileMat.emissiveIntensity = 0.55 + breathe * 1.6 + Math.sin(this.glintT * 21.0) * 0.25 * (1 - this.glintT);
    this.applyCrumbFade();
  }

  /** Fed by Game every frame; drives the near-lens grit fade. */
  setCamera(p: THREE.Vector3): void {
    this.camPos.copy(p);
    this.camValid = true;
  }

  /**
   * Grit within ~0.55 u of the lens melts down — a fist-sized crumb at a
   * close-up camera reads as a tabletop rock, not soil. Public so staged
   * shots can apply it deterministically after placing their camera (the
   * fixed-step update that normally drives it is skipped while pinned).
   */
  applyCrumbFade(): void {
    if (!this.crumbs || !this.camValid) return;
    if (this.camPos.x === this.lastCrumbCamX && this.camPos.z === this.lastCrumbCamZ) return;
    this.lastCrumbCamX = this.camPos.x;
    this.lastCrumbCamZ = this.camPos.z;
    for (let i = 0; i < this.crumbData.length; i++) {
      const d = this.crumbData[i];
      const dist = Math.hypot(d.pos.x - this.camPos.x, d.pos.z - this.camPos.z);
      const k = THREE.MathUtils.smoothstep(dist, 0.2, 0.55);
      this.crumbs.setMatrixAt(i, this.scratchM.compose(
        d.pos,
        d.quat,
        this.scratchS.setScalar(d.scale * (0.15 + 0.85 * k)),
      ));
    }
    this.crumbs.instanceMatrix.needsUpdate = true;
  }

  /** Adds one delivered grain: pile grows, flash + settling dust. */
  deposit(burst: (pos: THREE.Vector3, preAge?: number) => void): void {
    if (this.pileCount < MOUND.pileMax) {
      this.writePileGrain(this.pileCount++);
      this.pile.count = this.pileCount;
      this.pile.instanceMatrix.needsUpdate = true;
    }
    this.flashT = 0;
    this.flash.visible = true;
    this.flash.scale.setScalar(0.1);
    (this.flash.material as THREE.MeshBasicMaterial).opacity = 0.7;
    burst(this.holePos, 0);
  }

  /** Win moment: the mound glints with borrowed sunlight. */
  glint(): void {
    this.glintT = 0;
  }

  // --- staging (ShotDirector only) ----------------------------------------

  /** Sets the pile without plunk feedback. */
  stagePile(count: number): void {
    this.pileCount = Math.min(count, MOUND.pileMax);
    for (let i = 0; i < this.pileCount; i++) this.writePileGrain(i);
    this.pile.count = this.pileCount;
    this.pile.instanceMatrix.needsUpdate = true;
  }

  /** Freezes the deposit flash at fraction `f` (0 = just started). */
  stageFlash(f: number): void {
    this.flashT = f;
    this.flash.visible = f < 1;
    (this.flash.material as THREE.MeshBasicMaterial).opacity = (1 - f) * 0.7;
    this.flash.scale.setScalar(0.1 + f * 0.5);
  }

  /** Freezes the win shimmer at fraction `f` (peak at 0.5). */
  stageGlint(f: number): void {
    this.glintT = f;
    this.pileMat.emissiveIntensity = 0.55 + Math.sin(f * Math.PI) * 1.6;
  }

  reset(): void {
    this.pileCount = 0;
    this.pile.count = 0;
    this.flashT = 1;
    this.flash.visible = false;
    this.glintT = 1;
    this.pileMat.emissiveIntensity = 0.55;
  }

  private computeHolePos(): void {
    const hx = Math.cos(MOUND.holeAzimuth) * MOUND.holeDist;
    const hz = Math.sin(MOUND.holeAzimuth) * MOUND.holeDist;
    this.holePos.set(hx, this.surfaceY(hx, hz), hz);
  }

  /** Surface height incl. crumb noise — where hole/rim/crumbs sit. */
  private surfaceY(x: number, z: number): number {
    const r = Math.hypot(x, z);
    const u = Math.max(0, 1 - r / MOUND.radius);
    return this.terrainHeight(x, z) + this.moundProfile(u, x, z);
  }

  /** Outward surface normal at (x,z), from finite differences of surfaceY. */
  private surfaceNormal(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.05;
    const dx = (this.surfaceY(x + e, z) - this.surfaceY(x - e, z)) / (2 * e);
    const dz = (this.surfaceY(x, z + e) - this.surfaceY(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }

  /**
   * Lathe-style cone mesh with the exact walkable profile + vertex colors,
   * split into a crest cap (planar UVs, no texture — flat packed earth) and
   * the textured flank. The split is what kills the apex pinwheel: nothing
   * polar samples the crumb texture or the per-vertex mottle.
   */
  private buildCone(): void {
    const ROWS = 30;
    const SEGS = 68;
    const maxR = MOUND.radius + 0.3; // outer skirt, buried under the ground
    const cWarm = new THREE.Color(0x8a7050);
    const cBase = new THREE.Color(0x756046);
    const cDark = new THREE.Color(0x5c4a34);
    const cSkirt = new THREE.Color(0x55452f);
    const c = new THREE.Color();
    // Deterministic per-vertex jitter: dithers the shaded dome so env-band
    // gradients never read as machined bands.
    const jitRng = mulberry32(this.seed ^ 0x5eed011);
    const CAP_RINGS = 4;

    const cap = { pos: [] as number[], col: [] as number[], uv: [] as number[], idx: [] as number[] };
    const flank = { pos: [] as number[], col: [] as number[], uv: [] as number[], idx: [] as number[] };

    const surfaceAt = (stream: typeof cap, x: number, z: number, r: number, ring: number): void => {
      const y = this.surfaceY(x, z);
      const skirt = THREE.MathUtils.smoothstep(r, MOUND.radius, maxR);
      const u = Math.max(0, 1 - r / MOUND.radius);
      if (stream === cap) {
        // Packed crest earth: flat warm base + gentle non-radial variation.
        c.copy(cWarm).lerp(cBase, 0.3 + fbm2(x * 9.1 + 3.7, z * 9.1 + 1.1, 1, this.seed + 17) * 0.2);
        c.offsetHSL(0, 0, (jitRng() - 0.5) * 0.02);
        stream.uv.push(x * 3.5 + 0.5, z * 3.5 + 0.5);
      } else {
        // Mottle fades out toward the crest: per-vertex color wedges converging
        // on the pole are what drew the pinwheel star.
        const crestFade = 1 - THREE.MathUtils.smoothstep(u, 0.9, 0.93);
        const mottle = (fbm2(x * 3.1, z * 3.1 + 9, 2, this.seed + 5) * 0.5 + 0.5) * crestFade;
        c.copy(cBase).lerp(cWarm, mottle * 0.55 + (1 - crestFade) * 0.62);
        c.lerp(cWarm, THREE.MathUtils.smoothstep(u, 0.55, 1) * 0.22 * (1 - crestFade * 0.5));
        c.lerp(cDark, THREE.MathUtils.smoothstep(u, 0.5, 0.05) * 0.5);
        c.lerp(cSkirt, skirt);
        const hd = Math.hypot(x - this.holePos.x, z - this.holePos.z);
        c.lerp(cDark, (1 - THREE.MathUtils.smoothstep(hd, MOUND.holeRadius * 0.9, MOUND.holeRadius * 2.6)) * 0.5);
        c.offsetHSL(0, 0, (jitRng() - 0.5) * 0.05);
        // Continuous azimuthal u: the closing seam samples one repeat apart.
        stream.uv.push((Math.atan2(z, x) - 2.2) / (Math.PI * 2) * 3 + 1.5, u * 1.6);
      }
      stream.pos.push(x, y - skirt * 0.09, z);
      stream.col.push(c.r, c.g, c.b);
      void ring;
    };

    // Packed-earth color for cap vertices — matched to the faded flank tone
    // at the junction so no dark cap ring forms against the lighter flank.
    const capColor = (x: number, z: number): void => {
      c.copy(cWarm).lerp(cBase, 0.22 + fbm2(x * 9.1 + 3.7, z * 9.1 + 1.1, 1, this.seed + 17) * 0.12);
      c.offsetHSL(0, 0, (jitRng() - 0.5) * 0.018);
    };

    // Cap: center + rings 1..CAP_RINGS (planar UVs).
    cap.pos.push(0, this.surfaceY(0, 0), 0);
    cap.uv.push(0.5, 0.5);
    capColor(0, 0);
    cap.col.push(c.r, c.g, c.b);
    for (let i = 1; i <= CAP_RINGS; i++) {
      const f = Math.pow(i / ROWS, 1.45);
      const r = f * maxR;
      for (let j = 0; j <= SEGS; j++) {
        const a = (j / SEGS) * Math.PI * 2 + 2.2;
        surfaceAt(cap, Math.cos(a) * r, Math.sin(a) * r, r, i);
      }
    }
    // Flank: rings CAP_RINGS..ROWS (own copy of the seam ring — the two
    // surfaces meet at the same circle; the junction crumb band dresses it).
    for (let i = CAP_RINGS; i <= ROWS; i++) {
      const f = Math.pow(i / ROWS, 1.45);
      const r = f * maxR;
      for (let j = 0; j <= SEGS; j++) {
        const a = (j / SEGS) * Math.PI * 2 + 2.2;
        surfaceAt(flank, Math.cos(a) * r, Math.sin(a) * r, r, i);
      }
    }

    const capRingV = (ring: number, j: number): number => 1 + (ring - 1) * (SEGS + 1) + j;
    for (let j = 0; j < SEGS; j++) {
      cap.idx.push(0, capRingV(1, j + 1), capRingV(1, j));
    }
    for (let i = 2; i <= CAP_RINGS; i++) {
      for (let j = 0; j < SEGS; j++) {
        const a = capRingV(i - 1, j);
        const a1 = capRingV(i - 1, j + 1);
        const b = capRingV(i, j);
        const b1 = capRingV(i, j + 1);
        cap.idx.push(a, a1, b, a1, b1, b);
      }
    }
    const flankRingV = (ring: number, j: number): number => (ring - CAP_RINGS) * (SEGS + 1) + j;
    // Winding keeps normals up/outward — the opposite order gives downward
    // normals and a mound that never catches the sun.
    for (let i = CAP_RINGS + 1; i <= ROWS; i++) {
      for (let j = 0; j < SEGS; j++) {
        const a = flankRingV(i - 1, j);
        const a1 = flankRingV(i - 1, j + 1);
        const b = flankRingV(i, j);
        const b1 = flankRingV(i, j + 1);
        flank.idx.push(a, a1, b, a1, b1, b);
      }
    }

    const buildMesh = (stream: typeof cap, mat: THREE.Material): THREE.Mesh => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(stream.pos, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(stream.col, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(stream.uv, 2));
      geo.setIndex(stream.idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };
    this.group.add(buildMesh(flank, this.crumbMat));
    this.group.add(buildMesh(cap, Anthill.capMat));
  }

  /** Dark entrance hole + raised rim + a crumb trail down the slope. */
  private buildHole(rng: Rng): void {
    const n = this.surfaceNormal(this.holePos.x, this.holePos.z, new THREE.Vector3());
    // Orthonormal flank frame: +Z = surface normal, +Y = up-slope, +X = across.
    const upSlope0 = new THREE.Vector3(-this.holePos.x, 0, -this.holePos.z).normalize();
    const across = new THREE.Vector3().crossVectors(upSlope0, n).normalize();
    const upSlope = new THREE.Vector3().crossVectors(n, across).normalize();
    const basis = new THREE.Matrix4().makeBasis(across, upSlope, n);
    const holeRoot = new THREE.Group();
    holeRoot.quaternion.setFromRotationMatrix(basis);
    holeRoot.position.copy(this.holePos).addScaledVector(n, 0.012);
    this.group.add(holeRoot);

    // The hole: a dark disc tangent to the flank, mouth wider across-slope.
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(MOUND.holeRadius, 26),
      new THREE.MeshBasicMaterial({
        map: Anthill.holeTexture(),
        fog: true,
      }),
    );
    hole.scale.set(1, 0.74, 1);
    hole.receiveShadow = false;
    holeRoot.add(hole);

    // Raised crater rim: packed darker earth hugging the mouth.
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x8a7150, roughness: 0.95 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(MOUND.holeRadius * 0.88, 0.026, 8, 24), rimMat);
    rim.scale.set(1.05, 0.82, 1);
    rim.position.z = 0.006;
    rim.castShadow = true;
    rim.receiveShadow = true;
    holeRoot.add(rim);

    // Crumb cluster strewn around the rim and down-slope (ants' highway).
    const crumbs = new THREE.InstancedMesh(Anthill.crumbGeo, this.crumbMat, 26);
    crumbs.castShadow = true;
    crumbs.receiveShadow = true;
    crumbs.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    const down = new THREE.Vector3(Math.cos(MOUND.holeAzimuth), 0, Math.sin(MOUND.holeAzimuth));
    for (let i = 0; i < 26; i++) {
      const trail = i < 10 ? 0 : 1; // first 10 hug the rim, rest trail down
      const t = trail === 0 ? rng() * Math.PI * 2 : Math.atan2(down.z, down.x) + rangeRng(rng, -0.5, 0.5);
      const d = trail === 0
        ? MOUND.holeRadius * rangeRng(rng, 1.15, 1.7)
        : MOUND.holeRadius * 1.6 + rangeRng(rng, 0, 0.5);
      const cx = this.holePos.x + Math.cos(t) * d;
      const cz = this.holePos.z + Math.sin(t) * d;
      const r = rangeRng(rng, 0.006, 0.016);
      e.set(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI);
      q.setFromEuler(e);
      p.set(cx, this.surfaceY(cx, cz) + r * 0.3, cz);
      s.set(r, r * rangeRng(rng, 0.5, 0.8), r);
      crumbs.setMatrixAt(i, m.compose(p, q, s));
      col.setHSL(rangeRng(rng, 0.07, 0.11), rangeRng(rng, 0.18, 0.34), rangeRng(rng, 0.28, 0.5));
      crumbs.setColorAt(i, col);
    }
    crumbs.instanceMatrix.needsUpdate = true;
    this.group.add(crumbs);
  }

  /**
   * Instanced crumbs over the flanks — dense enough that close-ups read as
   * carried-up grit: a broad scatter plus clusters toward the crest and the
   * ants' hole trail.
   */
  private buildCrumbs(rng: Rng): void {
    const crumbs = new THREE.InstancedMesh(Anthill.crumbGeo, this.crumbMat, 228);
    crumbs.castShadow = true;
    crumbs.receiveShadow = true;
    crumbs.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0;
    const place = (x: number, z: number, size: number): void => {
      e.set(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI);
      q.setFromEuler(e);
      p.set(x, this.surfaceY(x, z) + size * 0.15, z);
      s.set(size, size * rangeRng(rng, 0.45, 0.75), size * rangeRng(rng, 0.7, 1.2));
      crumbs.setMatrixAt(n, m.compose(p, q, s));
      this.crumbData.push({ pos: p.clone(), quat: q.clone(), scale: size });
      col.setHSL(rangeRng(rng, 0.08, 0.1), rangeRng(rng, 0.1, 0.18), rangeRng(rng, 0.45, 0.62));
      crumbs.setColorAt(n, col);
      n++;
    };
    // Broad flank scatter.
    for (let i = 0; i < 110; i++) {
      const a = rng() * Math.PI * 2;
      const r = rangeRng(rng, 0.25, MOUND.radius * 0.94);
      place(Math.cos(a) * r, Math.sin(a) * r, rangeRng(rng, 0.007, 0.018) * (0.6 + 0.6 * (r / MOUND.radius)));
    }
    // Crest cluster: the colony's front door traffic.
    for (let i = 0; i < 44; i++) {
      const a = rng() * Math.PI * 2;
      const r = 0.12 + Math.sqrt(rng()) * 0.8;
      place(Math.cos(a) * r, Math.sin(a) * r, rangeRng(rng, 0.006, 0.014));
    }
    // Hole-trail cluster: grit trailing down-slope from the entrance.
    const down = new THREE.Vector3(Math.cos(MOUND.holeAzimuth), 0, Math.sin(MOUND.holeAzimuth));
    for (let i = 0; i < 66; i++) {
      const t = Math.atan2(down.z, down.x) + rangeRng(rng, -0.6, 0.6);
      const d = rangeRng(rng, 0.05, 0.7);
      place(
        this.holePos.x + Math.cos(t) * d,
        this.holePos.z + Math.sin(t) * d,
        rangeRng(rng, 0.007, 0.017),
      );
    }
    // Cap-junction band: a ring of packed grit where the crest cap meets the
    // flank, so the cap reads as trampled crest earth, not a sticker.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.35;
      const r = 0.1 + rangeRng(rng, -0.014, 0.014);
      place(Math.cos(a) * r, Math.sin(a) * r, rangeRng(rng, 0.008, 0.015));
    }
    crumbs.count = n;
    crumbs.instanceMatrix.needsUpdate = true;
    this.crumbs = crumbs;
    this.group.add(crumbs);
  }

  /** A few embedded pebbles around the foot of the mound. */
  private buildPebbles(rng: Rng): void {
    const pebbles = new THREE.InstancedMesh(Anthill.pebbleGeo, this.crumbMat, 7);
    pebbles.castShadow = true;
    pebbles.receiveShadow = true;
    pebbles.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      const r = rangeRng(rng, 1.1, MOUND.radius * 0.96);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const size = rangeRng(rng, 0.024, 0.044);
      e.set(rangeRng(rng, -0.3, 0.3), rng() * Math.PI * 2, rangeRng(rng, -0.3, 0.3));
      q.setFromEuler(e);
      p.set(x, this.surfaceY(x, z) + size * 0.1, z);
      s.set(size, size * rangeRng(rng, 0.45, 0.7), size * rangeRng(rng, 0.75, 1.1));
      pebbles.setMatrixAt(i, m.compose(p, q, s));
      col.setHSL(rangeRng(rng, 0.06, 0.1), rangeRng(rng, 0.1, 0.24), rangeRng(rng, 0.34, 0.52));
      pebbles.setColorAt(i, col);
    }
    pebbles.instanceMatrix.needsUpdate = true;
    this.group.add(pebbles);
  }

  /** Precomputed deterministic pile slots (a tight golden heap by the hole —
   *  the visible quota progress bar; instances render at 1.15× grain scale). */
  private buildPileSlots(rng: Rng): void {
    // Pile sits on the camera side of the hole (WNW of it) so staged shots
    // and the natural approach both see the heap grow.
    const centerAz = MOUND.holeAzimuth - 0.55;
    const cx = this.holePos.x + Math.cos(centerAz) * 0.19;
    const cz = this.holePos.z + Math.sin(centerAz) * 0.19;
    const e = new THREE.Euler();
    for (let i = 0; i < MOUND.pileMax; i++) {
      const layer = i < 5 ? 0 : i < 10 ? 1 : 2;
      const a = rng() * Math.PI * 2;
      const d = (0.021 + Math.sqrt(rng()) * 0.091) * (1 - layer * 0.28);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const y = this.surfaceY(x, z) + 0.024 + layer * 0.045 + rangeRng(rng, -0.005, 0.005);
      e.set(rangeRng(rng, -0.9, -0.3), rng() * Math.PI * 2, rangeRng(rng, -0.5, 0.5));
      this.pileSlots.push({
        pos: new THREE.Vector3(x, y, z),
        quat: new THREE.Quaternion().setFromEuler(e),
        scale: rangeRng(rng, 0.8, 1.15),
      });
    }
  }

  private writePileGrain(i: number): void {
    const slot = this.pileSlots[i];
    const m = new THREE.Matrix4().compose(
      slot.pos,
      slot.quat,
      new THREE.Vector3().setScalar(slot.scale * 1.15),
    );
    this.pile.setMatrixAt(i, m);
  }

  /** Loose soil texture: warm mottle + crumb flecks, tiling. */
  private static crumbTexture(seed: number): THREE.Texture {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    const read = (x: number, y: number) => {
      const broad = fbm2(x * 0.035, y * 0.035, 2, seed + 13);
      const mid = fbm2(x * 0.11, y * 0.11, 2, seed + 29);
      const fine = fbm2(x * 0.3, y * 0.3, 2, seed + 47);
      return { broad, mid, fine };
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const { broad, mid, fine } = read(x, y);
        const n = 0.74 + broad * 0.26 + mid * 0.18 + fine * 0.12;
        const i = (y * size + x) * 4;
        img.data[i] = Math.min(255, Math.max(0, Math.round(n * (1 + broad * 0.22) * 190)));
        img.data[i + 1] = Math.min(255, Math.max(0, Math.round(n * (1 + broad * 0.06) * 158)));
        img.data[i + 2] = Math.min(255, Math.max(0, Math.round(n * (1 - broad * 0.18) * 112)));
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const rng = mulberry32(seed + 71);
    for (let i = 0; i < 900; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const w = 1 + rng() * 2.2;
      ctx.fillStyle = rng() < 0.55 ? "rgba(38,28,16,0.35)" : "rgba(214,196,158,0.28)";
      ctx.fillRect(x, y, w, w * (0.5 + rng()));
    }
    const tex = new THREE.CanvasTexture(canvas);
    // Continuous azimuthal UVs make the closing seam sample exactly one
    // repeat apart, so plain repeat wrapping is seamless here.
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
  }

  /** Near-black mouth with a faint warm bounce at the lower edge. */
  private static holeTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size * 0.46, size * 0.02, size / 2, size / 2, size * 0.52);
    grad.addColorStop(0, "#050302");
    grad.addColorStop(0.62, "#0d0805");
    grad.addColorStop(0.88, "#241407");
    grad.addColorStop(1, "#3a2513");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    // Faint soil texture so the mouth is not a flat decal.
    const rng = mulberry32(9001);
    for (let i = 0; i < 130; i++) {
      const x = rng() * size;
      const y = rng() * size;
      ctx.fillStyle = `rgba(70,45,22,${0.05 + rng() * 0.1})`;
      ctx.fillRect(x, y, 1 + rng() * 2, 1 + rng() * 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private static crumbGeo = new THREE.IcosahedronGeometry(1, 1);
  private static pebbleGeo = new THREE.IcosahedronGeometry(1, 1);
  /** Map-less packed-earth material for the crest cap (no texture ripple). */
  private static capMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 });
}
