import * as THREE from "three";
import type { WebGLProgramParametersWithUniforms } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32, rangeRng, type Rng } from "../util/Rng";
import type { Meadow } from "../world/Meadow";

/**
 * Wheat-grain seed heads scattered across the meadow — the collectible.
 * Each node is a fallen seed head (straw stalk + golden grain cluster) that
 * sways with the meadow wind (same clock as GrassField), twinkles when the
 * sun catches it, and pops into stubble + a chaff burst when harvested.
 * Thrown grains settle into loose seeds that can be picked up again.
 *
 * All placement flows through the seeded rng; node keep-outs thin the grass
 * via maskAt() so no blade stabs through a collectible.
 */

export interface GrainNode {
  index: number;
  pos: THREE.Vector3; // base, on the walkable ground
  head: THREE.Vector3; // seed-head center (glint + collect anchor)
  yaw: number;
  scale: number;
  phase: number;
  variant: number;
  state: "idle" | "harvesting" | "picked";
  animT: number;
  /** Apple-crest windfall node: renders as a SPLIT head + kernel spill, not an ear. */
  patch?: boolean;
}

export interface PickTarget {
  kind: "node" | "loose";
  index: number;
  pos: THREE.Vector3;
}

const WIND_DECL = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
`;

// Same world-space displacement pattern as GrassField: applied after the
// instance transform so the wind direction does not rotate with the node,
// weighted toward the head (position.y) so roots stay planted.
const PROJECT_REPLACEMENT = /* glsl */ `
vec4 gwp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  gwp = instanceMatrix * gwp;
#endif
gwp = modelMatrix * gwp;
float gSw = clamp(position.y * 4.5, 0.0, 1.0);
float gPh = gwp.x * 0.53 + gwp.z * 0.71;
float gG = sin(uTime * 1.05 + gPh) * 0.62 + sin(uTime * 2.31 + gPh * 1.7 + 1.7) * 0.38;
vec2 gOff = uWindDir * (gG * 0.05 + sin(uTime * 5.3 + gPh * 2.9) * 0.012) * gSw * (0.1 + position.y);
gwp.xyz += vec3(gOff.x, 0.0, gOff.y);
vec4 mvPosition = viewMatrix * gwp;
gl_Position = projectionMatrix * mvPosition;
`;

export class GrainField {
  readonly group = new THREE.Group();
  readonly shared = {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(0.82, 0.57).normalize() },
  };

  readonly nodes: GrainNode[] = [];
  readonly grainGeo: THREE.BufferGeometry;
  readonly grainMat: THREE.Material;

  private readonly meadow: Meadow;
  private readonly idleGrains: THREE.InstancedMesh[] = []; // per variant
  private readonly idleStalks: THREE.InstancedMesh[] = []; // per variant
  private readonly stubble: THREE.InstancedMesh;
  private readonly bucketOf: number[] = []; // node index → instance slot
  /** Apple-crest windfall: split heads (straw + burst grain) + plump spill. */
  private readonly patchStalks: THREE.InstancedMesh;
  private readonly patchHeads: THREE.InstancedMesh;
  private readonly spill: THREE.InstancedMesh;
  private readonly glintGeo: THREE.BufferGeometry;
  private readonly glintOn: Float32Array;
  private readonly glints: THREE.Points;
  private readonly looseMesh: THREE.InstancedMesh;
  private readonly loose: {
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    scale: number;
    settleT: number;
    active: boolean;
  }[] = [];
  private readonly scratchM = new THREE.Matrix4();
  private readonly scratchS = new THREE.Vector3();

  constructor(meadow: Meadow, seed: number) {
    this.meadow = meadow;

    this.grainGeo = GrainField.buildGrainGeometry();
    this.grainMat = GrainField.buildGrainMaterial();

    // --- Scatter nodes: tutorial ring, rich mid-distance clusters, far ring.
    this.scatter(mulberry32(seed ^ 0x0b31f2c9));
    // The apple-crest windfall: a rich patch ONLY reachable via the spring
    // seeds (M3 high route). Placed on the apple's authored crest spots.
    this.scatterApplePatch(mulberry32(seed ^ 0x5eed7a11));

    // --- Variant buckets: two seed-head architectures.
    const earGeos = [GrainField.buildEarGeometry(mulberry32(seed ^ 0x11e5a3), 7), GrainField.buildEarGeometry(mulberry32(seed ^ 0x77c2d9), 9)];
    const stubbleGeo = GrainField.buildStubbleGeometry(mulberry32(seed ^ 0x3e91107));

    const strawMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
    const patchedGrain = this.patchMaterial(this.grainMat as THREE.MeshStandardMaterial);
    const patchedStraw = this.patchMaterial(strawMat);

    const buckets: GrainNode[][] = [[], []];
    for (const n of this.nodes) {
      if (n.patch) continue; // windfall nodes render through the patch meshes below
      buckets[n.variant].push(n);
    }

    for (let v = 0; v < 2; v++) {
      const ear = earGeos[v];
      const stalkGeo = ear.stalk;
      const grainsGeo = ear.grains;
      this.idleStalks.push(this.makeInstanced(stalkGeo, patchedStraw.mat, patchedStraw.depth, buckets[v].length));
      this.idleGrains.push(this.makeInstanced(grainsGeo, patchedGrain.mat, patchedGrain.depth, buckets[v].length));
      let slot = 0;
      for (const n of buckets[v]) {
        this.bucketOf[n.index] = slot;
        this.writeIdleMatrices(n, slot);
        slot++;
      }
      this.idleStalks[v].instanceMatrix.needsUpdate = true;
      this.idleGrains[v].instanceMatrix.needsUpdate = true;
      this.group.add(this.idleStalks[v], this.idleGrains[v]);
    }

    this.stubble = this.makeInstanced(stubbleGeo, patchedStraw.mat, patchedStraw.depth, this.nodes.length);
    for (let i = 0; i < this.nodes.length; i++) {
      this.stubble.setMatrixAt(i, this.zeroMatrix);
    }
    this.stubble.instanceMatrix.needsUpdate = true;
    this.group.add(this.stubble);

    // --- Apple-crest windfall rendering: the crest nodes show as SPLIT seed
    // heads (shattered straw stub + burst-open plump berries) with a spill of
    // big loose kernels scattered around them — the intact thin ears read as
    // beaded-wire stalks from the ledge camera ("stuck sparklers").
    const patchNodes = this.nodes.filter((n) => n.patch);
    const split = GrainField.buildSplitHeadGeometry(mulberry32(seed ^ 0x9eadbeef));
    this.patchStalks = this.makeInstanced(split.stalk, patchedStraw.mat, patchedStraw.depth, patchNodes.length);
    this.patchHeads = this.makeInstanced(split.grains, patchedGrain.mat, patchedGrain.depth, patchNodes.length);
    this.patchStalks.count = patchNodes.length;
    this.patchHeads.count = patchNodes.length;
    this.group.add(this.patchStalks, this.patchHeads);
    let patchSlot = 0;
    for (const n of patchNodes) {
      this.bucketOf[n.index] = patchSlot;
      this.writeIdleMatrices(n, patchSlot);
      patchSlot++;
    }
    this.patchStalks.instanceMatrix.needsUpdate = true;
    this.patchHeads.instanceMatrix.needsUpdate = true;

    // The spill: plump loose kernels (the loose-seed geometry, scaled ~2–2.9× —
    // deliberately bigger than ear berries) scattered around each patch spot,
    // spilling downhill from every split head.
    const spillSpecs = this.patchSpillSpecs;
    this.spill = this.makeInstanced(this.grainGeo, patchedGrain.mat, patchedGrain.depth, Math.max(1, spillSpecs.length));
    this.spill.count = spillSpecs.length;
    for (let i = 0; i < spillSpecs.length; i++) {
      const s = spillSpecs[i];
      this.spill.setMatrixAt(i, this.scratchM.compose(s.pos, s.quat, this.scratchS.setScalar(s.scale)));
    }
    this.spill.instanceMatrix.needsUpdate = true;
    this.group.add(this.spill);

    // --- Catchlight glints: one sprite per node head, sun-twinkled.
    this.glintOn = new Float32Array(this.nodes.length);
    const gpos = new Float32Array(this.nodes.length * 3);
    const gphase = new Float32Array(this.nodes.length);
    const gsize = new Float32Array(this.nodes.length);
    this.nodes.forEach((n, i) => {
      gpos[i * 3] = n.head.x;
      gpos[i * 3 + 1] = n.head.y;
      gpos[i * 3 + 2] = n.head.z;
      gphase[i] = n.phase;
      gsize[i] = 0.05 + (n.index % 3) * 0.012;
      this.glintOn[i] = 1;
    });
    this.glintGeo = new THREE.BufferGeometry();
    this.glintGeo.setAttribute("position", new THREE.BufferAttribute(gpos, 3));
    this.glintGeo.setAttribute("aPhase", new THREE.BufferAttribute(gphase, 1));
    this.glintGeo.setAttribute("aSize", new THREE.BufferAttribute(gsize, 1));
    this.glintGeo.setAttribute("aOn", new THREE.BufferAttribute(this.glintOn, 1));
    this.glints = new THREE.Points(
      this.glintGeo,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.shared.uTime,
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color(0xfff0cf) },
          uScale: { value: 700 },
        },
        vertexShader: /* glsl */ `
          attribute float aPhase;
          attribute float aSize;
          attribute float aOn;
          uniform float uTime;
          uniform vec3 uSunDir;
          uniform float uScale;
          varying float vA;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float tw = pow(0.5 + 0.5 * sin(uTime * 2.1 + aPhase * 7.0), 3.0);
            vec3 view = normalize(cameraPosition - position);
            float catch = 0.35 + 0.65 * pow(max(dot(view, normalize(uSunDir)), 0.0), 2.0);
            // A glint that drifts up to the lens blows into a white blob —
            // fade sparkles out inside ~2 u of the camera.
            float near = smoothstep(1.15, 1.95, distance(cameraPosition, position));
            vA = aOn * tw * catch * near;
            gl_PointSize = aSize * (0.6 + 0.8 * tw) * uScale / max(0.05, -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          void main() {
            vec2 d = gl_PointCoord - 0.5;
            float a = smoothstep(0.5, 0.05, length(d)) * vA;
            if (a < 0.004) discard;
            gl_FragColor = vec4(vec3(1.0, 0.93, 0.72) * (0.6 + 0.9 * vA), a);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 5;
    this.group.add(this.glints);

    // --- Loose seeds (settled thrown grains), re-pickable.
    this.looseMesh = new THREE.InstancedMesh(this.grainGeo, patchedGrain.mat, 12);
    this.looseMesh.customDepthMaterial = patchedGrain.depth;
    this.looseMesh.castShadow = true;
    this.looseMesh.receiveShadow = true;
    this.looseMesh.frustumCulled = false;
    this.looseMesh.count = 0;
    this.group.add(this.looseMesh);
  }

  /** Viewport attenuation constant for point sprites (call on resize). */
  setPointScale(heightPx: number): void {
    (this.glints.material as THREE.ShaderMaterial).uniforms.uScale.value = heightPx * 1.1;
  }

  syncSun(dir: THREE.Vector3, color: THREE.Color): void {
    const u = (this.glints.material as THREE.ShaderMaterial).uniforms;
    u.uSunDir.value.copy(dir).normalize();
    u.uSunColor.value.copy(color);
  }

  setTime(t: number): void {
    this.shared.uTime.value = t;
  }

  /** 0 = no grass within a node's footprint (thin out toward 0.5 u). */
  maskAt(x: number, z: number): number {
    let m = 1;
    for (const n of this.nodes) {
      const d = Math.hypot(x - n.pos.x, z - n.pos.z);
      m *= THREE.MathUtils.smoothstep(d, 0.22, 0.55);
      if (m < 0.01) return 0;
    }
    return m;
  }

  /** Nearest pickable (node or loose seed) within `radius` of `pos`. */
  pickableAt(pos: THREE.Vector3, radius: number): PickTarget | null {
    let best: PickTarget | null = null;
    let bestD = radius;
    for (const n of this.nodes) {
      if (n.state !== "idle") continue;
      const d = Math.hypot(pos.x - n.pos.x, pos.z - n.pos.z);
      if (d < bestD && Math.abs(pos.y - n.pos.y) < 0.45) {
        bestD = d;
        best = { kind: "node", index: n.index, pos: n.head };
      }
    }
    for (let i = 0; i < this.loose.length; i++) {
      const l = this.loose[i];
      if (!l.active) continue;
      const d = Math.hypot(pos.x - l.pos.x, pos.z - l.pos.z);
      if (d < bestD && Math.abs(pos.y - l.pos.y) < 0.45) {
        bestD = d;
        best = { kind: "loose", index: i, pos: l.pos };
      }
    }
    return best;
  }

  /** Begins the harvest: node pops into stubble (animated in update). */
  harvestNode(index: number): void {
    const n = this.nodes[index];
    n.state = "harvesting";
    n.animT = 0;
  }

  /**
   * Motion-shot support: guarantees an idle node within 0.6 u of (x, z) by
   * teleporting the nearest idle one there. Deterministic for a given seed.
   */
  ensureNodeNear(x: number, z: number): GrainNode {
    let best = this.nodes[0];
    let bestD = Infinity;
    for (const n of this.nodes) {
      if (n.state !== "idle" || n.patch) continue; // never teleport the windfall
      const d = Math.hypot(n.pos.x - x, n.pos.z - z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (bestD < 0.6) return best;
    const y = this.meadow.heightAt(x, z) - 0.012;
    best.pos.set(x, y, z);
    best.head.set(x, y + 0.24 * best.scale, z);
    this.writeIdleMatrices(best, this.bucketOf[best.index]);
    this.idleStalks[best.variant].instanceMatrix.needsUpdate = true;
    this.idleGrains[best.variant].instanceMatrix.needsUpdate = true;
    const gpos = this.glintGeo.attributes.position as THREE.BufferAttribute;
    gpos.setXYZ(best.index, best.head.x, best.head.y, best.head.z);
    gpos.needsUpdate = true;
    return best;
  }

  takeLoose(index: number): void {
    this.loose[index].active = false;
    this.rewriteLoose();
  }

  /** Nearest active loose seed within `radius` of pos (the hopper's scoop). */
  looseNear(pos: THREE.Vector3, radius: number): number | null {
    let best: number | null = null;
    let bestD = radius;
    for (let i = 0; i < this.loose.length; i++) {
      const l = this.loose[i];
      if (!l.active) continue;
      const d = Math.hypot(pos.x - l.pos.x, pos.z - l.pos.z);
      if (d < bestD && Math.abs(pos.y - l.pos.y) < 0.5) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Staged-shot support: place a loose seed already settled (full size). */
  stageLoose(pos: THREE.Vector3, quat: THREE.Quaternion, scale = 1): THREE.Vector3 {
    const p = this.addLoose(pos, quat, scale);
    const slot = this.loose.findIndex((l) => l.pos === p);
    if (slot >= 0) {
      this.loose[slot].settleT = 1;
      this.rewriteLoose();
    }
    return p;
  }

  /** Adds a settled thrown seed; returns its resting position. */
  addLoose(pos: THREE.Vector3, quat: THREE.Quaternion, scale: number): THREE.Vector3 {
    let slot = this.loose.findIndex((l) => !l.active);
    if (slot < 0) {
      if (this.loose.length >= 12) slot = 0;
      else {
        this.loose.push({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1, settleT: 1, active: false });
        slot = this.loose.length - 1;
      }
    }
    const l = this.loose[slot];
    l.pos.copy(pos);
    l.quat.copy(quat);
    l.scale = scale;
    l.active = true;
    l.settleT = 0;
    this.rewriteLoose();
    return l.pos;
  }

  get looseCount(): number {
    return this.loose.filter((l) => l.active).length;
  }

  get idleCount(): number {
    return this.nodes.filter((n) => n.state === "idle").length;
  }

  update(dt: number): void {
    let dirtyStalk = false;
    let dirtyGrain = false;
    let dirtyStubble = false;
    let dirtyPatch = false;
    for (const n of this.nodes) {
      if (n.state !== "harvesting") continue;
      n.animT = Math.min(1, n.animT + dt / 0.3);
      const t = n.animT;
      // Pop: quick swell then shrink to nothing.
      const s = (1 + 0.3 * Math.sin(Math.min(1, t * 1.6) * Math.PI)) * (1 - t * t);
      this.writeNodeMatrix(n, this.bucketOf[n.index], Math.max(0, s) * n.scale);
      if (n.patch) dirtyPatch = true;
      else dirtyStalk = dirtyGrain = true;
      const stubS = THREE.MathUtils.smoothstep(t, 0.45, 1);
      if (stubS > 0) {
        this.stubble.setMatrixAt(n.index, this.scratchM.compose(
          n.pos,
          new THREE.Quaternion().setFromAxisAngle(UP, n.yaw),
          this.scratchS.setScalar(stubS),
        ));
        dirtyStubble = true;
      }
      if (t >= 1) {
        n.state = "picked";
        this.writeNodeMatrix(n, this.bucketOf[n.index], 0);
        this.glintOn[n.index] = 0;
        (this.glintGeo.attributes.aOn as THREE.BufferAttribute).needsUpdate = true;
      }
    }
    if (dirtyStalk) this.idleStalks[0].instanceMatrix.needsUpdate = this.idleStalks[1].instanceMatrix.needsUpdate = true;
    if (dirtyGrain) this.idleGrains[0].instanceMatrix.needsUpdate = this.idleGrains[1].instanceMatrix.needsUpdate = true;
    if (dirtyStubble) this.stubble.instanceMatrix.needsUpdate = true;
    if (dirtyPatch) {
      this.patchStalks.instanceMatrix.needsUpdate = true;
      this.patchHeads.instanceMatrix.needsUpdate = true;
    }

    // Loose seeds settle-in pop.
    let looseDirty = false;
    for (let i = 0; i < this.loose.length; i++) {
      const l = this.loose[i];
      if (!l.active || l.settleT >= 1) continue;
      l.settleT = Math.min(1, l.settleT + dt / 0.22);
      const pop = 0.5 + 0.5 * THREE.MathUtils.smoothstep(l.settleT, 0, 1) + Math.sin(l.settleT * Math.PI) * 0.25;
      this.looseMesh.setMatrixAt(i, this.scratchM.compose(
        l.pos,
        l.quat,
        this.scratchS.setScalar(l.scale * Math.min(1.15, pop)),
      ));
      looseDirty = true;
    }
    if (looseDirty) this.looseMesh.instanceMatrix.needsUpdate = true;
  }

  reset(): void {
    for (const n of this.nodes) {
      n.state = "idle";
      n.animT = 0;
      this.writeIdleMatrices(n, this.bucketOf[n.index]);
      this.stubble.setMatrixAt(n.index, this.zeroMatrix);
    }
    this.idleStalks[0].instanceMatrix.needsUpdate = this.idleStalks[1].instanceMatrix.needsUpdate = true;
    this.idleGrains[0].instanceMatrix.needsUpdate = this.idleGrains[1].instanceMatrix.needsUpdate = true;
    this.stubble.instanceMatrix.needsUpdate = true;
    this.patchStalks.instanceMatrix.needsUpdate = true;
    this.patchHeads.instanceMatrix.needsUpdate = true;
    this.glintOn.fill(1);
    (this.glintGeo.attributes.aOn as THREE.BufferAttribute).needsUpdate = true;
    for (const l of this.loose) l.active = false;
    this.rewriteLoose();
  }

  // --- internals -----------------------------------------------------------

  private rewriteLoose(): void {
    let count = 0;
    for (let i = 0; i < this.loose.length; i++) {
      const l = this.loose[i];
      if (!l.active) continue;
      this.looseMesh.setMatrixAt(i, this.scratchM.compose(
        l.pos,
        l.quat,
        this.scratchS.setScalar(l.scale * (l.settleT >= 1 ? 1 : 0.5)),
      ));
      count = i + 1;
    }
    // InstancedMesh slots never written default to identity matrices — the
    // count must match what was actually placed.
    this.looseMesh.count = Math.max(count, ...this.loose.map((l, i) => (l.active ? i + 1 : 0)));
    this.looseMesh.instanceMatrix.needsUpdate = true;
  }

  private writeIdleMatrices(n: GrainNode, slot: number): void {
    this.writeNodeMatrix(n, slot, n.scale);
  }

  private writeNodeMatrix(n: GrainNode, slot: number, scale: number): void {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, n.yaw);
    const m = this.scratchM.compose(n.pos, q, this.scratchS.setScalar(scale));
    if (n.patch) {
      this.patchStalks.setMatrixAt(slot, m);
      this.patchHeads.setMatrixAt(slot, m);
      return;
    }
    this.idleStalks[n.variant].setMatrixAt(slot, m);
    this.idleGrains[n.variant].setMatrixAt(slot, m);
  }

  private makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, depth: THREE.Material, count: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = count; // never leave allocated-but-unwritten slots (identity bug class)
    return mesh;
  }

  private get zeroMatrix(): THREE.Matrix4 {
    return this.scratchM.makeScale(0, 0, 0).clone();
  }

  private patchMaterial(mat: THREE.MeshStandardMaterial): { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
    const patch = (shader: WebGLProgramParametersWithUniforms): void => {
      shader.uniforms.uTime = this.shared.uTime;
      shader.uniforms.uWindDir = this.shared.uWindDir;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${WIND_DECL}`)
        .replace("#include <project_vertex>", PROJECT_REPLACEMENT);
    };
    mat.onBeforeCompile = patch;
    // Shadows must sway with the mesh.
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = patch;
    return { mat, depth };
  }

  private scatter(rng: Rng): void {
    const taken: [number, number][] = [];
    const tryPlace = (x: number, z: number): boolean => {
      const r = Math.hypot(x, z);
      if (r < 2.35 || r > 21) return false;
      if (Math.hypot(x - 0.4, z - 6.5) < 0.9) return false; // closeup lens pocket
      if (this.meadow.props.maskAt(x, z) < 0.3) return false;
      if (this.meadow.props.bumpHeight(x, z) > 0.035) return false;
      for (const [tx, tz] of taken) {
        if (Math.hypot(x - tx, z - tz) < 0.55) return false;
      }
      taken.push([x, z]);
      const y = this.meadow.heightAt(x, z) - 0.012;
      const scale = rangeRng(rng, 0.95, 1.45);
      const index = this.nodes.length;
      const headY = 0.24 * scale;
      this.nodes.push({
        index,
        pos: new THREE.Vector3(x, y, z),
        head: new THREE.Vector3(x, y + headY, z),
        yaw: rng() * Math.PI * 2,
        scale,
        phase: rng() * Math.PI * 2,
        variant: rng() < 0.55 ? 0 : 1,
        state: "idle",
        animT: 0,
      });
      return true;
    };

    const jitter = (d: number) => rangeRng(rng, -d, d);

    // Tutorial ring: four singles visible from the mound.
    let placed = 0;
    let guard = 0;
    while (placed < 4 && guard++ < 80) {
      const a = 0.6 + placed * 1.55 + jitter(0.5);
      const d = rangeRng(rng, 3.0, 5.4);
      if (tryPlace(Math.cos(a) * d, Math.sin(a) * d)) placed++;
    }

    // Three rich clusters at mid distance.
    for (let c = 0; c < 3; c++) {
      const ca = 1.1 + c * 2.2 + jitter(0.35);
      const cd = rangeRng(rng, 7, 12.5);
      const cx = Math.cos(ca) * cd;
      const cz = Math.sin(ca) * cd;
      let cp = 0;
      let cguard = 0;
      while (cp < 5 && cguard++ < 60) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * 1.7;
        if (tryPlace(cx + Math.cos(a) * d, cz + Math.sin(a) * d)) cp++;
      }
    }

    // Far singles for the return trip.
    placed = 0;
    guard = 0;
    while (placed < 7 && guard++ < 120) {
      const a = rng() * Math.PI * 2;
      const d = rangeRng(rng, 11, 19);
      if (tryPlace(Math.cos(a) * d, Math.sin(a) * d)) placed++;
    }
  }

  /** Rich patch on the apple crest — 5 split heads + the kernel spill. */
  private readonly patchSpillSpecs: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number }[] = [];

  private scatterApplePatch(rng: Rng): void {
    const apple = this.meadow.apple;
    for (let i = 0; i < apple.patchSpotCount; i++) {
      const p = apple.patchSpot(i);
      const scale = rangeRng(rng, 1.05, 1.5);
      const headY = 0.15 * scale; // split heads sit low — no tall ear stalk
      this.nodes.push({
        index: this.nodes.length,
        pos: new THREE.Vector3(p.x, p.y - 0.012, p.z),
        head: new THREE.Vector3(p.x, p.y + headY, p.z),
        yaw: rng() * Math.PI * 2,
        scale,
        phase: rng() * Math.PI * 2,
        variant: rng() < 0.55 ? 0 : 1,
        state: "idle",
        animT: 0,
        patch: true,
      });
    }

    // Windfall spill: plump kernels scattered around each split head — denser
    // right at the head, thinning outward, with a mild teardrop bias so every
    // patch reads as a burst head that spilled its grain past the ant's feet.
    for (let i = 0; i < apple.patchSpotCount; i++) {
      const p = apple.patchSpot(i);
      const spillAz = rng() * Math.PI * 2;
      const count = 14 + Math.floor(rng() * 5);
      for (let k = 0; k < count; k++) {
        const dist = 0.07 + 0.52 * Math.sqrt(rng());
        const near = rng() < 0.45;
        const ang = near ? spillAz + rangeRng(rng, -0.8, 0.8) : rng() * Math.PI * 2;
        let x = p.x + Math.sin(ang) * dist;
        let z = p.z + Math.cos(ang) * dist;
        // Keep kernels on the apple surface: pull back toward the spot if the
        // scatter left the footprint.
        for (let tries = 0; tries < 3 && !apple.contains(x, z, -0.05); tries++) {
          x = p.x + (x - p.x) * 0.6;
          z = p.z + (z - p.z) * 0.6;
        }
        if (!apple.contains(x, z, -0.05)) continue;
        const scale = rangeRng(rng, 1.9, 2.9);
        const e = new THREE.Euler(
          rangeRng(rng, 1.05, 1.5) * (rng() < 0.5 ? -1 : 1), // lying on its side
          rng() * Math.PI * 2,
          rangeRng(rng, -0.35, 0.35),
        );
        this.patchSpillSpecs.push({
          pos: new THREE.Vector3(x, this.meadow.heightAt(x, z) + 0.014 * scale, z),
          quat: new THREE.Quaternion().setFromEuler(e),
          scale,
        });
      }
    }
  }

  // --- geometry ------------------------------------------------------------

  /** One golden wheat berry, creased, tip at +Z. Instance-scaled freely. */
  private static buildGrainGeometry(): THREE.BufferGeometry {
    const geo = new THREE.SphereGeometry(1, 12, 9);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const tip = new THREE.Color(0xffe09a);
    const mid = new THREE.Color(0xeab654);
    const base = new THREE.Color(0xc08430);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Berry proportions + a shallow crease along the top face.
      x *= 0.6;
      const crease = Math.exp(-Math.pow(x / 0.16, 2)) * Math.max(0, z) * 0.22;
      pos.setXYZ(i, x * (1 - crease), y * 0.58 * (1 - crease * 0.4), z * 1.0);
      const t = z * 0.5 + 0.5;
      c.copy(base).lerp(mid, THREE.MathUtils.smoothstep(t, 0.15, 0.7)).lerp(tip, THREE.MathUtils.smoothstep(t, 0.7, 1));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.scale(0.052, 0.052, 0.052); // baked: ~0.104 u long
    geo.computeVertexNormals();
    return geo;
  }

  private static buildGrainMaterial(): THREE.MeshStandardMaterial {
    // Matte husk: high roughness + near-zero clearcoat so berries read as dry
    // wheat, not glazed candy. The warm emissive stays as collectibility.
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.8,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.8,
      emissive: 0x34210a,
      emissiveIntensity: 0.6,
      envMapIntensity: 0.75,
    });
  }

  /**
   * A fallen seed head: straw stalk with awns (stalk geo) + a spiral of
   * golden grains up the top half (grains geo), plus one dropped berry at the
   * foot. Berries are placed by ARC LENGTH at ≥ 0.05 u spacing and scaled
   * 0.30–0.38 so nothing interpenetrates its neighbours or the stalk, and the
   * foot berry is capped at 0.35 (a full-size berry there read as a mango).
   */
  private static buildEarGeometry(rng: Rng, maxBerries: number): { stalk: THREE.BufferGeometry; grains: THREE.BufferGeometry } {
    const leanA = rng() * Math.PI * 2;
    const lean = rangeRng(rng, 0.35, 0.75);
    const h = rangeRng(rng, 0.22, 0.28);
    const tip = new THREE.Vector3(Math.cos(leanA) * lean * h, h, Math.sin(leanA) * lean * h);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      tip.clone().multiplyScalar(0.4).setY(h * 0.3),
      tip.clone().multiplyScalar(0.75).setY(h * 0.68),
      tip,
    ]);
    const stalkParts: THREE.BufferGeometry[] = [
      new THREE.TubeGeometry(curve, 8, 0.0045, 5, false),
    ];
    // Awns: dry whiskers continuing past the head.
    for (let i = 0; i < 3; i++) {
      const a = leanA + (i - 1) * 0.45;
      const len = rangeRng(rng, 0.05, 0.085);
      const from = tip.clone();
      const to = from.clone().add(new THREE.Vector3(Math.cos(a) * len * 0.4, len, Math.sin(a) * len * 0.4));
      stalkParts.push(new THREE.TubeGeometry(new THREE.LineCurve3(from, to), 2, 0.0014, 3, false));
    }
    const stalk = GrainField.paintStraw(mergeGeometries(stalkParts, false) ?? stalkParts[0]);

    const grainParts: THREE.BufferGeometry[] = [];
    const tangent = curve.getTangent(1).normalize();
    const q0 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    // Arc-length placement: the ear spans the stalk from ~0.06 u to the tip,
    // one berry every ≥ 0.05 u along the curve.
    const curveLen = curve.getLength();
    const spanStart = Math.min(0.06, curveLen * 0.22);
    const span = curveLen - spanStart;
    const spacing = 0.05;
    const berryCount = Math.max(3, Math.min(maxBerries, Math.floor(span / spacing) + 1));
    const step = span / Math.max(1, berryCount - 1);
    for (let i = 0; i < berryCount; i++) {
      const p = curve.getPointAt((spanStart + i * step) / curveLen);
      const az = i * 2.7 + rng() * 0.5;
      const off = new THREE.Vector3(Math.cos(az), 0, Math.sin(az)).multiplyScalar(0.014);
      const g = GrainField.buildGrainGeometry();
      const q = q0.clone().multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.62),
      ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), az));
      g.applyQuaternion(q);
      const bs = rangeRng(rng, 0.3, 0.38);
      g.scale(bs, bs, bs * 1.1);
      g.translate(p.x + off.x, p.y, p.z + off.z);
      grainParts.push(g);
    }
    // A dropped berry at the foot sells "fallen seed head" — capped small so
    // it never reads as a foreign fruit.
    const foot = GrainField.buildGrainGeometry();
    foot.rotateX(Math.PI / 2 + rangeRng(rng, -0.4, 0.4));
    foot.rotateY(rng() * Math.PI * 2);
    const fs = rangeRng(rng, 0.26, 0.35);
    foot.scale(fs, fs, fs * 1.1);
    foot.translate(rangeRng(rng, -0.05, 0.05), 0.018, rangeRng(rng, -0.05, 0.05));
    grainParts.push(foot);
    const grains = mergeGeometries(grainParts, false) ?? grainParts[0];

    return { stalk, grains };
  }

  /**
   * The windfall patch's SPLIT seed head: a shattered straw stub (snapped
   * stems splayed at the foot) with burst-open plump berries spilled around
   * it — reads as a windfall cache, not a standing ear.
   */
  private static buildSplitHeadGeometry(rng: Rng): { stalk: THREE.BufferGeometry; grains: THREE.BufferGeometry } {
    const stalkParts: THREE.BufferGeometry[] = [];
    // Shattered stubs: short snapped stems leaning outward from the crown.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rng() * 0.8;
      const h = rangeRng(rng, 0.08, 0.16);
      const lean = rangeRng(rng, 0.4, 0.9);
      const tip = new THREE.Vector3(Math.cos(a) * lean * h, h, Math.sin(a) * lean * h);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        tip.clone().multiplyScalar(0.55).setY(h * 0.55),
        tip,
      ]);
      stalkParts.push(new THREE.TubeGeometry(curve, 6, 0.005, 5, false));
      // Frayed whiskers off each snap point.
      const len = rangeRng(rng, 0.03, 0.06);
      const wa = a + rangeRng(rng, -0.5, 0.5);
      stalkParts.push(
        new THREE.TubeGeometry(
          new THREE.LineCurve3(tip, tip.clone().add(new THREE.Vector3(Math.cos(wa) * len * 0.5, len, Math.sin(wa) * len * 0.5))),
          2, 0.0014, 3, false,
        ),
      );
    }
    const stalk = GrainField.paintStraw(mergeGeometries(stalkParts, false) ?? stalkParts[0]);

    // Burst-open berries: plump (bigger than ear berries), scattered in a
    // loose ring right around the crown, several tipped onto their sides.
    const grainParts: THREE.BufferGeometry[] = [];
    const berryCount = 6 + Math.floor(rng() * 3);
    for (let i = 0; i < berryCount; i++) {
      const az = rng() * Math.PI * 2;
      const rad = rangeRng(rng, 0.015, 0.075);
      const g = GrainField.buildGrainGeometry();
      g.rotateX(rangeRng(rng, -1.1, 1.1));
      g.rotateY(rng() * Math.PI * 2);
      const bs = rangeRng(rng, 0.42, 0.56);
      g.scale(bs, bs, bs * 1.1);
      g.translate(Math.cos(az) * rad, rangeRng(rng, 0.014, 0.03), Math.sin(az) * rad);
      grainParts.push(g);
    }
    // The spill: two or three big kernels flung further out — the "windfall".
    for (let i = 0; i < 3; i++) {
      const az = rng() * Math.PI * 2;
      const rad = rangeRng(rng, 0.08, 0.14);
      const g = GrainField.buildGrainGeometry();
      g.rotateX(Math.PI / 2 + rangeRng(rng, -0.5, 0.5));
      g.rotateY(rng() * Math.PI * 2);
      const bs = rangeRng(rng, 0.34, 0.46);
      g.scale(bs, bs, bs * 1.1);
      g.translate(Math.cos(az) * rad, 0.02, Math.sin(az) * rad);
      grainParts.push(g);
    }
    const grains = mergeGeometries(grainParts, false) ?? grainParts[0];

    return { stalk, grains };
  }

  /** Straw color ramp painted into vertex colors (base → pale tip). */
  private static paintStraw(geo: THREE.BufferGeometry): THREE.BufferGeometry {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(0x9a8454);
    const high = new THREE.Color(0xd2bc84);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / 0.24, 0, 1);
      c.copy(low).lerp(high, t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /** The nibbled stub left behind after harvest. */
  private static buildStubbleGeometry(rng: Rng): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * 0.03;
      const h = rangeRng(rng, 0.018, 0.036);
      const seg = new THREE.CylinderGeometry(0.0028, 0.004, h, 4, 1).translate(
        Math.cos(a) * d,
        h / 2,
        Math.sin(a) * d,
      );
      seg.rotateZ(rangeRng(rng, -0.25, 0.25));
      parts.push(seg);
    }
    return GrainField.paintStraw(mergeGeometries(parts, false) ?? parts[0]);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
