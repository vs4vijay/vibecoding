/**
 * WebGL renderer setup + quality tiers (Midtown Blitz engine, task 1.5).
 *
 * Owns everything renderer-level so `main.js` only composes: constructing
 * and sizing the THREE.WebGLRenderer, the low/medium/high quality tiers
 * (design Decision 6), resize handling, and the per-tier fog/draw-distance
 * values scenes should adopt.
 *
 * Quality tiers apply immediately, without reload (game-shell spec,
 * "Quality change applies immediately"):
 *  - `pixelRatioCap` caps the device pixel ratio (`setPixelRatio`), so the
 *    internal drawing buffer — and therefore GPU fill cost — scales down.
 *  - `shadows` gates `renderer.shadowMap.enabled`; per design, shadow
 *    *casting* is only on at high tier. Wiring `light.castShadow`,
 *    `light.shadow.mapSize`, and object cast/receive flags stays the
 *    scene's job: it reads the current tier via `getQualityTier()` /
 *    {@link QUALITY_TIERS}. When the flag flips with a scene passed in,
 *    every material in that scene is marked `needsUpdate` so three
 *    recompiles programs and the change takes effect live (three's
 *    documented requirement for runtime `shadowMap.enabled` toggles).
 *  - `fogNear` / `fogFar` / `cameraFar` are the draw-distance triple;
 *    {@link applyTierFog} copies them into a scene's fog and camera.
 *
 * Tier values: `shadowMapSize` is a convenience constant for scenes to put
 * on `light.shadow.mapSize` (only meaningful while `shadows` is true).
 *
 * The `context`/`canvas` options on {@link createEngineRenderer} exist so a
 * plain-node harness can inject a fake WebGL context — three only stores
 * them until `renderer.render()` is called, which tests never do. Like
 * loop.js / input.js / audio.js, the tier core
 * ({@link applyQualityTier}) is a standalone function so it can be driven
 * against the real renderer without a browser.
 */

import * as THREE from 'three';

/** Every quality tier name, low -> high (stable display order). */
export const QUALITY_TIER_NAMES = Object.freeze(['low', 'medium', 'high']);

/** Tier used before the player changes anything (and on invalid input). */
export const DEFAULT_TIER = 'medium';

/**
 * Per-tier settings (design Decision 6). Frozen; scenes may read but never
 * mutate. Values are engine suggestions — the city task owns the final
 * draw-distance tuning, and only has to keep low < medium < high.
 */
export const QUALITY_TIERS = Object.freeze({
  low: Object.freeze({
    label: 'low',
    /** Cap applied to devicePixelRatio (engine draws at min(dpr, cap)). */
    pixelRatioCap: 0.75,
    /** Shadow casting is only enabled at high tier. */
    shadows: false,
    /** Nominal light.shadow.mapSize for scenes to apply at this tier. */
    shadowMapSize: 1024,
    /** Fog start distance (m). */
    fogNear: 40,
    /** Fog end / full-occlusion distance (m) — the draw-distance scale. */
    fogFar: 190,
    /** Perspective camera far plane (m). */
    cameraFar: 240,
  }),
  medium: Object.freeze({
    label: 'medium',
    pixelRatioCap: 1.5,
    shadows: false,
    shadowMapSize: 1024,
    fogNear: 60,
    fogFar: 260,
    cameraFar: 340,
  }),
  high: Object.freeze({
    label: 'high',
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 2048,
    fogNear: 80,
    fogFar: 340,
    cameraFar: 420,
  }),
});

/**
 * Validate a tier name.
 * @param {string} name Tier name ('low' | 'medium' | 'high').
 * @returns {string} The validated name (unchanged).
 * @throws {TypeError} If the name is not a known tier.
 */
export function resolveTierName(name) {
  if (typeof name !== 'string' || !Object.hasOwn(QUALITY_TIERS, name)) {
    throw new TypeError(
      `resolveTierName: unknown quality tier ${JSON.stringify(name)}; expected one of ${QUALITY_TIER_NAMES.join(', ')}`
    );
  }
  return name;
}

/**
 * Effective pixel ratio for a tier: the device ratio clamped by the tier's
 * cap. This is the single source of truth for "resolution scale".
 * @param {string} tierName Tier name.
 * @param {number} devicePixelRatio Device pixel ratio to clamp (>= 0).
 * @returns {number} The pixel ratio to hand to renderer.setPixelRatio.
 */
