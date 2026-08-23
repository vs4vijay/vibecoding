import * as THREE from "three";
import { CONFIG } from "../config";

const R = CONFIG.road;
const SEG_LEN = R.segmentLength;

export type Segment = { id: number; z: number };
export type RecycleMove = { id: number; newZ: number };

/**
 * Pure streaming plan: any segment whose far edge (anchor z minus segLen) has
 * fallen more than 30 m behind the car is re-z'd to the front of the window.
 * The landing spot is max(currentFront + segLen, carZ - 30): identical to a
 * plain front-of-window hop in steady state, but on a large forward teleport
 * it lifts the whole window up to the car instead of stranding segments
 * hundreds of meters back. Applying the returned moves keeps every anchor
 * inside [carZ - 30, carZ + count * segLen].
 */
export function planSegmentRecycle(
  segs: Segment[],
  carZ: number,
  segLen: number,
): RecycleMove[] {
  const moves: RecycleMove[] = [];
  let maxZ = -Infinity;
  for (const s of segs) if (s.z > maxZ) maxZ = s.z;
  let next = Math.max(maxZ + segLen, carZ - 30);
  const keepBehind = carZ - 30;
  for (const s of segs) {
    if (s.z - segLen < keepBehind) {
      moves.push({ id: s.id, newZ: next });
      next += segLen;
    }
  }
  return moves;
}

// Skyline silhouette band: instance spacing along z and the recycle margin.
const SKY_COUNT = 24;
const SKY_SPACING = 7.5;
const SKY_BEHIND = 40;

/** Flat plane in the XZ plane (rotated flat), centered at (x, y, z). */
function planeXZ(
  w: number,
  len: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, len);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x, y, z);
  return geo;
}

/** Axis-aligned box centered at (x, y, z). */
function boxAt(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  return geo;
}

/** Merge non-indexed copies of `parts` into one geometry (build-time only). */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = parts.map((p) => p.toNonIndexed());
  const merged = mergeGeometriesImpl(nonIndexed);
  for (const p of parts) p.dispose();
  for (const p of nonIndexed) p.dispose();
  return merged;
}

/** Minimal position-only geometry concatenation (three's addon equivalent). */
function mergeGeometriesImpl(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const attrs = geos.map((g) => g.getAttribute("position") as THREE.BufferAttribute);
  const total = attrs.reduce((n, a) => n + a.count, 0);
  const out = new THREE.BufferGeometry();
  const merged = new Float32Array(total * 3);
  let o = 0;
  for (const a of attrs) {
    merged.set(a.array as Float32Array, o);
    o += a.array.length;
  }
  out.setAttribute("position", new THREE.BufferAttribute(merged, 3));
  out.computeVertexNormals();
  return out;
}

