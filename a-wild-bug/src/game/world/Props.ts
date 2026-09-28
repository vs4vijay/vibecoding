import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32, rangeRng, Rng, fbm2 } from "../util/Rng";

/**
 * Hero props for scale: big clover, pebbles, twigs, small sprouts. Each prop
 * registers a soft heightfield bump (walkable — the ant can climb them) and a
 * keep-out radius that thins the grass nearby.
 *
 * Spatial reservations for later milestones (do not place props here):
 *   - origin r < 2.2: the anthill mound (M2, worn dirt already painted there)
 *   - (6.5, -3.5): fallen-apple landmark (M2/M3)
 *   - (-8, 6): mushroom grove (M3)
 */
interface Bump {
  x: number;
  z: number;
  r: number;
  h: number;
}

interface KeepOut {
  x: number;
  z: number;
  r: number;
}

export class Props {
  readonly group = new THREE.Group();
  private readonly bumps: Bump[] = [];
  private readonly keepOut: KeepOut[] = [];


  constructor(seed: number, terrainHeight: (x: number, z: number) => number) {
    const rng = mulberry32(seed);

    // Angles chosen so two plants flank the orbit-shot frame near the origin.
    const cloverAngles = [0.55, 2.65, 3.9, 5.05];
    for (let i = 0; i < cloverAngles.length; i++) {
      const a = cloverAngles[i];
      const d = i === 0 ? 2.7 : i === 1 ? 2.4 : rangeRng(rng, 3.2, 5.6);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      this.addClover(rng, x, z, terrainHeight(x, z), rangeRng(rng, 0.75, 1.15));
    }

    for (let i = 0; i < 2; i++) {
      const a = 2.6 + i * 2.4 + rangeRng(rng, -0.4, 0.4);
      const d = rangeRng(rng, 7.5, 11);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      this.addPebble(rng, x, z, terrainHeight(x, z));
    }

    for (let i = 0; i < 3; i++) {
      const a = 0.9 + i * 2.1 + rangeRng(rng, -0.5, 0.5);
      const d = rangeRng(rng, 5, 12);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      this.addTwig(rng, x, z, terrainHeight(x, z));
    }

    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const d = rangeRng(rng, 2.6, 18);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      this.addSprout(rng, x, z, terrainHeight(x, z));
    }

