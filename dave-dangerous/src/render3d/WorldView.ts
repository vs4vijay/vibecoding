// src/render3d/WorldView.ts
// Builds the 3D playfield from the sim TileMap plus the parallax cavern
// backdrop: beveled tile bodies with baked vertex AO, moss caps on exposed
// tops, sunken lava trenches with animated emissive pools + ember lights,
// climbable root columns with swaying foliage, spike rows, illusory walls,
// stalactite ceiling and foreground rubble. All static geometry is merged per
// material (≈15 draw calls for the whole world including backdrop).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { getMaterial, updateMaterialTime, type MatName } from "./materials";
import type { LightingRig } from "./Lighting";
import { PALETTE } from "./palette";
import { PHYSICS } from "../core/types";
import type { TileMap } from "../world/TileMap";

const T_GROUND = 1;
const T_BRICK = 2;
const T_LAVA = 3;
const T_TREE = 4;
const T_SPIKES = 6;

interface Batch {
  mat: MatName;
  geos: THREE.BufferGeometry[];
  cast: boolean;
  receive: boolean;
}

interface BackdropLayer {
  mesh: THREE.Mesh;
  k: number; // parallax response to setParallax()
  ampX: number;
  ampY: number;
  speed: number;
  phase: number;
}

// ---------------------------------------------------------------------------
// Deterministic helpers (structural placement NEVER uses Math.random)
// ---------------------------------------------------------------------------

function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Expand indexed primitives to non-indexed so every playfield batch merges. */
function toNI(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.index) {
    const ni = geo.toNonIndexed();
    geo.dispose();
    return ni;
  }
  return geo;
}

/** Per-tile UV offset (breaks texture repetition; textures wrap). */
function jitterUV(geo: THREE.BufferGeometry, ox: number, oy: number): void {
  const uv = geo.getAttribute("uv");
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + ox, uv.getY(i) + oy);
}

/** aoMap samples channel 1 — duplicate uv so baked AO works on merged meshes. */
function addUv1(geo: THREE.BufferGeometry): void {
  const uv = geo.getAttribute("uv");
  if (uv && !geo.getAttribute("uv1")) geo.setAttribute("uv1", uv.clone());
}

/** Uniform brightness multiplier baked into vertex colors. */
function paintFlat(geo: THREE.BufferGeometry, b: number): void {
  const count = geo.getAttribute("position").count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = b;
    arr[i * 3 + 1] = b;
    arr[i * 3 + 2] = b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

/** Directional AO: bright tops, darker sides, darkest undersides, faint cool
 *  tint on sides. Multiplied by per-tile variance and lava scorch. */
function paintShaded(geo: THREE.BufferGeometry, variance: number, scorch: number): void {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i);
    let b: number;
    let cool = 0;
    if (ny > 0.5) b = 1.0;
    else if (ny < -0.5) {
      b = 0.42;
      cool = 0.04;
    } else {
      b = 0.6;
      cool = 0.05;
    }
    b *= variance * scorch;
    arr[i * 3] = b * (1 - cool);
    arr[i * 3 + 1] = b;
    arr[i * 3 + 2] = Math.min(1, b * (1 + cool));
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

/** Foliage sway weight: 0 at the branch base → 1 toward the tips. */
function swayAttr(geo: THREE.BufferGeometry, baseY: number): void {
  const pos = geo.getAttribute("position");
  const arr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - baseY) / 1.4;
    arr[i] = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  geo.setAttribute("aSway", new THREE.BufferAttribute(arr, 1));
}

export class WorldView {
  readonly root = new THREE.Group();
  readonly backdrop = new THREE.Group();

