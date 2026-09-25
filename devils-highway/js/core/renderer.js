/**
 * @file core/renderer.js — WebGLRenderer, post pipeline, PerfMonitor.
 * Pass order (bible; SwiftShader-proven — do NOT reorder):
 *   RenderPass -> UnrealBloom -> [SMAA if pixelRatio<1.5] -> OutputPass -> Grade.
 * Grade runs LAST, display-referred (r172 skips renderer.toneMapping on RT
 * renders; OutputPass does it). Composer target is deliberately UnsignedByte:
 * HalfFloat targets silently break SwiftShader shadow depth (sibling A/B).
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { CONFIG, QUALITY_ORDER } from "./config.js";

/** Dusk/night shadow-tint split (round 4: dusk pushed ~8% further toward
 * teal; night keeps its scored two-tone exactly). Resolved at PostPipeline
 * construction — module evaluation happens before boot() runs initQaHooks,
 * so the QA time-of-day is only guaranteed to exist by then. */
function activeShadowTint() {
  const tints = CONFIG.GRADE.shadowTint;
  const qa = typeof window !== "undefined" ? window.__QA : null;
  const tod = (qa && qa.params && qa.params.timeOfDay) || "dusk";
  return tints[tod] || tints.dusk;
}

/** Filmic S-curve, teal-shadow/warm-highlight split-tone, vignette, edge-only
 * CA, subtle grain (runs after OutputPass in display-referred space). */