    // Ground micro-detail: pebbles, husk debris, clover sprigs and twig bits
    // at the 1–5 cm scale, instanced (4 draw calls) and seeded.
    this.addMicroScatter(mulberry32(seed ^ 0x1b873593), terrainHeight);
    // Far landmark silhouettes for the orbit shot's third depth layer.
    this.addLandmarks(mulberry32(seed ^ 0x2f1bc3d5), terrainHeight);
  }

  /** Extra walkable height from prop bodies (domes), added on top of terrain. */
  bumpHeight(x: number, z: number): number {
    let h = 0;
    for (let i = 0; i < this.bumps.length; i++) {
      const b = this.bumps[i];
      const dx = x - b.x;
      const dz = z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > b.r * b.r) continue;
      const f = 1 - d2 / (b.r * b.r);
      h = Math.max(h, b.h * f * f * 1.2);
    }
    return h;
  }

  /** 0..1 grass density multiplier around props (0 = no grass). */
  maskAt(x: number, z: number): number {
    let m = 1;
    for (let i = 0; i < this.keepOut.length; i++) {
      const k = this.keepOut[i];
      const d = Math.hypot(x - k.x, z - k.z);
      m *= THREE.MathUtils.smoothstep(d, k.r * 0.5, k.r);
      if (m < 0.01) return 0;
    }
    return m;
  }

  private addBumpAndKeepOut(x: number, z: number, r: number, h: number, keepR: number): void {
    this.bumps.push({ x, z, r, h });
    this.keepOut.push({ x, z, r: keepR });
  }

  private addClover(rng: Rng, x: number, z: number, y: number, scale: number): void {
    const plant = new THREE.Group();
    const leaflets = 3 + (rng() < 0.4 ? 1 : 0);
    for (let i = 0; i < leaflets; i++) {
      const stemH = rangeRng(rng, 0.22, 0.4) * scale;
      const yaw = (i / leaflets) * Math.PI * 2 + rangeRng(rng, -0.3, 0.3);
      const tilt = rangeRng(rng, 0.45, 0.75);

      const stem = new THREE.Mesh(Props.stemGeo, Props.stemMat);
      stem.scale.set(1, stemH, 1);
      stem.position.set(0, stemH / 2, 0);
      const dir = new THREE.Group();
      dir.rotation.set(0, yaw, 0);
      dir.add(stem);

      const leaf = new THREE.Mesh(Props.leafletGeo, Props.leafletMat);
      const lr = rangeRng(rng, 0.4, 0.62) * scale;
      leaf.scale.setScalar(lr);
      leaf.position.y = stemH;
      leaf.rotation.set(0, rangeRng(rng, -0.5, 0.5), 0);
      // Leaflet geometry points -Y (tip at stem); tilt it up and outward.
      leaf.rotateX(-Math.PI / 2 + tilt);
      dir.add(leaf);
      plant.add(dir);
    }
    plant.position.set(x, y - 0.02, z);
    plant.rotation.y = rng() * Math.PI * 2;
    plant.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(plant);
    this.addBumpAndKeepOut(x, z, 0.28 * scale, 0.05, 0.75 * scale);
  }

  private addSprout(rng: Rng, x: number, z: number, y: number): void {
    const g = new THREE.Group();
    const stemH = rangeRng(rng, 0.08, 0.16);
    const stem = new THREE.Mesh(Props.stemGeo, Props.stemMat);
    stem.scale.set(0.8, stemH, 0.8);
    stem.position.y = stemH / 2;
    g.add(stem);
    const leaf = new THREE.Mesh(Props.leafletGeo, Props.leafletMat);
    leaf.scale.setScalar(rangeRng(rng, 0.11, 0.18));
    leaf.position.y = stemH;
    leaf.rotateX(-Math.PI / 2 + rangeRng(rng, 0.5, 0.9));
    leaf.rotation.y = rng() * Math.PI * 2;
    g.add(leaf);
    g.position.set(x, y - 0.02, z);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(g);
    this.addBumpAndKeepOut(x, z, 0.12, 0.02, 0.3);
  }

  private addPebble(rng: Rng, x: number, z: number, y: number): void {
    const geo = Props.pebbleGeo.clone();
    // Radial perturbation so the pebble is not a perfect icosahedron.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const n = 1 + fbm2(pos.getX(i) * 2.1, pos.getY(i) * 2.1 + pos.getZ(i), 2, 7) * 0.14;
      pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n, pos.getZ(i) * n);
    }
    geo.computeVertexNormals();

    const mat = Props.pebbleMat.clone();
    mat.color.offsetHSL(rangeRng(rng, -0.01, 0.01), rangeRng(rng, -0.04, 0.04), rangeRng(rng, -0.05, 0.05));
    const pebble = new THREE.Mesh(geo, mat);
    const sx = rangeRng(rng, 0.5, 0.78);
    const sy = rangeRng(rng, 0.32, 0.48);
    pebble.scale.set(sx, sy, rangeRng(rng, 0.5, 0.78));
    pebble.rotation.set(rangeRng(rng, -0.15, 0.15), rng() * Math.PI * 2, rangeRng(rng, -0.15, 0.15));
    pebble.position.set(x, y + sy * 0.25, z);
    pebble.castShadow = true;
    pebble.receiveShadow = true;
    this.group.add(pebble);
    this.addBumpAndKeepOut(x, z, Math.max(sx, pebble.scale.z) * 0.95, sy * 0.85, sx + 0.25);
  }

  private addTwig(rng: Rng, x: number, z: number, y: number): void {
    const len = rangeRng(rng, 0.8, 1.3);
    const yaw = rng() * Math.PI * 2;
    const dirX = Math.cos(yaw);
    const dirZ = Math.sin(yaw);
    const pts: THREE.Vector3[] = [];
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      pts.push(
        new THREE.Vector3(
          x + dirX * (f - 0.5) * len,
          y + 0.028 + Math.sin(f * Math.PI) * 0.03 + fbm2(f * 3, yaw * 4, 2, 3) * 0.012,
          z + dirZ * (f - 0.5) * len,
        ),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const twig = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.032, 6, false), Props.twigMat);

    // A short side branch.
    const bp = curve.getPoint(0.35);
    const branchEnd = bp
      .clone()
      .add(new THREE.Vector3(dirX, 0, dirZ).multiplyScalar(0.3))
      .add(new THREE.Vector3(0, 0.12, 0));
    const branch = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.LineCurve3(bp, branchEnd), 3, 0.016, 5, false),
      Props.twigMat,
    );

    for (const m of [twig, branch]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    for (let i = 0; i <= 5; i++) {
      const p = curve.getPoint(i / 5);
      this.addBumpAndKeepOut(p.x, p.z, 0.07, 0.055, 0.34);
    }
  }

  /**
   * Pikmin-style dirt dressing at the 1–5 cm scale: four InstancedMeshes
   * (pebbles, husk debris, clover sprigs, twig bits) scattered with a
   * sqrt-biased density toward the play area. Too small to walk on, so no
   * bumps/keep-outs are registered.
   */
  private addMicroScatter(rng: Rng, terrainHeight: (x: number, z: number) => number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();

    const spot = (maxR: number, minR = 1.1) => {
      const a = rng() * Math.PI * 2;
      const d = minR + (maxR - minR) * Math.pow(rng(), 1.35);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d };
    };

    const pebbles = new THREE.InstancedMesh(Props.microPebbleGeo, Props.microPebbleMat, 240 + 54);
    pebbles.receiveShadow = true;
    let pi = 0;
    const placePebble = (x: number, z: number, r: number) => {
      if (pi >= 240 + 54) return;
      e.set(rangeRng(rng, -0.3, 0.3), rng() * Math.PI * 2, rangeRng(rng, -0.3, 0.3));
      q.setFromEuler(e);
      // Half-buried scale variants: ~half the grit sits sunk and squashed so
      // clusters read as embedded soil, not a tray of uniform egg domes.
      const buried = rng() < 0.5;
      p.set(x, terrainHeight(x, z) + r * (buried ? rangeRng(rng, 0.0, 0.12) : 0.32), z);
      s.set(
        r,
        r * (buried ? rangeRng(rng, 0.3, 0.5) : rangeRng(rng, 0.55, 0.85)),
        r * rangeRng(rng, 0.75, 1.15),
      );
      pebbles.setMatrixAt(pi, m.compose(p, q, s));
      // Soil-toned variety: a wide tan band (saturation 0.04–0.32, lightness
      // 0.3–0.68) plus ~15% weathered-gray / damp-brown outliers, so the
      // run-front corridor reads as grit rather than a cream egg-clutch.
      if (rng() < 0.15) {
        if (rng() < 0.5) {
          col.setHSL(rangeRng(rng, 0.05, 0.12), rangeRng(rng, 0.02, 0.07), rangeRng(rng, 0.34, 0.6));
        } else {
          col.setHSL(rangeRng(rng, 0.055, 0.09), rangeRng(rng, 0.2, 0.36), rangeRng(rng, 0.24, 0.36));
        }
      } else {
        col.setHSL(rangeRng(rng, 0.05, 0.15), rangeRng(rng, 0.04, 0.32), rangeRng(rng, 0.3, 0.68));
      }
      pebbles.setColorAt(pi, col);
      pi++;
    };
    for (let i = 0; i < 240; i++) {
      const { x, z } = spot(26);
      placePebble(x, z, rangeRng(rng, 0.012, 0.05));
    }
    // Hand-biased clusters along the choreographed run lane and the mid-ground
    // of the grass-closeup sight line — near ground never reads airbrushed.
    // (Kept ≥1.4 units from the closeup lens pocket at (0.4, 6.5) so no
    // cluster balloons in the lens.)
    const corridors: [number, number][] = [
      [0.55, 3.15], [-0.4, 3.8], [0.8, 4.55], [-0.55, 5.2], [0.35, 5.35], [-0.25, 4.15],
    ];
    for (const [cx, cz] of corridors) {
      const ccx = cx + rangeRng(rng, -0.12, 0.12);
      const ccz = cz + rangeRng(rng, -0.12, 0.12);
      const clusterR = rangeRng(rng, 0.16, 0.28);
      const n = 6 + Math.floor(rng() * 5);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const d = clusterR * Math.sqrt(rng());
        placePebble(ccx + Math.cos(a) * d, ccz + Math.sin(a) * d, rangeRng(rng, 0.01, 0.026));
      }
    }
    // Unwritten slots default to identity matrices — unit-radius boulders at
    // the origin — so the mesh count must match what was actually placed.
    pebbles.count = pi;
    this.group.add(pebbles);

    const debris = new THREE.InstancedMesh(Props.debrisGeo, Props.debrisMat, 320);
    debris.receiveShadow = true;
    for (let i = 0; i < 320; i++) {
      const { x, z } = spot(24);
      const r = rangeRng(rng, 0.012, 0.04);
      e.set(rangeRng(rng, -0.25, 0.25), rng() * Math.PI * 2, rangeRng(rng, -0.25, 0.25));
      q.setFromEuler(e);
      p.set(x, terrainHeight(x, z) + r * 0.1, z);
      // xz anisotropy clamped to 0.9 (was 1.2): longer flakes smeared into
      // stretched pale shards at grazing angles along the run lane.
      s.set(r, r * 0.22, r * rangeRng(rng, 0.6, 0.9));
      debris.setMatrixAt(i, m.compose(p, q, s));
      // Husks: dry browns and olive, occasional pale seed coat.
      if (rng() < 0.18) col.setHSL(0.13, rangeRng(rng, 0.2, 0.35), rangeRng(rng, 0.5, 0.65));
      else col.setHSL(rangeRng(rng, 0.07, 0.11), rangeRng(rng, 0.3, 0.5), rangeRng(rng, 0.22, 0.4));
      debris.setColorAt(i, col);
    }
    this.group.add(debris);

    const sprigs = new THREE.InstancedMesh(Props.leafletGeo, Props.leafletMat, 170);
    sprigs.receiveShadow = true;
    for (let i = 0; i < 170; i++) {
      const { x, z } = spot(22);
      const r = rangeRng(rng, 0.045, 0.1);
      e.set(0, rng() * Math.PI * 2, 0);
      q.setFromEuler(e);
      p.set(x, terrainHeight(x, z) + 0.004, z);
      s.setScalar(r);
      sprigs.setMatrixAt(i, m.compose(p, q, s));
      // Leaflet geometry points -Y; lay it nearly flat on the soil.
      sprigs.getMatrixAt(i, m);
      const flip = new THREE.Matrix4().makeRotationX(-Math.PI / 2 + rangeRng(rng, 0.9, 1.35));
      sprigs.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(m, flip));
      col.setHSL(rangeRng(rng, 0.25, 0.32), rangeRng(rng, 0.4, 0.6), rangeRng(rng, 0.3, 0.42));
      sprigs.setColorAt(i, col);
    }
    this.group.add(sprigs);

    const twigs = new THREE.InstancedMesh(Props.twigBitGeo, Props.twigMat, 110);
    twigs.receiveShadow = true;
    for (let i = 0; i < 110; i++) {
      const { x, z } = spot(24);
      const len = rangeRng(rng, 0.03, 0.09);
      e.set(Math.PI / 2 + rangeRng(rng, -0.2, 0.2), 0, rangeRng(rng, -0.2, 0.2));
      const q2 = new THREE.Quaternion().setFromEuler(e);
      const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      p.set(x, terrainHeight(x, z) + 0.006, z);
      s.set(1, len, 1);
      twigs.setMatrixAt(i, m.compose(p, qYaw.multiply(q2), s));
    }
    this.group.add(twigs);
  }

  /**
   * Far silhouettes (ant-scale "trees" = dry seed stalks, plus a boulder) for
   * the orbit establishing shot's third depth layer. Positions are fixed so
   * they land in the choreographed frame; shapes jitter from the seeded rng.
   */
  private addLandmarks(rng: Rng, terrainHeight: (x: number, z: number) => number): void {
    const at = (bearing: number, d: number) => ({ x: Math.sin(bearing) * d, z: Math.cos(bearing) * d });
    const rock = at(-2.28, 48);
    this.addBoulder(rng, rock.x, rock.z, terrainHeight(rock.x, rock.z), 3.4);
    const stalkA = at(-2.75, 54);
    this.addStalkTree(rng, stalkA.x, stalkA.z, terrainHeight(stalkA.x, stalkA.z));
    const stalkB = at(-1.72, 61);
    this.addStalkTree(rng, stalkB.x, stalkB.z, terrainHeight(stalkB.x, stalkB.z));
  }

  private addBoulder(rng: Rng, x: number, z: number, y: number, s: number): void {
    const geo = Props.pebbleGeo.clone();
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const n = 1 + fbm2(pos.getX(i) * 1.7, pos.getY(i) * 1.7 + pos.getZ(i), 2, 11) * 0.12;
      pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n, pos.getZ(i) * n);
    }
    geo.computeVertexNormals();
    const boulder = new THREE.Mesh(geo, Props.boulderMat);
    boulder.scale.set(s, s * rangeRng(rng, 0.5, 0.62), s * rangeRng(rng, 0.72, 0.9));
    boulder.rotation.set(rangeRng(rng, -0.06, 0.06), rng() * Math.PI * 2, rangeRng(rng, -0.06, 0.06));
    boulder.position.set(x, y + boulder.scale.y * 0.28, z);
    boulder.castShadow = true;
    boulder.receiveShadow = true;
    this.group.add(boulder);
    this.addBumpAndKeepOut(x, z, s * 0.85, s * 0.22, s * 1.2);
  }

  /** A towering dry seed stalk — an ant's "tree": bare trunk, up-reaching
   *  branches, seed heads. Merged into a single mesh (1 draw call each). */
  private addStalkTree(rng: Rng, x: number, z: number, y: number): void {
    const parts: THREE.BufferGeometry[] = [];
    const h = rangeRng(rng, 8.5, 11.5);
    const bendA = rng() * Math.PI * 2;
    const bend = rangeRng(rng, 0.5, 1.4);
    const pts: THREE.Vector3[] = [];
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      pts.push(
        new THREE.Vector3(
          x + Math.cos(bendA) * f * f * bend,
          y + f * h,
          z + Math.sin(bendA) * f * f * bend,
        ),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    parts.push(new THREE.TubeGeometry(curve, 10, 0.055, 5, false).toNonIndexed());

    const branches = 3 + Math.floor(rng() * 2);
    for (let b = 0; b < branches; b++) {
      const t = rangeRng(rng, 0.55, 0.9);
      const bp = curve.getPoint(t);
      const yaw = rng() * Math.PI * 2;
      const len = rangeRng(rng, 1.0, 2.0);
      const end = bp
        .clone()
        .add(new THREE.Vector3(Math.cos(yaw) * len, rangeRng(rng, 0.35, 0.9) * len, Math.sin(yaw) * len));
      parts.push(new THREE.TubeGeometry(new THREE.LineCurve3(bp, end), 3, 0.02, 4, false).toNonIndexed());
      const head = new THREE.IcosahedronGeometry(rangeRng(rng, 0.14, 0.26), 1).translate(end.x, end.y, end.z);
      parts.push(head);
    }
    const merged = mergeGeometries(parts, false);
    if (!merged) return;
    const stalk = new THREE.Mesh(merged, Props.stalkMat);
    stalk.castShadow = true;
    stalk.receiveShadow = true;
    this.group.add(stalk);
    this.addBumpAndKeepOut(x, z, 0.15, 0.08, 0.6);
  }

  // Shared geometry/materials (cloned where mutated).
  private static leafletGeo = Props.buildLeafletGeo();
  private static stemGeo = new THREE.CylinderGeometry(0.008, 0.014, 1, 5).translate(0, 0.5, 0);
  private static pebbleGeo = new THREE.IcosahedronGeometry(1, 2);
  private static microPebbleGeo = new THREE.IcosahedronGeometry(1, 1);
  private static debrisGeo = new THREE.IcosahedronGeometry(1, 0);
  private static twigBitGeo = new THREE.CylinderGeometry(0.004, 0.006, 1, 5).translate(0, -0.5, 0);
  private static leafletMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.75,
    side: THREE.DoubleSide,
  });
  private static stemMat = new THREE.MeshStandardMaterial({ color: 0x5d8a3a, roughness: 0.9 });
  private static pebbleMat = new THREE.MeshStandardMaterial({ color: 0x8f8677, roughness: 0.55 });
  private static microPebbleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  private static debrisMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  private static twigMat = new THREE.MeshStandardMaterial({ color: 0x6a4e30, roughness: 0.95 });
  private static boulderMat = new THREE.MeshStandardMaterial({ color: 0x86796a, roughness: 0.92 });
  private static stalkMat = new THREE.MeshStandardMaterial({ color: 0x8f7c50, roughness: 1 });

  /** Heart-shaped clover leaflet, tip at origin pointing down (-Y), notch up. */
  private static buildLeafletGeo(): THREE.BufferGeometry {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.42, -0.12, 0.52, -0.42, 0.3, -0.72);
    s.bezierCurveTo(0.1, -0.92, 0.0, -0.78, 0.0, -0.66);
    s.bezierCurveTo(0.0, -0.78, -0.1, -0.92, -0.3, -0.72);
    s.bezierCurveTo(-0.52, -0.42, -0.42, -0.12, 0, 0);

    const geo = new THREE.ShapeGeometry(s, 14);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const edge = new THREE.Color(0x3f7d33);
    const center = new THREE.Color(0x6ba848);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      // Gentle dome + fold along the midrib.
      const dome = Math.max(0, 1 - (px * px + py * py) * 0.9) * 0.05;
      pos.setZ(i, dome - Math.abs(px) * 0.14);
      const c = edge.clone().lerp(center, Math.max(0, 1 - Math.abs(px) * 3.4));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }
}
