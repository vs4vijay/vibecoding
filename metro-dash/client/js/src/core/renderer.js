/**
 * @file core/renderer.js
 * WebGLRenderer factory, HDR post pipeline (bloom + final grade) and a
 * rolling PerfMonitor with automatic quality step-down.
 *
 * r172 notes: lights are always physically correct (useLegacyLights was
 * removed); sun intensity is given in candela-like units (~3) accordingly.
 * Tone mapping is performed by OutputPass inside the composer, so the final
 * grade pass runs after OutputPass in display-referred space.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";

/** Screen-space speed streaks: faint radial dashes at the frame edges,
 *  strength driven by run speed (0 = off). Pure post — reads in stills. */
const SpeedLinesShader = {
  name: "SpeedLinesShader",
  uniforms: {
    tDiffuse: { value: null },
    uStrength: { value: 0 },
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
    uniform float uStrength;
    uniform float uTime;
    varying vec2 vUv;

    float hash( float n ) { return fract( sin( n ) * 43758.5453 ); }

    void main() {
      vec4 c = texture2D( tDiffuse, vUv );
      if ( uStrength > 0.001 ) {
        vec2 fromCenter = vUv - vec2( 0.5, 0.52 );
        float r = length( fromCenter * vec2( 1.78, 1.0 ) ); // aspect-corrected
        float edge = smoothstep( 0.40, 0.9, r ); // outer band only
        float ang = atan( fromCenter.y, fromCenter.x );
        // Additive pale dashes: a few angular sectors light up with radial
        // striations — reads as motion streaks even in a still frame (the
        // old smear-only version was invisible on smooth walls).
        float gate = hash( floor( ( ang * 18.0 ) + floor( uTime * 1.5 ) * 7.1 ) );
        float dash = step( 0.68, gate );
        float radialMod = 0.55 + 0.45 * sin( r * 55.0 + gate * 61.0 );
        float flicker = 0.7 + 0.3 * hash( floor( uTime * 8.0 ) + gate * 13.0 );
        c.rgb += vec3( 0.82, 0.88, 1.0 ) * ( dash * flicker * edge * radialMod * uStrength * 0.16 );
      }
      gl_FragColor = c;
    }
  `,
};

/** Subtle AAA grade: filmic S-curve, split-tone, saturation, vignette, CA. */
const GradeShader = {
  name: "GradeShader",
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 0.4 }, // blend of smoothstep S-curve (dense shadows)
    uSaturation: { value: 1.15 },
    uShadowTint: { value: new THREE.Vector3(0.995, 1.0, 1.015) }, // near-neutral shadows (blue tint reads as "programmer art")
    uHighlightTint: { value: new THREE.Vector3(1.05, 1.0, 0.93) }, // warm highs
    uVignette: { value: 0.5 },
    uAberration: { value: 0.007 }, // UV offset at extreme corners
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
    uniform float uContrast;
    uniform float uSaturation;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform float uVignette;
    uniform float uAberration;
    varying vec2 vUv;

    void main() {
      vec2 fromCenter = vUv - 0.5;
      float d2 = dot( fromCenter, fromCenter );

      // Chromatic aberration: zero at center, grows with radius^2.
      vec2 caOffset = fromCenter * d2 * uAberration;
      vec3 c;
      c.r = texture2D( tDiffuse, vUv - caOffset ).r;
      c.g = texture2D( tDiffuse, vUv ).g;
      c.b = texture2D( tDiffuse, vUv + caOffset ).b;

      // Filmic contrast S-curve (display-referred input).
      vec3 s = c * c * ( 3.0 - 2.0 * clamp( c, 0.0, 1.0 ) );
      c = mix( c, s, uContrast );

      // Split-tone: highlights warm, shadows cool. Restrained multipliers.
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      c *= mix( uShadowTint, uHighlightTint, smoothstep( 0.2, 0.7, l ) );

      // Saturation.
      c = mix( vec3( l ), c, uSaturation );

      // Vignette.
      c *= 1.0 - d2 * uVignette;

      gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
    }
  `,
};

/**
 * Create the WebGL renderer with AAA defaults.
 * @param {HTMLCanvasElement} canvas
 * @param {object} preset Quality preset (see core/config.js).
 * @returns {THREE.WebGLRenderer}
 */
export function createRenderer(canvas, preset) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true, // affects the non-composer path; composer uses MSAA targets
    powerPreference: "high-performance",
    // Keep the drawing buffer presentable after rAF returns: headless QA
    // screenshots are otherwise a race against the compositor (blank grabs).
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95; // bright stylized key
  renderer.shadowMap.enabled = preset.shadowsEnabled;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Manual info accounting: the composer's internal passes would otherwise
  // reset the counter per pass, hiding the real draw-call total.
  renderer.info.autoReset = false;
  // Lights are physically based in r172 (useLegacyLights removed upstream).
  return renderer;
}

/**
 * Post pipeline wrapper. Pass composition by quality tier:
 *  - always: RenderPass, OutputPass (tonemap + sRGB), GradePass
 *  - bloom: UnrealBloomPass (threshold 0.85, strength 0.35, radius 0.6)
 *  - MSAA render target on high/ultra; SMAAPass when effective pixelRatio < 1.5
 */