export function effectivePixelRatio(tierName, devicePixelRatio) {
  const cap = QUALITY_TIERS[resolveTierName(tierName)].pixelRatioCap;
  const dpr = Number.isFinite(devicePixelRatio) ? Math.max(0, devicePixelRatio) : 1;
  return Math.min(dpr, cap);
}

/**
 * Mark every material in a scene for recompilation (needed so a live
 * `shadowMap.enabled` toggle takes effect on already-compiled programs).
 * @param {THREE.Scene} scene Scene to walk.
 * @returns {void}
 */
function refreshSceneMaterials(scene) {
  scene.traverse((obj) => {
    const mats = obj.material;
    if (!mats) return;
    if (Array.isArray(mats)) {
      for (const m of mats) m.needsUpdate = true;
    } else {
      mats.needsUpdate = true;
    }
  });
}

/**
 * Apply a quality tier to a renderer immediately: pixel ratio (device
 * ratio clamped by the tier cap) and shadowMap enabled/type. Pure in the
 * sense that it only touches the renderer passed in, so a node harness can
 * drive it against a real THREE.WebGLRenderer built on a fake GL context.
 *
 * When `scene` is given and the shadow flag flips, every material in the
 * scene is marked `needsUpdate` so the change is visible without reload.
 * Light/object shadow flags and shadow map sizes stay the scene's job.
 *
 * @param {THREE.WebGLRenderer} renderer Renderer to reconfigure.
 * @param {string} tierName Tier to apply ('low' | 'medium' | 'high').
 * @param {object} [options] Options.
 * @param {THREE.Scene} [options.scene=null] Scene whose materials should be
 *   refreshed when the shadow flag changes (optional but recommended).
 * @param {number} [options.devicePixelRatio=1] Device pixel ratio the tier
 *   cap is applied to.
 * @returns {string} The applied (validated) tier name.
 */
export function applyQualityTier(renderer, tierName, { scene = null, devicePixelRatio = 1 } = {}) {
  const tier = QUALITY_TIERS[resolveTierName(tierName)];
  renderer.setPixelRatio(effectivePixelRatio(tierName, devicePixelRatio));
  if (renderer.shadowMap) {
    const wasEnabled = renderer.shadowMap.enabled === true;
    renderer.shadowMap.enabled = tier.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (wasEnabled !== tier.shadows && scene) {
      refreshSceneMaterials(scene);
    }
  }
  return tierName;
}

/**
 * Copy a tier's draw-distance values into a scene: fog near/far (creating a
 * placeholder-colored fog if the scene has none) and the camera far plane.
 * Scenes call this once at build time and again whenever the tier changes.
 * @param {THREE.Scene} scene Scene whose fog is adjusted.
 * @param {THREE.PerspectiveCamera} [camera=null] Camera whose far plane is
 *   adjusted (and reprojected) if provided.
 * @param {string} tierName Tier to read values from.
 * @returns {object} The tier definition that was applied.
 */
export function applyTierFog(scene, camera = null, tierName = DEFAULT_TIER) {
  const tier = QUALITY_TIERS[resolveTierName(tierName)];
  if (!scene.fog) {
    scene.fog = new THREE.Fog(0x9db8cc, tier.fogNear, tier.fogFar);
  }
  scene.fog.near = tier.fogNear;
  scene.fog.far = tier.fogFar;
  if (camera && camera.isPerspectiveCamera) {
    camera.far = tier.cameraFar;
    camera.updateProjectionMatrix();
  }
  return tier;
}

/**
 * Current resolution scale of a renderer (its pixel ratio): the number the
 * debug overlay shows so tier switches are observably effective.
 * @param {THREE.WebGLRenderer} renderer Renderer to read.
 * @returns {number} renderer.getPixelRatio() (0.75x..2x the CSS pixel size).
 */
export function getResolutionScale(renderer) {
  return renderer.getPixelRatio();
}

/**
 * True when n is a usable CSS pixel dimension: a finite number > 0. Every
 * renderer sizing path guards with this so degenerate embed-pane states
 * (a collapsed pane firing resize events with 0 / non-finite dimensions)
 * can never reach the renderer or the camera.
 * @param {number} n Candidate dimension.
 * @returns {boolean} Whether n may size the renderer.
 */
