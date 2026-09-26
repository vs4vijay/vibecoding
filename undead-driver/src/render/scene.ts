import * as THREE from "three";
import { CONFIG } from "../config";
import { appliedQuality } from "./quality";
import { getBeamFalloffTexture } from "./textures";

export type GameScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Sun/hemisphere/ambient rig: car-following shadows + level mood (tasks 2.1–2.3). */
  lighting: DuskLighting;
};

/**
 * True when the viewport is portrait-ish; drives the wider fov base in both
 * resize paths so orientation changes reframe instead of cropping.
 */
const isPortrait = (aspect: number): boolean => aspect < 1;

// ── Image-based environment (task 1.3, design D2) ────────────────────────────

/**
 * Direction of the dusk sun from elevation/azimuth in degrees. Azimuth is
 * measured around +y from the car's travel axis (+z), elevation above the
 * horizon. Written into `out` (zero-allocation on the per-frame path).
 */
function sunDirection(elevDeg: number, azimDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const elev = THREE.MathUtils.degToRad(elevDeg);
  const azim = THREE.MathUtils.degToRad(azimDeg);
  return out.set(
    Math.cos(elev) * Math.sin(azim),
    Math.sin(elev),
    Math.cos(elev) * Math.cos(azim),
  );
}

/**
 * Tiny procedural dusk sky as an inverted vertex-color dome: look-derived
 * zenith→horizon gradient plus an HDR sun glow (sun color ×
 * textures.sky.sunGlowIntensity, falloff `textures.sky.sunGlowPow`). The glow
 * is deliberately decoupled from `look.sun.intensity` (the direct light): the
 * env map is ambient fill, and tracking the key light 1:1 would cancel every
 * intensity-driven shadow-contrast change at the tuning stage. Vertex colors
 * are float attributes, so the sun region stays above 1.0 — real HDR radiance
 * for PMREM to filter into specular highlights. Cheap: a few thousand
 * vertices, boot-time only.
 */
function buildSkyDomeScene(): THREE.Scene {
  const sky = new THREE.Scene();
  const radius = 10;
  // Tessellation only — PMREM is low-frequency and blurs far below this
  // resolution (same literal pattern as the in-game sky dome below).
  const geo = new THREE.SphereGeometry(radius, 48, 24);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const zenith = new THREE.Color(CONFIG.look.hemisphere.skyColor);
  const horizon = new THREE.Color(CONFIG.look.sun.color);
  const ground = new THREE.Color(CONFIG.look.hemisphere.groundColor);
  const sunColor = new THREE.Color(CONFIG.look.sun.color);
  const sunDir = sunDirection(
    CONFIG.look.sun.elevationDeg,
    CONFIG.look.sun.azimuthDeg,
    new THREE.Vector3(),
  );
  const mix = new THREE.Color();
  const dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    dir.fromBufferAttribute(pos, i).normalize();
    const up = dir.y;
    if (up >= 0) mix.copy(horizon).lerp(zenith, up);
    else mix.copy(horizon).lerp(ground, Math.min(1, -up * 2));
    const glow =
      Math.pow(Math.max(0, dir.dot(sunDir)), CONFIG.textures.sky.sunGlowPow) *
      CONFIG.textures.sky.sunGlowIntensity;
    colors[i * 3] = mix.r + sunColor.r * glow;
    colors[i * 3 + 1] = mix.g + sunColor.g * glow;
    colors[i * 3 + 2] = mix.b + sunColor.b * glow;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  sky.add(
    new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        fog: false,
        toneMapped: false,
      }),
    ),
  );
  return sky;
}

/**
 * PMREM-filters the procedural sky into `scene.environment` and returns the
 * wall-clock generation cost in ms (checked against
 * CONFIG.textures.genBudgetMs by the caller). The dome scene is disposed —
 * the returned render target owns the filtered cubemap.
 */
function applyEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): number {
  const t0 = performance.now();
  const skyScene = buildSkyDomeScene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(skyScene, 0, 0.1, 100);
  pmrem.dispose();
  scene.environment = envRT.texture;
  skyScene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  });
  return performance.now() - t0;
}

// ── Lighting rig (tasks 2.1–2.3, design D4) ─────────────────────────────────

/**
 * The bounded real-light set from D4 — one shadow-casting sun, one
 * hemisphere, one ambient floor — plus the level-progression mood and the
 * car-following shadow frustum. Streetlamp/headlight decoration lives with
 * its geometry (world.ts / carMesh.ts); this class owns only the lights.
 *
 * Per-frame cost (update): a handful of scalar lerps, two Vector3 writes and
 * one Matrix4 invert for the shadow texel snap — zero allocation.
 */