  private scene: THREE.Scene;
  private lighting: LightingRig;
  private batches: Array<{ mesh: THREE.Mesh; geo: THREE.BufferGeometry }> = [];
  private layers: BackdropLayer[] = [];
  private layerMats: THREE.ShaderMaterial[] = [];
  private layerGeos: THREE.BufferGeometry[] = [];
  private gradient: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; geo: THREE.BufferGeometry } | null = null;
  private crystalMesh: { mesh: THREE.Mesh; geo: THREE.BufferGeometry } | null = null;
  private embers: THREE.PointLight[] = [];
  private parX = 0;
  private parY = 0;

  constructor(scene: THREE.Scene, lighting: LightingRig) {
    this.scene = scene;
    this.lighting = lighting;
    this.root.name = "world";
    this.backdrop.name = "backdrop";
    scene.add(this.root);
    scene.add(this.backdrop);
    this.buildGradient();
    this.buildBackdrop();
  }

  /** Rebuild geometry for a (new) tilemap. Disposes previous playfield meshes;
   *  the backdrop, gradient and ember-light pool persist across levels. */
  buildFromTileMap(map: TileMap): void {
    this.clearPlayfield();

    const W = map.width;
    const H = map.height;
    const idAt = (tx: number, ty: number): number => {
      const d = map.at(tx, ty);
      return d ? d.id : 0;
    };
    const covered = (id: number): boolean => id === T_GROUND || id === T_BRICK || id === T_SPIKES;

    const mk = (mat: MatName, cast: boolean, receive: boolean): Batch => ({ mat, geos: [], cast, receive });
    const ground = mk("ground", true, true);
    const ceiling = mk("ground", false, false);
    const moss = mk("groundTop", false, true);
    const brick = mk("brick", true, true);
    const lava = mk("lava", false, false);
    const illus = mk("illusory", false, false);
    const spikes = mk("spikes", true, true);
    const trunk = mk("treeTrunk", true, true);
    const foliage = mk("tree", true, true);
    const bone = mk("bone", true, true);

    // ---- playfield tiles -------------------------------------------------
    for (let ty = 0; ty < H; ty++) {
      const cyTop = -ty;
      const cy = -(ty + 0.5);
      const cyBot = -(ty + 1);
      for (let tx = 0; tx < W; tx++) {
        const def = map.at(tx, ty);
        if (!def || def.id === 0) continue;
        const cx = tx + 0.5;
        const h1 = hash2(tx, ty, 1);
        const h2 = hash2(tx, ty, 2);
        const h3 = hash2(tx, ty, 3);

        switch (def.id) {
          case T_GROUND: {
            const depth = 1.25 + h1 * 0.35;
            const g = toNI(new RoundedBoxGeometry(1, 1, depth, 1, 0.05));
            jitterUV(g, h2, h3);
            g.translate(cx, cy, 0);
            const scorch =
              idAt(tx - 1, ty) === T_LAVA || idAt(tx + 1, ty) === T_LAVA || idAt(tx, ty - 1) === T_LAVA ? 0.55 : 1;
            paintShaded(g, 0.9 + h3 * 0.18, scorch);
            addUv1(g);
            ground.geos.push(g);
            if (!covered(idAt(tx, ty - 1)) && h2 > 0.22) {
              const cap = toNI(new RoundedBoxGeometry(0.94 + h3 * 0.06, 0.14, depth * 0.92, 1, 0.045));
              jitterUV(cap, h3, h1);
              cap.translate(cx, cyTop + 0.02, 0);
              paintFlat(cap, 0.8 + h1 * 0.25);
              addUv1(cap);
              moss.geos.push(cap);
            }
            break;
          }
          case T_BRICK: {
            const depth = 0.95 + h1 * 0.25;
            const b = toNI(new RoundedBoxGeometry(1, 1, depth, 1, 0.07));
            jitterUV(b, h2, h3);
            b.translate(cx, cy, 0);
            paintShaded(b, 0.92 + h3 * 0.14, 1);
            addUv1(b);
            brick.geos.push(b);
            if (!covered(idAt(tx, ty + 1))) {
              const truss = toNI(new THREE.BoxGeometry(0.62, 0.2, depth * 0.55));
              truss.translate(cx, cyBot - 0.06, 0);
              paintFlat(truss, 0.5);
              addUv1(truss);
              brick.geos.push(truss);
            }
            if (!covered(idAt(tx, ty - 1)) && h2 > 0.5) {
              const cap = toNI(new RoundedBoxGeometry(0.92 + h3 * 0.05, 0.12, depth * 0.88, 1, 0.04));
              jitterUV(cap, h1, h3);
              cap.translate(cx, cyTop + 0.02, 0);
              paintFlat(cap, 0.75 + h1 * 0.25);
              addUv1(cap);
              moss.geos.push(cap);
            }
            break;
          }
          case T_LAVA: {
            const surfaceY = cyTop - 0.4; // pool sits 0.4 below the floor line
            const wallH = 0.72;
            const dz = 1.2;
            const floor = toNI(new THREE.BoxGeometry(0.98, 0.14, dz));
            floor.translate(cx, cyBot + 0.05, 0);
            paintFlat(floor, 0.38);
            addUv1(floor);
            ground.geos.push(floor);
            if (idAt(tx - 1, ty) !== T_LAVA) {
              const wl = toNI(new THREE.BoxGeometry(0.16, wallH, dz));
              wl.translate(cx - 0.42, surfaceY - wallH / 2, 0);
              paintFlat(wl, 0.32);
              addUv1(wl);
              ground.geos.push(wl);
            }
            if (idAt(tx + 1, ty) !== T_LAVA) {
              const wr = toNI(new THREE.BoxGeometry(0.16, wallH, dz));
              wr.translate(cx + 0.42, surfaceY - wallH / 2, 0);
              paintFlat(wr, 0.32);
              addUv1(wr);
              ground.geos.push(wr);
            }
            const wb = toNI(new THREE.BoxGeometry(0.84, wallH, 0.16));
            wb.translate(cx, surfaceY - wallH / 2, -0.42);
            paintFlat(wb, 0.3);
            addUv1(wb);
            ground.geos.push(wb);
            // glowing pool surface, tilted so the camera always reads it
            const surf = toNI(new THREE.PlaneGeometry(0.98, 0.98, 5, 5));
            surf.rotateX(-Math.PI / 2 + 0.42);
            jitterUV(surf, h2, h3);
            surf.translate(cx, surfaceY, 0.02);
            lava.geos.push(surf);
            // glowing trench face below the surface line
            const skirt = toNI(new THREE.PlaneGeometry(0.98, 0.6, 1, 3));
            skirt.translate(cx, surfaceY - 0.27, 0.5);
            lava.geos.push(skirt);
            break;
          }
          case T_TREE: {
            const treeAbove = idAt(tx, ty - 1) === T_TREE;
            const treeBelow = idAt(tx, ty + 1) === T_TREE;
            const tr = toNI(new THREE.CylinderGeometry(0.1 + h1 * 0.045, 0.17 + h2 * 0.05, 1.04, 6, 1));
            tr.translate(cx + (h3 - 0.5) * 0.06, cy, 0);
            paintFlat(tr, 0.6 + h1 * 0.22);
            addUv1(tr);
            trunk.geos.push(tr);
            if (!treeBelow) {
              for (let k = 0; k < 3; k++) {
                const a = hash2(tx, ty, 60 + k) * Math.PI * 2;
                const root = toNI(new THREE.ConeGeometry(0.05, 0.34, 5));
                root.rotateZ(-Math.PI / 2);
                root.rotateY(a);
                root.translate(cx + Math.cos(a) * 0.16, cyBot + 0.1, Math.sin(a) * 0.16);
                paintFlat(root, 0.55);
                addUv1(root);
                trunk.geos.push(root);
              }
            }
            if (!treeAbove) {
              const n = 3 + Math.floor(h1 * 3);
              for (let k = 0; k < n; k++) {
                const r = 0.18 + hash2(tx, ty, 10 + k) * 0.2;
                const blob = toNI(new THREE.IcosahedronGeometry(r, 1));
                blob.scale(1, 0.85, 0.9);
                blob.translate(
                  cx + (hash2(tx, ty, 20 + k) - 0.5) * 0.55,
                  cyTop - 0.06 - hash2(tx, ty, 30 + k) * 0.32,
                  (hash2(tx, ty, 40 + k) - 0.5) * 0.5,
                );
                swayAttr(blob, cyBot);
                paintFlat(blob, 0.72 + hash2(tx, ty, 50 + k) * 0.32);
                addUv1(blob);
                foliage.geos.push(blob);
              }
            } else if (h2 > 0.55) {
              const blob = toNI(new THREE.IcosahedronGeometry(0.15 + h3 * 0.08, 1));
              blob.translate(cx + (h2 > 0.77 ? 0.3 : -0.3), cy, (h3 - 0.5) * 0.4);
              swayAttr(blob, cyBot);
              paintFlat(blob, 0.7 + h1 * 0.3);
              addUv1(blob);
              foliage.geos.push(blob);
            }
            break;
          }
          case 5: {
            const box = toNI(new THREE.BoxGeometry(1.002, 1.002, 0.9 + h1 * 0.3));
            box.translate(cx, cy, 0);
            illus.geos.push(box);
            break;
          }
          case T_SPIKES: {
            const base = toNI(new RoundedBoxGeometry(0.96, 0.14, 0.8, 1, 0.03));
            base.translate(cx, cyBot + 0.09, 0.1);
            addUv1(base);
            spikes.geos.push(base);
            for (let k = 0; k < 5; k++) {
              const sh = 0.42 + hash2(tx, ty, 80 + k) * 0.18;
              const cone = toNI(new THREE.ConeGeometry(0.065 + hash2(tx, ty, 90 + k) * 0.02, sh, 5));
              cone.rotateZ((hash2(tx, ty, 95 + k) - 0.5) * 0.16);
              cone.translate(cx - 0.36 + k * 0.18, cyBot + 0.14 + sh / 2, 0.1);
              addUv1(cone);
              spikes.geos.push(cone);
            }
            break;
          }
        }
      }
    }

    // ---- stalactite ceiling over the playfield (front + back rows) --------
    const band = toNI(new THREE.BoxGeometry(W + 8, 1.6, 4.6));
    band.translate(W / 2, 1.35, -0.2);
    paintFlat(band, 0.5);
    addUv1(band);
    ceiling.geos.push(band);
    let sx = -3;
    let si = 0;
    while (sx < W + 3) {
      const front = si % 2 === 0;
      const r = 0.1 + hash2(si, 1, 7) * 0.2;
      const len = front ? 0.35 + hash2(si, 2, 7) * 0.85 : 0.6 + hash2(si, 2, 7) * 1.6;
      const cone = toNI(new THREE.ConeGeometry(r, len, 5));
      cone.rotateX(Math.PI);
      const zRow = front ? 0.9 : -1.5 - hash2(si, 4, 7) * 0.7;
      cone.translate(sx + (hash2(si, 3, 7) - 0.5) * 0.4, 0.55 - len / 2, zRow);
      paintFlat(cone, 0.5 + hash2(si, 5, 7) * 0.15);
      addUv1(cone);
      ceiling.geos.push(cone);
      sx += 0.5 + hash2(si, 6, 7) * 1.15;
      si++;
    }

    // ---- foreground rubble + bones (never inside the collision lanes) -----
    const floorRow = H - 1;
    const floorTopY = -(H - 1);
    const ledgeTiles: number[] = [];
    for (let tx = 0; tx < W; tx++) if (idAt(tx, floorRow) === T_GROUND) ledgeTiles.push(tx);
    if (ledgeTiles.length > 0) {
      for (let k = 0; k < 10; k++) {
        const tx = ledgeTiles[Math.floor(hash2(k, 11, 21) * ledgeTiles.length)]!;
        const rock = toNI(new THREE.IcosahedronGeometry(0.09 + hash2(k, 12, 21) * 0.13, 0));
        rock.scale(1, 0.55 + hash2(k, 13, 21) * 0.25, 1);
        rock.rotateY(hash2(k, 14, 21) * Math.PI);
        rock.translate(
          tx + 0.25 + hash2(k, 15, 21) * 0.5,
          floorTopY + 0.06,
          0.92 + hash2(k, 16, 21) * 0.25,
        );
        paintFlat(rock, 0.55 + hash2(k, 17, 21) * 0.2);
        addUv1(rock);
        ground.geos.push(rock);
      }
      const boneCount = 2 + Math.floor(hash2(1, 1, 99) * 2);
      for (let k = 0; k < boneCount; k++) {
        const tx = ledgeTiles[Math.floor(hash2(k, 21, 31) * ledgeTiles.length)]!;
        const dir = hash2(k, 22, 31) * Math.PI;
        const bx = tx + 0.3 + hash2(k, 23, 31) * 0.4;
        const bz = 1.0 + hash2(k, 24, 31) * 0.3;
        const by = floorTopY + 0.05;
        const shaft = toNI(new THREE.CylinderGeometry(0.026, 0.03, 0.3, 5));
        shaft.rotateZ(Math.PI / 2);
        shaft.rotateY(dir);
        shaft.translate(bx, by, bz);
        addUv1(shaft);
        bone.geos.push(shaft);
        for (const s of [-1, 1]) {
          const knob = toNI(new THREE.SphereGeometry(0.045, 6, 4));
          knob.translate(bx + Math.cos(dir) * 0.15 * s, by, bz - Math.sin(dir) * 0.15 * s);
          addUv1(knob);
          bone.geos.push(knob);
        }
      }
    }
    // small debris on the back edge of exposed ledges (behind the play lane)
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        if (idAt(tx, ty) !== T_GROUND || covered(idAt(tx, ty - 1))) continue;
        const hh = hash2(tx, ty, 41);
        if (hh > 0.88) {
          const rock = toNI(new THREE.IcosahedronGeometry(0.07 + (hh - 0.88) * 0.6, 0));
          rock.scale(1, 0.6, 1);
          rock.translate(tx + 0.3 + hash2(tx, ty, 42) * 0.4, cyTopOf(ty) + 0.05, -0.62);
          paintFlat(rock, 0.6);
          addUv1(rock);
          ground.geos.push(rock);
        }
      }
    }

    // ---- ember lights along lava runs (2-3 per run, pooled) ---------------
    let used = 0;
    for (let ty = 0; ty < H; ty++) {
      let tx = 0;
      while (tx < W) {
        if (idAt(tx, ty) === T_LAVA) {
          let end = tx;
          while (end < W && idAt(end, ty) === T_LAVA) end++;
          const len = end - tx;
          const count = Math.min(3, Math.max(2, Math.round(len / 3)));
          for (let i = 0; i < count; i++) {
            const light = this.ember(used++);
            if (light) {
              light.position.set(tx + ((i + 0.5) / count) * len, -(ty) - 0.15, 0.85);
              light.visible = true;
            }
          }
          tx = end;
        } else {
          tx++;
        }
      }
    }
    for (let i = used; i < this.embers.length; i++) {
      const l = this.embers[i]!;
      l.visible = false;
      l.position.set(0, -999, 0);
    }

    // ---- flush: one merged mesh per material ------------------------------
    this.flush(ground);
    this.flush(moss);
    this.flush(brick);
    this.flush(lava);
    this.flush(illus);
    this.flush(spikes);
    this.flush(trunk);
    this.flush(foliage);
    this.flush(bone);
    this.flush(ceiling);
  }

  /** Optional hook for core: pass a world-space reference point (e.g. the
   *  player position). Layers ease against it by depth — 0,0 is neutral. */
  setParallax(px: number, py: number): void {
    this.parX = px;
    this.parY = py;
  }

  /** Per-frame: lava veins, illusory shimmer, foliage sway (GPU), backdrop drift. */
  update(_dt: number, time: number): void {
    updateMaterialTime(time);
    if (this.gradient) this.gradient.mat.uniforms.uTime!.value = time;
    for (const l of this.layers) {
      l.mesh.position.x = -this.parX * l.k + Math.sin(time * l.speed + l.phase) * l.ampX;
      l.mesh.position.y = -this.parY * l.k * 0.6 + Math.cos(time * l.speed * 0.83 + l.phase) * l.ampY;
    }
  }

  dispose(): void {
    this.clearPlayfield();
    for (const l of this.layers) this.backdrop.remove(l.mesh);
    this.layers = [];
    for (const g of this.layerGeos) g.dispose();
    this.layerGeos = [];
    for (const m of this.layerMats) m.dispose();
    this.layerMats = [];
    if (this.crystalMesh) {
      this.backdrop.remove(this.crystalMesh.mesh);
      this.crystalMesh.geo.dispose();
      this.crystalMesh = null;
    }
    if (this.gradient) {
      this.scene.remove(this.gradient.mesh);
      this.gradient.geo.dispose();
      this.gradient.mat.dispose();
      this.gradient = null;
    }
    for (const light of this.embers) {
      this.scene.remove(light);
      light.dispose();
    }
    this.embers = [];
    this.scene.remove(this.root);
    this.scene.remove(this.backdrop);
  }

  // -------------------------------------------------------------------------

  private flush(batch: Batch): void {
    if (batch.geos.length === 0) return;
    const merged = mergeGeometries(batch.geos, false);
    for (const g of batch.geos) g.dispose();
    if (!merged) return;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, getMaterial(batch.mat));
    mesh.castShadow = batch.cast;
    mesh.receiveShadow = batch.receive;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.root.add(mesh);
    this.batches.push({ mesh, geo: merged });
  }

  private clearPlayfield(): void {
    for (const b of this.batches) {
      this.root.remove(b.mesh);
      b.geo.dispose();
    }
    this.batches = [];
  }

  /** Pooled persistent ember light; extras are parked off-screen and hidden. */
  private ember(index: number): THREE.PointLight | null {
    while (this.embers.length <= index) {
      const light = this.lighting.addEmitter(
        new THREE.Vector3(0, -999, 0),
        this.embers.length % 2 === 0 ? PALETTE.lavaCore : PALETTE.ember,
        2.6,
        4.6,
        { speed: 5 + Math.random() * 5 }, // flicker phase/speed only — non-structural
      );
      this.embers.push(light);
    }
    return this.embers[index] ?? null;
  }

  // ---- backdrop -----------------------------------------------------------

  private buildBackdrop(): void {
    const W = PHYSICS.SCREEN_W;
    const tints: Array<{ top: number; bottom: number }> = [
      { top: 0x1e4250, bottom: 0x0f1e26 },
      { top: 0x183642, bottom: 0x0c171e },
      { top: 0x122a34, bottom: 0x0a141b },
      { top: 0x0d1e26, bottom: 0x060c11 },
    ];
    const zs = [-3.2, -7, -12, -18];
    for (let i = 0; i < zs.length; i++) {
      const tint = tints[i];
      const z = zs[i];
      if (!tint || z === undefined) continue;
      const geos: THREE.BufferGeometry[] = [];
      this.layerShapes(i, W, geos);
      if (geos.length === 0) continue;
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const layerMat = (getMaterial("backdrop") as THREE.ShaderMaterial).clone() as THREE.ShaderMaterial;
      (layerMat.uniforms.uTop!.value as THREE.Color).setHex(tint.top);
      (layerMat.uniforms.uBottom!.value as THREE.Color).setHex(tint.bottom);
      const mesh = new THREE.Mesh(merged, layerMat);
      mesh.position.set(0, 0, z);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.backdrop.add(mesh);
      this.layers.push({
        mesh,
        k: 0.012 * (i + 1),
        ampX: 0.04 + i * 0.045,
        ampY: 0.02 + i * 0.02,
        speed: 0.11 + i * 0.05,
        phase: i * 1.73,
      });
      this.layerMats.push(layerMat);
      this.layerGeos.push(merged);
    }
    this.buildCrystals(W);
  }

  /** Silhouette content for one parallax layer: cavern floor/ceiling bands,
   *  stalactites/stalagmites, ruins, columns, arches, chains, vines. */
  private layerShapes(layer: number, W: number, geos: THREE.BufferGeometry[]): void {
    const floorTop = -13.6 + layer * 0.8;
    const ceilBottom = 1.1 - layer * 0.55;
    let n = 0;
    const rnd = (): number => hash2(layer * 77 + n++, layer * 13 + 7, 5);

    // cavern floor skyline
    let fx = -10;
    while (fx < W + 10) {
      const w = 3 + rnd() * 5;
      const h = 1.5 + rnd() * 3.5;
      const box = new THREE.BoxGeometry(w, h, 4 + rnd() * 3);
      box.translate(fx + w / 2, floorTop - h / 2 + 0.4, (rnd() - 0.5) * 2);
      geos.push(box);
      fx += w * 0.6 + rnd() * 2;
    }
    // cavern ceiling skyline
    let cx = -10;
    while (cx < W + 10) {
      const w = 3 + rnd() * 6;
      const h = 1.5 + rnd() * 3;
      const box = new THREE.BoxGeometry(w, h, 4 + rnd() * 3);
      box.translate(cx + w / 2, ceilBottom + h / 2 - 0.4, (rnd() - 0.5) * 2);
      geos.push(box);
      cx += w * 0.65 + rnd() * 2.5;
    }
    // stalactites + stalagmites
    const stCount = 8 + layer * 2;
    for (let k = 0; k < stCount; k++) {
      const x = -6 + rnd() * (W + 12);
      const r = 0.25 + rnd() * (0.3 + layer * 0.12);
      const len = 0.8 + rnd() * (1.4 + layer * 0.5);
      const cone = new THREE.ConeGeometry(r, len, 5);
      if (rnd() > 0.5) {
        cone.rotateX(Math.PI);
        cone.translate(x, ceilBottom - len / 2 + 0.5, (rnd() - 0.5) * 1.5);
      } else {
        cone.translate(x, floorTop + len / 2 - 0.4, (rnd() - 0.5) * 1.5);
      }
      geos.push(cone);
    }
    // ruined columns, some broken
    const colCount = 3 + Math.floor(rnd() * 2);
    for (let k = 0; k < colCount; k++) {
      const x = -2 + rnd() * (W + 4);
      const r = 0.35 + rnd() * 0.3;
      const broken = rnd() > 0.55;
      const colTop = broken ? floorTop - (2 + rnd() * 3) : ceilBottom + 0.6;
      const hgt = ceilBottom + 1.5 - colTop;
      if (hgt <= 0.5) continue;
      const cyl = new THREE.CylinderGeometry(r * 0.85, r, hgt, 7);
      cyl.translate(x, colTop + hgt / 2, (rnd() - 0.5) * 1);
      geos.push(cyl);
      const base = new THREE.BoxGeometry(r * 3, 0.5, r * 3);
      base.translate(x, floorTop - 0.1, 0);
      geos.push(base);
      const cap = new THREE.BoxGeometry(r * (broken ? 2.6 : 3.2), 0.42, r * (broken ? 2.6 : 3.2));
      if (broken) cap.rotateZ((rnd() - 0.5) * 0.3);
      cap.translate(x + (broken ? (rnd() - 0.5) * 0.3 : 0), colTop + 0.15, 0);
      geos.push(cap);
    }
    // carved arches
    const archCount = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < archCount; k++) {
      const x = 1 + rnd() * (W - 2);
      const rad = 1.5 + rnd() * 1.1;
      const y = floorTop + rad + 0.6;
      const arch = new THREE.TorusGeometry(rad, 0.16 + rnd() * 0.08, 5, 10, Math.PI);
      arch.translate(x, y, 0.3);
      geos.push(arch);
      for (const s of [-1, 1]) {
        const leg = new THREE.BoxGeometry(0.34, rad, 0.34);
        leg.translate(x + s * rad, y - rad / 2, 0.3);
        geos.push(leg);
      }
    }
    // hanging chains + vines on the near layers
    if (layer <= 1) {
      const chainCount = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < chainCount; k++) {
        const x = rnd() * W;
        const links = 3 + Math.floor(rnd() * 5);
        let ly = ceilBottom - 0.1;
        for (let l = 0; l < links; l++) {
          const link = new THREE.TorusGeometry(0.055, 0.018, 4, 7);
          if (l % 2 === 1) link.rotateY(Math.PI / 2);
          link.translate(x + Math.sin(l * 1.7 + layer) * 0.03, ly, 0.4);
          geos.push(link);
          ly -= 0.13;
        }
      }
      const vineCount = 4 + Math.floor(rnd() * 3);
      for (let k = 0; k < vineCount; k++) {
        const x = rnd() * W;
        const segs = 2 + Math.floor(rnd() * 2);
        let vx = x;
        let vy = ceilBottom - 0.05;
        for (let s = 0; s < segs; s++) {
          const len = 0.7 + rnd() * 0.9;
          const tilt = (rnd() - 0.5) * 0.5;
          const seg = new THREE.CylinderGeometry(0.028, 0.02, len, 4);
          seg.rotateZ(tilt);
          seg.translate(vx + (Math.sin(tilt) * len) / 2, vy - (Math.cos(tilt) * len) / 2, 0.2);
          geos.push(seg);
          vx += Math.sin(tilt) * len;
          vy -= Math.cos(tilt) * len;
        }
      }
    }
  }

  /** Faint glowing crystal clusters on the two deepest layers (bloom bait). */
  private buildCrystals(W: number): void {
    const geos: THREE.BufferGeometry[] = [];
    const zs = [-12, -18];
    const floorTops = [-12.0, -11.2];
    for (let li = 0; li < zs.length; li++) {
      const z0 = zs[li];
      const fy = floorTops[li];
      if (z0 === undefined || fy === undefined) continue;
      const clusters = 3 + li;
      for (let k = 0; k < clusters; k++) {
        const cxx = 0.5 + hash2(li * 31 + k, 3, 71) * (W - 1);
        const czp = z0 + 0.8 + hash2(li * 31 + k, 4, 71) * 1.2;
        const shards = 2 + Math.floor(hash2(li * 31 + k, 5, 71) * 3);
        for (let s = 0; s < shards; s++) {
          const r = 0.1 + hash2(li * 31 + k, 10 + s, 71) * 0.16;
          const shard = new THREE.OctahedronGeometry(r, 0);
          shard.scale(1, 1.9 + hash2(li * 31 + k, 20 + s, 71), 1);
          shard.rotateZ((hash2(li * 31 + k, 30 + s, 71) - 0.5) * 0.8);
          shard.rotateY(hash2(li * 31 + k, 40 + s, 71) * Math.PI);
          shard.translate(
            cxx + (hash2(li * 31 + k, 50 + s, 71) - 0.5) * 0.5,
            fy + r * 0.9,
            czp + (hash2(li * 31 + k, 60 + s, 71) - 0.5) * 0.5,
          );
          geos.push(shard);
        }
      }
    }
    if (geos.length === 0) return;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, getMaterial("crystal"));
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.backdrop.add(mesh);
    this.crystalMesh = { mesh, geo: merged };
  }

  /** Deep vertical gradient plane behind everything so the fog has depth. */
  private buildGradient(): void {
    const geo = new THREE.PlaneGeometry(180, 100);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x05080c) },
        uMid: { value: new THREE.Color(0x16323d) },
        uTop: { value: new THREE.Color(0x070f15) },
      },
      vertexShader: [
        "varying vec2 vUv;",
        "void main() {",
        "  vUv = uv;",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform float uTime;",
        "uniform vec3 uDeep;",
        "uniform vec3 uMid;",
        "uniform vec3 uTop;",
        "varying vec2 vUv;",
        "void main() {",
        "  float h = vUv.y;",
        "  vec3 col = mix( uDeep, uMid, smoothstep( 0.05, 0.55, h ) );",
        "  col = mix( col, uTop, smoothstep( 0.55, 1.0, h ) );",
        "  float glow = exp( -pow( ( vUv.x - 0.5 ) * 2.4, 2.0 ) ) * exp( -pow( ( h - 0.3 ) * 3.2, 2.0 ) );",
        "  col += vec3( 0.05, 0.018, 0.004 ) * glow * ( 0.85 + 0.15 * sin( uTime * 0.37 ) );",
        "  gl_FragColor = vec4( col, 1.0 );",
        "  #include <tonemapping_fragment>",
        "  #include <colorspace_fragment>",
        "}",
      ].join("\n"),
      fog: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(PHYSICS.SCREEN_W / 2, -PHYSICS.SCREEN_H / 2, -26);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    this.gradient = { mesh, mat, geo };
  }
}

/** top y of a tile row (sim ty → world). */
function cyTopOf(ty: number): number {
  return -ty;
}
