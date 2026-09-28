import * as THREE from "three";
import { mulberry32, rangeRng, Rng } from "../util/Rng";
import { springSeedGrassMask } from "../gameplay/SpringSeeds";
import type { Meadow } from "./Meadow";

/**
 * GPU-instanced grass. Each instance is one CLUMP of crossed low-poly blades
 * (5–9 blades, ≤ 60 verts total) — per the plan, clump quads keep overdraw
 * survivable. Wind is layered in the vertex shader: a large slow noise-driven
 * gust field plus per-blade flutter, weighted by uv.y^2 so roots stay planted.
 * Blades also bend away from the ant (uPlayerPos) — the interaction sell.
 *
 * The same displacement is injected into the shadow depth material so cast
 * shadows track the bent blades.
 */

const WIND_UNIFORM_DECL = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uGustStrength;
uniform float uGustScale;
uniform vec3 uPlayerPos;
uniform float uPlayerRadius;
uniform float uPushStrength;
uniform vec3 uCamPos;
uniform vec2 uCamDir;
uniform float uCamRadius;
uniform float uCamPush;
`;

const WIND_FN = /* glsl */ `
float gwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float gwNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = gwHash(i);
  float b = gwHash(i + vec2(1.0, 0.0));
  float c = gwHash(i + vec2(0.0, 1.0));
  float d = gwHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// bendW: uv.y² — wind hinges the blade near the tip, roots planted.
// wPush: uv.y*0.92 + 0.08 — dynamic pushes bow the WHOLE blade (stalks move
// aside at body height) while keeping root shift ≤ ~5 cm.
vec3 grassOffset(vec3 wPos, float bendW, float wPush, float wCam, float phaseSeed) {
  vec2 gp = wPos.xz * uGustScale - uWindDir * uTime * 0.5;
  float gust = gwNoise(gp) * 0.65 + gwNoise(gp * 2.9 + 17.7) * 0.35;
  gust *= gust; // sharpen: calm air with rolling strong gusts
  float flutter = sin(uTime * 6.3 + phaseSeed + wPos.x * 1.7 + wPos.z * 2.3);
  float wind = gust * uGustStrength * (0.75 + 0.25 * flutter) + flutter * 0.045;
  vec2 bend = uWindDir * wind;

  // Radial push away from the ant…
  vec2 push = vec2(0.0);
  vec2 toB = wPos.xz - uPlayerPos.xz;
  float d = length(toB);
  float fall = 1.0 - smoothstep(uPlayerRadius * 0.3, uPlayerRadius, d);
  push += (d > 1e-4 ? toB / d : vec2(0.0, 1.0)) * (fall * fall * uPushStrength) * wPush;

  // …and away from the camera (3D falloff, so low blades part for low cameras).
  // Falloff starts near zero distance: a blade AT the lens must still bend.
  // Blades IN FRONT of the lens are deflected LATERALLY (against their side of
  // the view axis) so they slide out of the frame instead of stacking along
  // the sight line — radial-only push keeps them on the same bearing.
  vec3 toC3 = wPos - uCamPos;
  float dc = length(toC3);
  float fallC = 1.0 - smoothstep(uCamRadius * 0.08, uCamRadius, dc);
  vec2 dirC = length(toC3.xz) > 1e-4 ? normalize(toC3.xz) : vec2(0.0, 1.0);
  float alongC = dot(dirC, uCamDir);
  vec2 latC = dirC - uCamDir * alongC;
  float latLen = length(latC);
  vec2 sideC = latLen > 1e-3 ? latC / latLen : vec2(uCamDir.y, -uCamDir.x);
  vec2 pushDirC = normalize(mix(dirC, sideC, smoothstep(0.1, 0.6, alongC) * 0.58));
  push += pushDirC * (fallC * fallC * uCamPush) * wCam;


  return vec3(bend.x + push.x, 0.0, bend.y + push.y);
}
`;

// Replaces project_vertex: displacement happens in world space after the
// instance transform so wind direction does not rotate with the clump.
// A dynamic lens pocket: when the camera sits on top of a clump, the clump
// collapses toward its root (and the wind calms) — no blade ever crosses the
// lens, and no hand-carved clearings are needed for any camera position.
const PROJECT_REPLACEMENT = /* glsl */ `
vec4 gwp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  gwp = instanceMatrix * gwp;
#endif
gwp = modelMatrix * gwp;
float gBendW = uv.y * uv.y;
vec3 gOff = grassOffset(gwp.xyz, gBendW, uv.y * 0.92 + 0.08, pow(uv.y, 0.55), fract(gwHash(gwp.xz) * 7.31) * 6.2831);
float gLensKeep = 1.0;
#ifdef USE_INSTANCING
  vec3 gRootW = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  // Per-clump collapse: shrink the whole clump into its base when the camera
  // is right on top of it (base sinks slightly to stay hidden). The radius is
  // generous: blades whose roots are ~1 unit out still lean over the lens, and
  // curled ~1.5-unit clumps at 1.0–1.5 units hung flat-side across closeup
  // frames top-center — so the pocket reaches ~2 units and melts overhangs
  // before they can hang (the subject ~1.9 out stays clear of the falloff).
  gLensKeep = smoothstep(0.2, 2.1, distance(gRootW, uCamPos));
  gwp.xyz = mix(gRootW - vec3(0.0, 0.08, 0.0), gwp.xyz, gLensKeep);