/** Pooled dusk highway: asphalt, dashed lines, guardrails, streetlights, sand shoulders, skyline. */
export class World {
  group = new THREE.Group();
  private segs: { mesh: THREE.Group; z: number }[] = [];
  private skyline: THREE.InstancedMesh;
  private skyBaseX = new Float32Array(SKY_COUNT);
  private skyH = new Float32Array(SKY_COUNT);
  private skyW = new Float32Array(SKY_COUNT);
  private skyZ = new Float32Array(SKY_COUNT);
  private tmpM = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    // --- Shared materials, built once and reused by the pool ---
    const asphaltMat = new THREE.MeshLambertMaterial({ color: 0x1c1c20 });
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xc9b47a });
    const railMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x181820 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    const sandMat = new THREE.MeshLambertMaterial({ color: 0x4a3421 });

    // --- Per-material merged segment geometry (built once) ---
    // Every segment is identical, so each material's pieces are baked into a
    // single BufferGeometry; one segment = 6 draw calls total instead of ~17.
    const asphaltGeo = mergeGeometries(
      [planeXZ(16, SEG_LEN, 0, 0, 0)],
    );
    const dashParts: THREE.BufferGeometry[] = [];
    for (let d = 0; d < 6; d++) {
      dashParts.push(planeXZ(0.18, 2.2, 0, 0.02, -SEG_LEN / 2 + (d + 0.5) * (SEG_LEN / 6)));
    }
    const dashGeo = mergeGeometries(dashParts);
    const railParts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1] as const) {
      railParts.push(boxAt(0.12, 0.35, SEG_LEN, side * 7.35, 0.55, 0));
      for (let p = 0; p < 4; p++) {
        railParts.push(
          boxAt(0.14, 0.7, 0.14, side * 7.35, 0.35, -SEG_LEN / 2 + (p + 0.5) * (SEG_LEN / 4)),
        );
      }
    }
    const railGeo = mergeGeometries(railParts);
    const sandParts: THREE.BufferGeometry[] = [
      planeXZ(26, SEG_LEN, -20.5, -0.05, 0),
      planeXZ(26, SEG_LEN, 20.5, -0.05, 0),
    ];
    const sandGeo = mergeGeometries(sandParts);
    // Streetlight: pole is per-segment-identical (side applied via mesh
    // position); the amber head bakes its own offset.
    const poleGeo = boxAt(0.16, 6, 0.16, 0, 3, 0);
    const headGeo = boxAt(1.1, 0.22, 0.5, 0, 5.9, 0);

    // --- Skyline: one InstancedMesh of dark silhouette boxes ---
    const skylineMat = new THREE.MeshBasicMaterial({ color: 0x120a12 });
    this.skyline = new THREE.InstancedMesh(
      new THREE.BoxGeometry(10, 1, 10),
      skylineMat,
      SKY_COUNT,
    );
    this.skyline.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < SKY_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.skyH[i] = 8 + Math.random() * 22;
      this.skyW[i] = 4 + Math.random() * 4;
      this.skyBaseX[i] = side * (40 + Math.random() * 45);
      this.skyZ[i] = -SKY_BEHIND + i * SKY_SPACING + Math.random() * 4;
      this.placeSkyBox(i);
    }
    this.skyline.instanceMatrix.needsUpdate = true;

    // --- Pooled road segments: one merged mesh per material ---
    for (let i = 0; i < R.visibleSegments; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(asphaltGeo, asphaltMat));
      g.add(new THREE.Mesh(dashGeo, dashMat));
      g.add(new THREE.Mesh(railGeo, railMat));
      g.add(new THREE.Mesh(sandGeo, sandMat));

      // Streetlight every segment, alternating sides; emissive-looking head,
      // no real light. (Side varies per segment, so pole/head stay separate.)
      const lampSide = i % 2 === 0 ? -1 : 1;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(lampSide * 7.9, 0, 0);
      g.add(pole);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(lampSide * 7.35, 0, 0);
      g.add(head);

      g.position.z = -i * SEG_LEN;
      this.segs.push({ mesh: g, z: -i * SEG_LEN });
      this.group.add(g);
    }

    scene.add(this.group);
    scene.add(this.skyline);
  }

  /** Recycle segments so road covers [carZ - 30, carZ + visibleSegments*segLen]; zero per-frame allocation. */
  update(carZ: number): void {
    // Same invariant as planSegmentRecycle (pinned by tests/worldStream.test.ts),
    // inlined over pooled entries so no arrays or objects are built per frame.
    let maxZ = -Infinity;
    for (const s of this.segs) if (s.z > maxZ) maxZ = s.z;
    let next = Math.max(maxZ + SEG_LEN, carZ - 30);
    const keepBehind = carZ - 30;
    for (const s of this.segs) {
      if (s.z - SEG_LEN < keepBehind) {
        s.z = next;
        s.mesh.position.z = next;
        next += SEG_LEN;
      }
    }

    // Wrap any skyline instance that fell behind back to the front of the band.
    let dirty = false;
    for (let i = 0; i < SKY_COUNT; i++) {
      while (this.skyZ[i] < carZ - SKY_BEHIND) {
        this.skyZ[i] += SKY_COUNT * SKY_SPACING;
        dirty = true;
      }
      if (dirty) {
        this.placeSkyBox(i);
        this.skyline.instanceMatrix.needsUpdate = true;
        dirty = false;
      }
    }
  }

  /** Recompose instance i's matrix from its stored base params + current z. */
  private placeSkyBox(i: number): void {
    this.tmpM.makeScale(this.skyW[i], this.skyH[i], this.skyW[i]);
    this.tmpM.setPosition(this.skyBaseX[i], this.skyH[i] / 2, this.skyZ[i]);
    this.skyline.setMatrixAt(i, this.tmpM);
  }
}