export class DuskLighting {
  /** Shadow-casting key light; target rides the car (added to the scene). */
  readonly sun: THREE.DirectionalLight;

  private readonly scene: THREE.Scene;
  private readonly fog: THREE.Fog;
  private readonly hemi: THREE.HemisphereLight;
  private readonly ambient: THREE.AmbientLight;

  // Mood state (task 2.3): a single damped 0..1 progression scalar; every
  // mood-driven quantity derives from it each frame.
  private moodLevel = 1;
  private moodT = 0;

  // Preallocated base colors + scratch (never allocate in update()).
  private readonly sunColorBase = new THREE.Color(CONFIG.look.sun.color);
  private readonly fogColorBase = new THREE.Color(CONFIG.look.fog.color);
  private readonly fogColorLate = new THREE.Color(CONFIG.look.moodShift.fogColorLate);
  private readonly sunColorScratch = new THREE.Color();
  private readonly hsl = { h: 0, s: 0, l: 0 };
  private readonly sunDir = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly snapView = new THREE.Matrix4();
  private readonly snapPoint = new THREE.Vector3();

  /** Shadow map size currently applied (guards shadow.map reallocation). */
  private appliedMapSize = CONFIG.look.shadow.mapSize;
  private appliedShadows: boolean | null = null;

  constructor(scene: THREE.Scene, fog: THREE.Fog) {
    const L = CONFIG.look;
    this.scene = scene;
    this.fog = fog;

    this.hemi = new THREE.HemisphereLight(
      L.hemisphere.skyColor,
      L.hemisphere.groundColor,
      L.hemisphere.intensity,
    );
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(L.ambient.color, L.ambient.intensity);
    scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(L.shadow.mapSize, L.shadow.mapSize);
    // Tight ortho frustum centered on the anchor (the car): extent is the
    // half-size, so shadow texels stay ~3 cm at mapSize 2048.
    const cam = sh.camera;
    cam.left = -L.shadow.extent;
    cam.right = L.shadow.extent;
    cam.top = L.shadow.extent;
    cam.bottom = -L.shadow.extent;
    cam.near = L.shadow.cameraNear;
    cam.far = L.shadow.cameraFar;
    cam.updateProjectionMatrix();
    sh.bias = L.shadow.bias;
    sh.normalBias = L.shadow.normalBias;
    sh.radius = L.shadow.radius;
    scene.add(this.sun);
    // The target's matrixWorld is read by the shadow pass — it must be in
    // the scene graph to update.
    scene.add(this.sun.target);
  }

  /** Sets the mood target from a game level (cheap; called on level change). */
  setLevel(level: number): void {
    this.moodLevel = level;
  }