const GradeShader = {
  name: "GradeShader",
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: CONFIG.GRADE.contrast },
    uSaturation: { value: CONFIG.GRADE.saturation },
    uShadowTint: { value: new THREE.Vector3(...CONFIG.GRADE.shadowTint.dusk) },
    uHighlightTint: { value: new THREE.Vector3(...CONFIG.GRADE.highlightTint) },
    uVignette: { value: CONFIG.GRADE.vignette },
    uAberration: { value: CONFIG.GRADE.aberration },
    uGrain: { value: CONFIG.GRADE.grain },
    uBlackPoint: { value: CONFIG.GRADE.blackPoint },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uContrast, uSaturation, uVignette, uAberration, uGrain, uTime;
    uniform vec3 uShadowTint, uHighlightTint;
    varying vec2 vUv;
    float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
    void main() {
      vec2 fc = vUv - 0.5;
      float d2 = dot( fc, fc );
      // Edge-only chromatic aberration (offset ~ r^2).
      vec2 ca = fc * d2 * uAberration;
      vec3 c;
      c.r = texture2D( tDiffuse, vUv - ca ).r;
      c.g = texture2D( tDiffuse, vUv ).g;
      c.b = texture2D( tDiffuse, vUv + ca ).b;
      vec3 s = c * c * ( 3.0 - 2.0 * clamp( c, 0.0, 1.0 ) );
      c = mix( c, s, uContrast );
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      c *= mix( uShadowTint, uHighlightTint, smoothstep( 0.2, 0.7, l ) );
      c = mix( vec3( l ), c, uSaturation );
      // Vignette: eased rolloff — the ( 1.0 - d2 * 0.5 ) factor decays the
      // darkening RATE toward the corner, so at uVignette 0.24 the very
      // corner keeps ~91% (was a flat 82.5% cut at 0.35 that stepped dark
      // regions to black; night menu floor stays >= 8% luminance).
      c *= 1.0 - d2 * uVignette * ( 1.0 - d2 * 0.5 );
      // Fine grain, weighted so blacks stay clean.
      float g = hash( vUv * vec2( 1613.0, 907.0 ) + fract( uTime ) * 71.7 ) - 0.5;
      c += g * uGrain * ( 1.0 - smoothstep( 0.0, 0.35, l ) );
      gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
    }
  `,
};

export function createRenderer(canvas, preset) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // composer path uses MSAA targets
    powerPreference: "high-performance",
    // Headless QA screenshots race the compositor otherwise (blank grabs).
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.EXPOSURE;
  renderer.shadowMap.enabled = preset.shadowsEnabled;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false; // composer passes would reset per pass
  return renderer;
}

/**
 * True when the context runs on a software rasterizer (SwiftShader/llvmpipe
 * headless captures). Callers cap the default tier there: software pipelines
 * stall for seconds per shader program, so every avoided program/variant
 * counts (SMAA, AO, extra lights).
 */
export function detectSoftwareGL(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = String(
      (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "",
    );
    return /swiftshader|llvmpipe|softpipe|software/i.test(raw);
  } catch {
    return false;
  }
}

export class PostPipeline {
  constructor(renderer, scene, camera, preset) {
    const pixelRatio = renderer.getPixelRatio();
    const size = renderer.getSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x * pixelRatio));
    const h = Math.max(1, Math.floor(size.y * pixelRatio));
    this.bloomEnabled = preset.post && preset.bloom;
    this.smaaEnabled = preset.post && preset.smaa && pixelRatio < 1.5;
    this.gradeEnabled = preset.post && preset.grade;
    const target = new THREE.WebGLRenderTarget(w, h, { samples: preset.post ? preset.msaa : 0 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    if (this.bloomEnabled) {
      const B = CONFIG.BLOOM;
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), B.strength, B.radius, B.threshold));
    }
    if (this.smaaEnabled) this.composer.addPass(new SMAAPass(w, h));
    this.composer.addPass(new OutputPass());
    if (this.gradeEnabled) {
      this.gradePass = new ShaderPass(GradeShader);
      // ShaderPass clones the template uniforms at construction, which is
      // the first point the __QA time-of-day is guaranteed to exist.
      this.gradePass.uniforms.uShadowTint.value.set(...activeShadowTint());
      this.composer.addPass(this.gradePass);
    }
    // Custom RT is device pixels; one setSize aligns all passes + targets.
    this.composer.setSize(size.x, size.y);
  }

  render() {
    this.composer.render();
  }

  get gradeUniforms() {
    return this.gradePass ? this.gradePass.uniforms : null;
  }

  dispose() {
    this.composer.dispose();
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
  }
}

/**
 * Rolling FPS monitor publishing window.__PERF = { fps, tier, drawCalls,
 * tris } as a PLAIN object at ~2 Hz (QA contract). autoDown disabled during
 * QA captures so shots never change tier mid-run.
 */
export class PerfMonitor {
  constructor({ tier, onTierDown, autoDown = true, minFps = 30, windowMs = 2000 }) {
    this.tier = tier;
    this.onTierDown = onTierDown || (() => {});
    this.autoDown = autoDown;
    this.minFps = minFps;
    this.windowMs = windowMs;
    this.fps = 60;
    this._count = 0;
    this._sum = 0;
    this._last = performance.now();
    this._pub = 0;
    this._calls = 0;
    this._tris = 0;
    window.__PERF = { fps: 60, tier, drawCalls: 0, tris: 0 };
  }

  stats(drawCalls, tris) {
    this._calls = drawCalls;
    this._tris = tris;
  }

  frame(now) {
    const dt = now - (this._prev ?? now);
    this._prev = now;
    if (dt <= 0 || dt > 1000) return; // tab-switch spikes
    this._count++;
    this._sum += dt;
    if (now - this._last >= this.windowMs) {
      this.fps = this._count / (this._sum / 1000);
      this._last = now;
      this._count = 0;
      this._sum = 0;
      if (this.autoDown && this.fps < this.minFps && QUALITY_ORDER.indexOf(this.tier) > 0) {
        this.onTierDown(this.tier);
      }
    }
    if (now - this._pub >= 500) {
      window.__PERF.fps = Math.round(this.fps * 10) / 10;
      window.__PERF.tier = this.tier;
      window.__PERF.drawCalls = this._calls;
      window.__PERF.tris = this._tris;
      this._pub = now;
    }
  }

  setTier(tier) {
    this.tier = tier;
    window.__PERF.tier = tier;
  }
}