#endif
// Mid-collapse clumps lose their wind/push displacement too (quadratically),
// so they shrink into clean tufts instead of floating folded shards.
gOff *= gLensKeep * gLensKeep;
gwp.xyz += gOff;
vGrassT = uv.y;
vGrassX = uv.x;
vGrassWorld = gwp.xyz;
vec4 mvPosition = viewMatrix * gwp;
// Clumps essentially AT the lens collapse to a zero-area point that can sit
// exactly on the near plane; some rasterizers (SwiftShader) mis-rasterize
// that degenerate sliver as a full-screen artifact. They are invisible by
// definition, so clip them out outright instead of submitting the sliver.
gl_Position = gLensKeep < 0.004
  ? vec4(2.0, 2.0, 2.0, 1.0)
  : projectionMatrix * mvPosition;
`;

export class GrassField {
  /** Primary variant mesh; extra variants in `extraMeshes` (shared material). */
  readonly mesh: THREE.InstancedMesh;
  readonly extraMeshes: THREE.InstancedMesh[] = [];

  /**
   * Small deterministic lens pocket kept ONLY for the grass-closeup camera
   * (see ShotDirector) so no blade crosses the lens. The run-path pockets are
   * deliberately gone — blades now line the ant's path and get parted by the
   * grass-bend interaction.
   */
  private static readonly CLEARINGS = [
    { x: 0.4, z: 6.5, r: 0.42 }, // grass-closeup camera lens pocket
  ];

  readonly shared = {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(0.82, 0.57).normalize() },
    uGustStrength: { value: 0.34 },
    uGustScale: { value: 0.16 },
    uPlayerPos: { value: new THREE.Vector3(0, -10, 0) },
    uPlayerRadius: { value: 0.95 },
    uPushStrength: { value: 0.85 },
    uCamPos: { value: new THREE.Vector3(0, -10, 0) },
    uCamDir: { value: new THREE.Vector2(0, 1) },
    uCamRadius: { value: 2.2 },
    uCamPush: { value: 0.85 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xfff7e8) },
    uTipTint: { value: new THREE.Color(0.16, 0.15, 0.03) },
    uBacklight: { value: 0.55 },
  };

  constructor(private meadow: Meadow, seed: number) {
    const rng = mulberry32(seed);
    // Five distinct clump architectures — blade count, height distribution,
    // curl — so the meadow never stamps the same silhouette. The high-curl
    // variants build 6-row blades (9 tris vs 5) so fold highlights stay smooth
    // instead of reading as paper cutouts.
    const variants: ClumpVariant[] = [
      { blades: 4, hMin: 0.55, hMax: 0.95, curl: [0.9, 1.7], width: [0.03, 0.052] }, // sparse short
      { blades: 7, hMin: 0.55, hMax: 1.0, curl: [0.5, 1.2], width: [0.028, 0.048], rows: 6 }, // classic
      { blades: 9, hMin: 0.5, hMax: 1.0, curl: [0.7, 1.4], width: [0.026, 0.044] }, // dense tuft
      { blades: 6, hMin: 0.75, hMax: 1.2, curl: [0.2, 0.7], width: [0.026, 0.042] }, // tall straight
      { blades: 5, hMin: 0.55, hMax: 1.05, curl: [1.4, 2.3], width: [0.032, 0.055], rows: 6 }, // wispy curl
    ];
    const geos = variants.map((v) => buildClumpGeometry(rng, v));

    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.defines = { USE_UV: "" };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.shared);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vGrassT;\nvarying float vGrassX;\nvarying vec3 vGrassWorld;\n" +
            WIND_UNIFORM_DECL +
            WIND_FN,
        )
        .replace("#include <project_vertex>", PROJECT_REPLACEMENT)
        .replace(
          "#include <beginnormal_vertex>",
          "#include <beginnormal_vertex>\nobjectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.72));",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying float vGrassT;
varying float vGrassX;
varying vec3 vGrassWorld;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uTipTint;
uniform float uBacklight;`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
{
  float gT = smoothstep(0.0, 1.0, vGrassT);
  vec3 gTip = diffuseColor.rgb * 1.3 + uTipTint * gT;
  diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.40, 0.46, 0.38), gTip, gT);
  // Fake rounded shading: gently darker blade edges, brighter midrib
  // (kept subtle — hard creases read as plastic ribbon up close).
  float gEdge = 1.0 - abs(vGrassX * 2.0 - 1.0);
  diffuseColor.rgb *= 0.85 + 0.20 * gEdge * gEdge;
  // Guard the normalize: a collapsed clump can land vertices exactly on the
  // camera position, and normalize(0) poisons every downstream light term.
  vec3 gDelta = vGrassWorld - cameraPosition;
  vec3 gView = length(gDelta) > 1e-4 ? normalize(gDelta) : vec3(0.0, 1.0, 0.0);
  float gBack = pow(clamp(dot(gView, uSunDir), 0.0, 1.0), 3.0) * uBacklight * gT;
  diffuseColor.rgb += uSunColor * gBack;
}`,
        );
    };

    // Shadow casting with the exact same world displacement.
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depthMat.defines = { USE_UV: "" };
    depthMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.shared);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vGrassT;\nvarying float vGrassX;\nvarying vec3 vGrassWorld;\n" +
            WIND_UNIFORM_DECL +
            WIND_FN,
        )
        .replace("#include <project_vertex>", PROJECT_REPLACEMENT);
    };

    const instances = this.scatter(rng);
    const buckets: { matrices: THREE.Matrix4[]; colors: THREE.Color[] }[] = variants.map(() => ({
      matrices: [],
      colors: [],
    }));
    for (let i = 0; i < instances.count; i++) {
      const b = buckets[instances.variants[i]];
      b.matrices.push(instances.matrices[i]);
      b.colors.push(instances.colors[i]);
    }

    const makeMesh = (geo: THREE.BufferGeometry, bucket: (typeof buckets)[number]) => {
      const mesh = new THREE.InstancedMesh(geo, mat, bucket.matrices.length);
      mesh.customDepthMaterial = depthMat;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < bucket.matrices.length; i++) {
        mesh.setMatrixAt(i, bucket.matrices[i]);
        mesh.setColorAt(i, bucket.colors[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      return mesh;
    };

    this.mesh = makeMesh(geos[0], buckets[0]);
    for (let v = 1; v < variants.length; v++) {
      if (buckets[v].matrices.length > 0) this.extraMeshes.push(makeMesh(geos[v], buckets[v]));
    }
    this.instanceCount = instances.count;
  }

  readonly instanceCount: number;

  /** Called every frame by Game with the (possibly pinned) wind clock. */
  setTime(t: number): void {
    this.shared.uTime.value = t;
  }

  setPlayer(pos: THREE.Vector3): void {
    this.shared.uPlayerPos.value.copy(pos);
  }

  setCamera(pos: THREE.Vector3): void {
    this.shared.uCamPos.value.copy(pos);
  }

  /** Horizontal view direction, for lateral lens-parting in the shader. */
  setCameraDir(dir: THREE.Vector3): void {
    const d = this.shared.uCamDir.value;
    d.set(dir.x, dir.z);
    if (d.lengthSq() < 1e-6) d.set(0, 1);
    d.normalize();
  }

  syncSun(dir: THREE.Vector3, color: THREE.Color): void {
    this.shared.uSunDir.value.copy(dir).normalize();
    this.shared.uSunColor.value.copy(color);
  }

  /** Two-ring jittered scatter: dense near field, sparser oversized far ring. */
  private scatter(rng: Rng): {
    count: number;
    matrices: THREE.Matrix4[];
    colors: THREE.Color[];
    variants: number[];
  } {
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const variants: number[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();

    const place = (x: number, z: number, scaleMin: number, scaleMax: number) => {
      // Props keep-outs × grain-node footprints × anthill dirt ring × apple
      // footprint × spring-seed pods.
      const mask = this.meadow.props.maskAt(x, z)
        * this.meadow.grains.maskAt(x, z)
        * this.meadow.anthill.grassMask(x, z)
        * this.meadow.apple.grassMask(x, z)
        * springSeedGrassMask(x, z);
      if (mask < 0.05) return;
      for (const c of GrassField.CLEARINGS) {
        if (Math.hypot(x - c.x, z - c.z) < c.r) return;
      }
      if (rng() > 0.35 + 0.65 * mask) return;
      const y = this.meadow.terrainHeight(x, z) - 0.02;
      const scale = rangeRng(rng, scaleMin, scaleMax);
      e.set(rangeRng(rng, -0.09, 0.09), rng() * Math.PI * 2, rangeRng(rng, -0.09, 0.09));
      q.setFromEuler(e);
      p.set(x, y, z);
      s.setScalar(scale);
      matrices.push(m.clone().compose(p, q, s));
      // Wider hue band with ~8% dry-yellow outliers to break the green stamp.
      if (rng() < 0.08) {
        col.setHSL(rangeRng(rng, 0.115, 0.16), rangeRng(rng, 0.5, 0.68), rangeRng(rng, 0.34, 0.5));
      } else {
        col.setHSL(rangeRng(rng, 0.21, 0.34), rangeRng(rng, 0.45, 0.66), rangeRng(rng, 0.26, 0.44));
      }
      colors.push(col.clone());
      variants.push(Math.floor(rng() * 5));
    };

    // Dense near field — where the ant lives and the close-ups happen.
    const nearStep = 0.62;
    for (let x = -27; x <= 27; x += nearStep) {
      for (let z = -27; z <= 27; z += nearStep) {
        const jx = x + rangeRng(rng, -0.26, 0.26);
        const jz = z + rangeRng(rng, -0.26, 0.26);
        if (Math.hypot(jx, jz) < 26.5) place(jx, jz, 0.55, 1.55);
      }
    }
    // Sparse far ring with oversized clumps for silhouette continuity.
    // Ceiling kept at 1.9 (was 2.35): taller far-ring blades overhung into
    // closeup frames top-center as flat ribbon shards before melting.
    const farStep = 1.85;
    for (let x = -66; x <= 66; x += farStep) {
      for (let z = -66; z <= 66; z += farStep) {
        const r = Math.hypot(x, z);
        if (r < 26 || r > 66) continue;
        place(x + rangeRng(rng, -0.8, 0.8), z + rangeRng(rng, -0.8, 0.8), 1.25, 1.9);
      }
    }

    return { count: matrices.length, matrices, colors, variants };
  }
}

interface ClumpVariant {
  blades: number;
  hMin: number;
  hMax: number;
  curl: [number, number];
  width: [number, number];
  /** Blade tessellation rows (4 → 5 tris, 6 → 9 tris). */
  rows?: number;
}

/**
 * One clump: 4–10 blades (rows at t=0..1 + tip vertex), each with a baked
 * static lean + curvature so the meadow is not a bowl of identical candles.
 * uv.y = 0 at root, 1 at tip. The `variant` drives blade count, height
 * distribution, curl, width and tessellation so each of the five instanced
 * meshes reads as a different plant.
 */
function buildClumpGeometry(rng: Rng, variant: ClumpVariant): THREE.BufferGeometry {
  const blades = Math.max(3, Math.round(variant.blades * rangeRng(rng, 0.85, 1.15)));
  const rows = variant.rows ?? 4;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const clumpHeight = rangeRng(rng, variant.hMin, variant.hMax);

  for (let b = 0; b < blades; b++) {
    const yaw = rng() * Math.PI * 2;
    const rad = b === 0 ? 0 : rangeRng(rng, 0.02, 0.1);
    const baseX = Math.cos(yaw) * rad;
    const baseZ = Math.sin(yaw) * rad;
    const height = clumpHeight * rangeRng(rng, 0.55, 1.0);
    const width = rangeRng(rng, variant.width[0], variant.width[1]);
    const leanDir = rng() * Math.PI * 2;
    const lean = rangeRng(rng, 0.06, 0.3);
    const curl = rangeRng(rng, variant.curl[0], variant.curl[1]);
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const leanX = Math.cos(leanDir);
    const leanZ = Math.sin(leanDir);

    const start = positions.length / 3;
    for (let r = 0; r < rows; r++) {
      const t = r / (rows - 1);
      const y = t * height;
      // Static curvature along the lean direction grows quadratically.
      const c = t * t * curl * height * 0.14 + t * lean * height * 0.3;
      const cx = baseX + leanX * c;
      const cz = baseZ + leanZ * c;
      const halfW = r === rows - 1 ? 0 : width * 0.5 * Math.pow(1 - t, 1.15) + (r === 0 ? 0 : 0.002);
      if (r === rows - 1) {
        positions.push(cx, y, cz);
        uvs.push(0.5, t);
      } else {
        positions.push(cx - sinY * halfW, y, cz + cosY * halfW);
        positions.push(cx + sinY * halfW, y, cz - cosY * halfW);
        uvs.push(0, t, 1, t);
      }
    }
    // Quad strip rows + tip fan: 2·(rows−2)+1 triangles.
    for (let r = 0; r < rows - 2; r++) {
      const i = start + r * 2;
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
    const l = start + (rows - 2) * 2;
    indices.push(l, l + 1, l + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