function isUsableSize(n) {
  return Number.isFinite(n) && n > 0;
}

/**
 * Resize a renderer to CSS pixel dimensions and keep a perspective camera's
 * aspect in sync. The single resize path for the whole app (window resize
 * and any future fullscreen toggle should both funnel through here).
 *
 * A degenerate resize — 0 or non-finite dimensions, e.g. a collapsed embed
 * pane firing resize events while occluded — is ignored: neither the
 * renderer size nor the camera aspect/projection is touched, so the
 * last-known-good size and camera aspect are kept until a valid resize
 * arrives. (Applying such a size would set the aspect to NaN, degenerate
 * the projection matrix, and GPU-clip every draw call to the clear color.)
 * @param {THREE.WebGLRenderer} renderer Renderer to size.
 * @param {THREE.PerspectiveCamera} [camera=null] Camera to re-aspect.
 * @param {number} width CSS width in pixels (must be finite and > 0).
 * @param {number} height CSS height in pixels (must be finite and > 0).
 * @returns {void}
 */
export function resizeRenderer(renderer, camera = null, width, height) {
  if (!isUsableSize(width) || !isUsableSize(height)) return;
  renderer.setSize(width, height);
  if (camera && camera.isPerspectiveCamera) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

/**
 * Handle for the created engine renderer facade.
 *
 * @typedef {object} EngineRenderer
 * @property {THREE.WebGLRenderer} renderer The underlying three renderer
 *   (the loop and scenes call `renderer.render(scene, camera)` directly).
 * @property {(tierName: string, scene?: THREE.Scene | null) => string} setQualityTier
 *   Apply a tier immediately; returns the validated tier name.
 * @property {() => string} getQualityTier Current tier name ('low' |
 *   'medium' | 'high') — scenes read this to adapt shadow wiring.
 * @property {() => number} getResolutionScale Current pixel ratio (the
 *   "resolution scale" shown in the debug overlay).
 * @property {() => number} getDevicePixelRatio The device pixel ratio the
 *   tier caps are applied to.
 * @property {(scene: THREE.Scene, camera?: THREE.PerspectiveCamera | null) => object} applyTierFog
 *   Copy the current tier's fog/camera-far into a scene (returns the tier).
 * @property {(camera?: THREE.PerspectiveCamera | null, target?: EventTarget | null) => () => void} attachResize
 *   Listen for window resizes and keep renderer + camera matched; returns
 *   an unsubscribe function.
 * @property {() => void} dispose Remove listeners and the canvas. Safe to
 *   call more than once.
 */

/**
 * Create and configure the app's WebGL renderer plus the quality-tier API.
 * Appends the canvas to `host` when one is given (the #app element).
 *
 * @param {object} [options] Configuration.
 * @param {HTMLElement | null} [options.host=null] Element the canvas is
 *   appended to (the #app host in the app; null in node harnesses).
 * @param {HTMLCanvasElement} [options.canvas] Canvas for three to use.
 *   Defaults to a freshly created one; node harnesses pass a stub object.
 * @param {WebGL2RenderingContext} [options.context] Pre-built GL context —
 *   node harnesses inject a fake here so the real THREE.WebGLRenderer can
 *   be constructed without a browser.
 * @param {boolean} [options.antialias=true] MSAA request (three may ignore
 *   it depending on platform; cheap way to keep edges clean).
 * @param {number} [options.width] Initial CSS width (default window width;
 *   degenerate values fall through to the window size, else 1280).
 * @param {number} [options.height] Initial CSS height (default window height;
 *   degenerate values fall through to the window size, else 720).
 * @param {number} [options.devicePixelRatio] Device pixel ratio the tier
 *   caps clamp (default window.devicePixelRatio, else 1). Injectable for
 *   deterministic harness runs.
 * @param {string} [options.tier=DEFAULT_TIER] Initial quality tier.
 * @returns {EngineRenderer} The renderer facade.
 * @throws {TypeError} If the requested initial tier is unknown.
 */
export function createEngineRenderer({
  host = null,
  canvas,
  context,
  antialias = true,
  width,
  height,
  devicePixelRatio,
  tier = DEFAULT_TIER,
} = {}) {
  resolveTierName(tier); // validate before creating any GL resource

  const dpr =
    devicePixelRatio ??
    (typeof window !== 'undefined' && Number(window.devicePixelRatio) > 0
      ? Number(window.devicePixelRatio)
      : 1);
  // Initial CSS size: explicit option, then the window size, then 1280x720.
  // Degenerate values (0 / non-finite, e.g. a collapsed embed pane at boot)
  // are skipped the same way {@link resizeRenderer} skips them, so the
  // drawing buffer never ends up zero- or NaN-sized.
  const w = isUsableSize(width)
    ? width
    : typeof window !== 'undefined' && isUsableSize(window.innerWidth)
      ? window.innerWidth
      : 1280;
  const h = isUsableSize(height)
    ? height
    : typeof window !== 'undefined' && isUsableSize(window.innerHeight)
      ? window.innerHeight
      : 720;

  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias });
  renderer.setSize(w, h);
  if (host) host.appendChild(renderer.domElement);

  let currentTier = tier;
  applyQualityTier(renderer, currentTier, { devicePixelRatio: dpr });

  let detachResize = null;
  let disposed = false;

  return {
    renderer,

    /**
     * Apply a quality tier immediately (pixel ratio + shadowMap; see
     * {@link applyQualityTier}). Pass the scene so a shadow-flag flip
     * recompiles its materials live.
     * @param {string} name 'low' | 'medium' | 'high'.
     * @param {THREE.Scene | null} [scene=null] Scene to refresh on a
     *   shadow-flag flip.
     * @returns {string} The applied tier name.
     */
    setQualityTier(name, scene = null) {
      currentTier = resolveTierName(name);
      applyQualityTier(renderer, currentTier, { scene, devicePixelRatio: dpr });
      return currentTier;
    },

    /** @returns {string} Current tier name. */
    getQualityTier() {
      return currentTier;
    },

    /** @returns {number} Current pixel ratio (resolution scale). */
    getResolutionScale() {
      return renderer.getPixelRatio();
    },

    /** @returns {number} Device pixel ratio the tier caps clamp. */
    getDevicePixelRatio() {
      return dpr;
    },

    /**
     * Apply the current tier's fog/draw distance to a scene + camera.
     * @param {THREE.Scene} scn Scene to adjust.
     * @param {THREE.PerspectiveCamera} [cam=null] Camera to re-far.
     * @returns {object} The applied tier definition.
     */
    applyTierFog(scn, cam = null) {
      return applyTierFog(scn, cam, currentTier);
    },

    /**
     * Resize now (CSS pixel dimensions) and keep the camera aspect in sync.
     * Degenerate dimensions (0 / non-finite, e.g. a collapsed embed pane)
     * are ignored — the last-known-good size and aspect survive; see
     * {@link resizeRenderer}.
     * @param {number} cssWidth CSS width in pixels.
     * @param {number} cssHeight CSS height in pixels.
     * @param {THREE.PerspectiveCamera} [cam=null] Camera to re-aspect.
     * @returns {void}
     */
    resize(cssWidth, cssHeight, cam = null) {
      resizeRenderer(renderer, cam, cssWidth, cssHeight);
    },

    /**
     * Keep renderer + camera matched to the window size on every resize.
     * @param {THREE.PerspectiveCamera} cam Camera to re-aspect.
     * @param {EventTarget | null} [evtTarget] Resize event source
     *   (default window; pass null to skip wiring, e.g. in node).
     * @returns {() => void} Unsubscribe function.
     */
    attachResize(cam, evtTarget) {
      const target =
        evtTarget !== undefined
          ? evtTarget
          : typeof window !== 'undefined'
            ? window
            : null;
      if (!target) return () => {};
      const onResize = () => {
        resizeRenderer(renderer, cam, target.innerWidth, target.innerHeight);
      };
      target.addEventListener('resize', onResize);
      if (detachResize) detachResize();
      detachResize = () => {
        target.removeEventListener('resize', onResize);
        detachResize = null;
      };
      return detachResize;
    },

    /** Remove the resize listener and the canvas. Idempotent. */
    dispose() {
      if (disposed) return;
      disposed = true;
      if (detachResize) detachResize();
      renderer.dispose();
      if (renderer.domElement && typeof renderer.domElement.remove === 'function') {
        renderer.domElement.remove();
      }
    },
  };
}