export class PostPipeline {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} preset Quality preset.
   * @param {{bloom?: boolean}} [overrides] QA overrides (?nobloom=1).
   */
  constructor(renderer, scene, camera, preset, overrides = {}) {
    const pixelRatio = renderer.getPixelRatio();
    const size = renderer.getSize(new THREE.Vector2());
    const w = Math.floor(size.x * pixelRatio);
    const h = Math.floor(size.y * pixelRatio);

    this.bloomEnabled = preset.postEnabled && preset.bloom && !overrides.bloom;
    this.gradeEnabled = preset.postEnabled && preset.grade;

    const useMSAA = preset.postEnabled && preset.msaaSamples > 0;
    // NOTE: deliberately UnsignedByteType, NOT HalfFloatType. On SwiftShader
    // (the headless QA GPU) any HalfFloat composer target silently breaks the
    // shadow depth pass — verified by A/B pixel diff (see .qa/wave1-notes.md).
    // MSAA on the LDR target + SMAA gives equivalent quality here.
    const target = new THREE.WebGLRenderTarget(w, h, {
      samples: useMSAA ? preset.msaaSamples : 0,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    if (this.bloomEnabled) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        0.35, // strength — subtle by design
        0.6, // radius
        0.85, // threshold
      );
      this.composer.addPass(this.bloomPass);
    }

    this.speedPass = new ShaderPass(SpeedLinesShader);
    this.composer.addPass(this.speedPass);

    this.smaaEnabled = preset.postEnabled && preset.smaa && pixelRatio < 1.5;
    if (this.smaaEnabled) {
      this.smaaPass = new SMAAPass(size.x * pixelRatio, size.y * pixelRatio);
      this.composer.addPass(this.smaaPass);
    }

    // OutputPass tonemaps + encodes; grade operates display-referred after it.
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    if (this.gradeEnabled) {
      this.gradePass = new ShaderPass(GradeShader);
      this.composer.addPass(this.gradePass);
    }

    // Settle internal size bookkeeping: the custom RT is in device pixels
    // while composer tracks CSS pixels x pixelRatio. One setSize aligns
    // every pass and both render targets.
    this.composer.setSize(size.x, size.y);
  }

  /**
   * Speed-driven effect level (0..1): drives the screen-space speed streaks.
   * @param {number} strength
   */
  setSpeed(strength) {
    this.speedPass.uniforms.uStrength.value = Math.min(1, Math.max(0, strength));
  }

  /** Render one composited frame. */
  render() {
    this.composer.render();
  }

  /** Release GPU resources (quality-tier rebuilds). */
  dispose() {
    this.composer.dispose();
  }

  /**
   * Resize all buffers. Must be called after renderer.setSize.
   * @param {number} width CSS width
   * @param {number} height CSS height
   */
  setSize(width, height) {
    this.composer.setSize(width, height);
  }
}

/**
 * Rolling performance monitor with automatic quality step-down.
 * Exposes `window.__PERF` for QA: { fps, frameMs, tier, degradationCount }.
 */
export class PerfMonitor {
  /**
   * @param {object} opts
   * @param {string} opts.tier Initial quality tier.
   * @param {(tier: string) => void} opts.onTierDown Called with the new tier.
   * @param {number} [opts.minFps] Threshold (default 45).
   * @param {number} [opts.windowMs] Evaluation window (default 3000).
   */
  constructor({ tier, onTierDown, minFps = 45, windowMs = 3000 }) {
    this.tier = tier;
    this.onTierDown = onTierDown;
    this.minFps = minFps;
    this.windowMs = windowMs;
    this.frameCount = 0;
    this.frameTimeSum = 0;
    this.worstFrameMs = 0;
    this.degradationCount = 0;
    this._lastCheck = performance.now();
    this.fps = 60;
    this.frameMs = 16.7;

    const self = this;
    window.__PERF = {
      fps: () => self.fps,
      frameMs: () => self.frameMs,
      worstFrameMs: () => self.worstFrameMs,
      get tier() {
        return self.tier;
      },
      degradationCount: () => self.degradationCount,
      mark: (t) => self.frame(t),
    };
  }

  /**
   * Feed one frame timestamp.
   * @param {number} now performance.now() of the current frame.
   */
  frame(now) {
    const dt = now - (this._prev ?? now);
    this._prev = now;
    if (dt <= 0 || dt > 1000) return; // ignore tab-switch spikes
    this.frameCount++;
    this.frameTimeSum += dt;
    if (dt > this.worstFrameMs) this.worstFrameMs = dt;

    if (now - this._lastCheck >= this.windowMs) {
      this.frameMs = this.frameTimeSum / this.frameCount;
      this.fps = 1000 / this.frameMs;
      this._lastCheck = now;
      this.frameCount = 0;
      this.frameTimeSum = 0;
      this.worstFrameMs = 0;
      if (this.fps < this.minFps) this._stepDown();
    }
  }

  /** @private */
  _stepDown() {
    this.degradationCount++;
    this._lastCheck = performance.now(); // reset window before re-evaluating
    this.onTierDown(this.tier);
  }

  /** @param {string} tier */
  setTier(tier) {
    this.tier = tier;
  }
}
