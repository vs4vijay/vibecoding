import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { CONFIG } from "../config";

/**
 * Post-processing chain (design D1, task 1.4). Everything ships inside the
 * `three` package (deps allowlist holds):
 *
 *   RenderPass → UnrealBloomPass → grade ShaderPass → OutputPass
 *
 * The grade pass folds vignette + film grain + chromatic aberration into ONE
 * fullscreen shader so the three cheap effects never cost three passes. It
 * runs BEFORE OutputPass, i.e. in linear HDR — ACES then rolls the vignette
 * and grain off cinematically instead of clipping them.
 *
 * OutputPass reads `renderer.toneMapping` / `outputColorSpace` /
 * `toneMappingExposure` on the fly, so the composer path and the direct
 * `renderer.render` bypass path share one source of truth for the filmic
 * transform. (Scene renders into the composer's HalfFloat target skip
 * renderer-side tonemapping — three only tonemaps into the default
 * framebuffer — so nothing is ever applied twice.)
 *
 * Tunables live entirely in CONFIG.vfx.post (+ CONFIG.quality.postFx as the
 * master bypass, honored by the caller in main.ts). The per-frame path
 * (`render`) touches only uniforms — zero allocation.
 */

/** Combined vignette + film grain + chromatic aberration (task 1.4). */
const GradeShader = {
  name: "ZhGradePass",

  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: CONFIG.vfx.post.vignette.amount },
    uGrain: { value: CONFIG.vfx.post.grain.amount },
    uAberration: { value: CONFIG.vfx.post.chromaticAberration.amount },
    uTime: { value: 0 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uTime;
    varying vec2 vUv;

    // Classic sin-dot hash; gl_FragCoord keeps it resolution-independent.
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    void main() {
      vec2 fromCenter = vUv - 0.5;
      float r2 = dot(fromCenter, fromCenter);

      // Chromatic aberration: radial RGB parallax growing toward the corners
      // (r2 * 2 renormalizes r2, whose corner value is 0.5, to 1.0).
      vec2 caShift = fromCenter * (uAberration * r2 * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + caShift).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - caShift).b;

      // Vignette: multiplicative falloff reaching full configured strength at
      // the exact corners (length(fromCenter) * sqrt(2) maps corners to 1.0).
      float edge = length(fromCenter) * 1.41421356;
      col *= 1.0 - uVignette * smoothstep(0.35, 1.0, edge);

      // Film grain: temporally re-seeded per frame so the lattice shimmers.
      float t = fract(uTime);
      float g = hash(gl_FragCoord.xy + vec2(t * 913.0, t * 547.0)) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/** Handle returned by {@link createPostFx}; mirrors the renderer lifecycle calls. */
export type PostFx = {
  /** Render one frame through the composer (updates the grain clock). */
  render(): void;
  /** CSS-pixel size — mirrors `renderer.setSize` (pixel ratio applied internally). */
  setSize(width: number, height: number): void;
  /** Mirror `renderer.setPixelRatio` before the matching `setSize`. */
  setPixelRatio(ratio: number): void;
  /** Runtime toggle for the future quality controller (task 1.5). */
  setEnabled(enabled: boolean): void;
  readonly enabled: boolean;
  /** Frees composer buffers and pass GPU resources. */
  dispose(): void;
};

/**
 * Builds the composer chain for an already-sized renderer. Boot-path
 * allocation only; `render()` never allocates.
 */
export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostFx {
  const size = renderer.getSize(new THREE.Vector2());

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    CONFIG.vfx.post.bloom.strength,
    CONFIG.vfx.post.bloom.radius,
    CONFIG.vfx.post.bloom.threshold,
  );
  composer.addPass(bloom);

  // ShaderPass clones the uniforms, so each handle owns its uTime clock.
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  // OutputPass owns ACES tonemapping + sRGB conversion for the whole chain,
  // driven by the renderer settings (kept identical to the bypass path).
  const output = new OutputPass();
  composer.addPass(output);

  let enabled = true;

  return {
    render() {
      grade.uniforms.uTime.value = performance.now() / 1000;
      composer.render();
    },
    setSize(width, height) {
      composer.setSize(width, height);
    },
    setPixelRatio(ratio) {
      composer.setPixelRatio(ratio);
    },
    setEnabled(on) {
      enabled = on;
    },
    get enabled() {
      return enabled;
    },
    dispose() {
      composer.dispose();
      bloom.dispose();
      grade.dispose();
      output.dispose();
      renderPass.dispose();
    },
  };
}