  /**
   * Applies the adaptive-quality shadow knobs (main.ts calls this on boot and
   * whenever the quality tier changes). Resizing the shadow map disposes the
   * old render target so three reallocates at the new size; toggling shadows
   * off/on requires the classic material-recompile sweep.
   */
  applyQuality(): void {
    const size =
      appliedQuality.shadowMapSize > 0
        ? appliedQuality.shadowMapSize
        : CONFIG.look.shadow.mapSize;
    if (size !== this.appliedMapSize) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
      this.appliedMapSize = size;
    }
    if (appliedQuality.shadowsOn !== this.appliedShadows) {
      this.appliedShadows = appliedQuality.shadowsOn;
      this.sun.castShadow = appliedQuality.shadowsOn;
      this.scene.traverse(this.recompileFlag);
    }
  }

  /** Material needsUpdate sweeper (tier-change only, never per frame). */
  private readonly recompileFlag = (obj: THREE.Object3D): void => {
    const mesh = obj as THREE.Mesh;
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    if (Array.isArray(mat)) for (const m of mat) m.needsUpdate = true;
    else mat.needsUpdate = true;
  };

  /**
   * Per-frame: damp the mood toward the level target, then re-anchor the
   * shadow frustum on the car, texel-snapped so sub-texel drift of the
   * frustum can never shimmer the shadow edges. `dt` is the wall-clock frame
   * delta (0 on the first call — pure pose, no damp).
   */
  update(carX: number, carZ: number, dt: number): void {
    const L = CONFIG.look;
    const M = L.moodShift;

    // — mood damp —
    const tTarget = THREE.MathUtils.clamp((this.moodLevel - 1) / M.levelsSpan, 0, 1);
    if (dt > 0) {
      this.moodT += (tTarget - this.moodT) * (1 - Math.exp(-dt * M.lerpRate));
    }
    const t = this.moodT;

    // — sun pose from the current mood elevation —
    const elevDeg = L.sun.elevationDeg + M.sunElevationDeltaDeg * t;
    sunDirection(elevDeg, L.sun.azimuthDeg, this.sunDir);

    // — mood-tinted sun color (hue rotate the base) —
    this.sunColorScratch.copy(this.sunColorBase);
    const hueShift = (M.sunHueShiftDeg * t) / 360;
    if (hueShift !== 0) {
      this.sunColorScratch.getHSL(this.hsl);
      this.sunColorScratch.setHSL(this.hsl.h + hueShift, this.hsl.s, this.hsl.l);
    }
    this.sun.color.copy(this.sunColorScratch);

    // — intensities + fog —
    const k = 1 + (M.lightIntensityScale - 1) * t;
    this.sun.intensity = L.sun.intensity * k;
    this.hemi.intensity = L.hemisphere.intensity * k;
    this.fog.color.lerpColors(this.fogColorBase, this.fogColorLate, t);
    // Density read: FogExp2's density↑ is this linear fog's far↓ (the fog
    // TYPE stays Group 4's decision; the mood scale is felt either way).
    this.fog.far = L.fog.far / (1 + (M.fogDensityScale - 1) * t);

    // — shadow frustum follow + texel snap (task 2.1) —
    const S = L.shadow;
    this.anchor.set(carX, 0, carZ);
    this.sun.target.position.copy(this.anchor);
    this.sun.position.copy(this.anchor).addScaledVector(this.sunDir, S.lightDistance);
    // Snap in light space: quantize the anchor to the shadow-map texel grid,
    // then translate BOTH light and target by the (constant-rotation) world
    // delta. The frustum hence only ever moves in whole-texel steps — no
    // shimmer, and re-centering can't pop at the screen edges because the
    // edge of the frustum is >20 texels outside the visible corridor.
    this.sun.updateMatrixWorld();
    this.snapView.copy(this.sun.matrixWorld).invert();
    this.snapPoint.copy(this.anchor).applyMatrix4(this.snapView);
    const texel = (2 * S.extent) / Math.max(1, this.appliedMapSize);
    const dx = Math.round(this.snapPoint.x / texel) * texel - this.snapPoint.x;
    const dy = Math.round(this.snapPoint.y / texel) * texel - this.snapPoint.y;
    if (dx !== 0 || dy !== 0) {
      const e = this.sun.matrixWorld.elements;
      const wx = e[0] * dx + e[4] * dy;
      const wy = e[1] * dx + e[5] * dy;
      const wz = e[2] * dx + e[6] * dy;
      this.sun.position.x += wx;
      this.sun.position.y += wy;
      this.sun.position.z += wz;
      this.sun.target.position.x += wx;
      this.sun.target.position.y += wy;
      this.sun.target.position.z += wz;
    }
  }
}

// ── Light-fake geometry/material helpers (task 2.2, shared by carMesh/world) ─

/**
 * Two crossed vertical quads hanging from the local origin DOWN -y — the
 * classic additive light-shaft fake standing in for a beam cone. Each quad is
 * a trapezoid (`topWidth` at y=0 tapering to `bottomWidth` at y=-height), so
 * the silhouette is a true cone from any side. u runs across each quad (0..1,
 * sampling the beam-falloff texture's bright center row), v is pinned to the
 * texture's horizontal midline, and the along-beam falloff comes from vertex
 * colors (1 at the source → 0 at the far end) multiplied through by the
 * additive material. One geometry = both quads = one draw call per beam.
 */
export function buildBeamCrossGeometry(
  topWidth: number,
  bottomWidth: number,
  height: number,
): THREE.BufferGeometry {
  const hw0 = topWidth / 2;
  const hw1 = bottomWidth / 2;
  // Quad A spans x (normal ±z), quad B spans z (normal ±x). Two triangles
  // each; DoubleSide material makes winding irrelevant.
  const pos = new Float32Array([
    -hw0, 0, 0, hw0, 0, 0, hw1, -height, 0, -hw1, -height, 0,
    0, 0, -hw0, 0, 0, hw0, 0, -height, hw1, 0, -height, -hw1,
  ]);
  const uv = new Float32Array([
    0, 0.5, 1, 0.5, 1, 0.5, 0, 0.5,
    0, 0.5, 1, 0.5, 1, 0.5, 0, 0.5,
  ]);
  const col = new Float32Array([
    1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);
  return geo;
}

/**
 * Additive beam/glow material: the generated beam-falloff texture × vertex
 * colors × `color`×`opacity` (opacity is baked into the material color —
 * additive blending adds black for nothing, so there is no real alpha).
 */
export function makeBeamMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    map: getBeamFalloffTexture(),
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false, // additive + fog would add fog COLOR at distance; fake glows fade by geometry instead
    toneMapped: true,
  });
  mat.color.setHex(color).multiplyScalar(opacity);
  return mat;
}

/** Renderer, dusk-lit scene with fog + gradient sky dome, a sun plus rear-fill light, and the game camera. */
export function createGameScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(new THREE.Color(CONFIG.world.duskColor), 1);

  // ── Filmic pipeline (task 1.4) ──────────────────────────────────────────
  // ACES + sRGB + exposure live on the renderer so BOTH render paths stay in
  // lockstep: the direct `renderer.render` bypass tonemaps into the default
  // framebuffer, while the composer path tonemaps in its OutputPass, which
  // reads these same settings. (three only applies renderer tonemapping when
  // rendering to the default framebuffer, so nothing is ever applied twice.)
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.look.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Shadow capability; the car-following shadow-casting sun itself is built
  // by DuskLighting below (task 2.1), consuming CONFIG.look.shadow.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Composer path runs several internal renders per frame (autoReset would
  // leave only the LAST pass's call count); main.ts resets per frame instead
  // so `renderer.info.render.calls` keeps meaning "draw calls this frame".
  renderer.info.autoReset = false;

  // Cap at DPR 2: beyond that fill-rate cost swamps phones without a
  // visible sharpness gain.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // updateStyle MUST stay true: the buffer is width*dpr, and without an
  // explicit CSS size the canvas lays out at buffer size — on retina (dpr 2)
  // that's 2x the window, showing a zoomed top-left crop of the frame.
  renderer.setSize(window.innerWidth, window.innerHeight, true);

  const scene = new THREE.Scene();
  // Fog now comes from the `look` palette (supersedes `world` per config):
  // color/near/far are the mood rig's base state, mutated per frame by
  // DuskLighting.update (task 2.3).
  const fog = new THREE.Fog(CONFIG.look.fog.color, CONFIG.look.fog.near, CONFIG.look.fog.far);
  scene.fog = fog;

  // Dusk env lighting for PBR materials (task 1.3): PMREM-filtered procedural
  // sky. Inert for the current Lambert/Basic materials — goes live when task
  // 3.1 migrates them to MeshStandardMaterial. The visible sky dome below is
  // unchanged; the real shader sky is task 4.1.
  const envMs = applyEnvironment(renderer, scene);
  if (import.meta.env.DEV) {
    const budget = CONFIG.textures.genBudgetMs;
    const line = `[scene] PMREM env generated in ${envMs.toFixed(1)} ms (budget ${budget} ms)`;
    if (envMs > budget) console.warn(`${line} — OVER BUDGET`);
    else console.info(line);
  }

  // Inverted sky dome with a vertex-color gradient: zenith 0x1a1030 -> horizon 0xff7733.
  // Parented to the camera so the dome always surrounds the player; fog disabled so
  // the gradient survives past the fog far plane.
  const skyGeo = new THREE.SphereGeometry(400, 24, 12);
  const pos = skyGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const zenith = new THREE.Color(0x1a1030);
  const horizon = new THREE.Color(0xff7733);
  const mix = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 400, 0, 1);
    mix.copy(horizon).lerp(zenith, t);
    colors[i * 3] = mix.r;
    colors[i * 3 + 1] = mix.g;
    colors[i * 3 + 2] = mix.b;
  }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(
    skyGeo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  // Bounded real-light set (D4): shadow-casting sun + hemisphere + ambient
  // floor (rear fill retired — hemisphere/ambient/env now carry the fill).
  // Posing, shadows and mood all run through the rig below.
  const lighting = new DuskLighting(scene, fog);

  const camera = new THREE.PerspectiveCamera(
    // Aspect-compensated base: portrait gets a wider lens so the road stays
    // framed; the rig's speed kick lerps up from whatever base this returns.
    window.innerWidth / window.innerHeight < 1 ? 74 : CONFIG.camera.fovBase,
    window.innerWidth / window.innerHeight,
    CONFIG.camera.near,
    CONFIG.camera.far,
  );
  camera.add(sky);
  scene.add(camera);

  const onResize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, true);
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    camera.fov = isPortrait(aspect) ? 74 : CONFIG.camera.fovBase;
    camera.updateProjectionMatrix();
  };
  // visualViewport fires on rotate/split-view where window.resize can lag or
  // skip; listen to both and let idempotent updates absorb duplicates.
  window.visualViewport?.addEventListener("resize", onResize);
  window.addEventListener("resize", onResize);

  return { scene, camera, renderer, lighting };
}
