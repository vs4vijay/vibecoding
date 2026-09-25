// PostFX (W1-FX) — cinematic post stack per ARCHITECTURE.md:
//   RenderPass → UnrealBloomPass (linear-HDR; only emissives cross threshold)
//   → OutputPass (ACES + sRGB) → FinalPass (vignette, film grain, chromatic
//   aberration, scanlines, teal/magenta grade, radial speed streaks).
//
// API (contract): init(renderer,scene,camera) · resize(w,h) · update(dt) →
// useComposer · render(). Extras: setSpeed(t 0..1), kick(impact 0..1).
// Quality tiers (core/Quality.js): ULTRA full stack · HIGH no radial blur ·
// MED half-res bloom, no grain · LOW direct render (composer bypassed).
// HalfFloat RTs are used when the context can render to them (verified in
// SwiftShader); otherwise the stack degrades to UnsignedByteType, no bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { bus } from '../core/EventBus.js';
import { quality } from '../core/Quality.js';

// Bloom tuned on 1600×900 PNGs (run/run30/death): the scene renders linear-HDR
// into the RT — rails/sun/coins sit at 1.5–2.5, city bodies under ~0.1 — so a
// high threshold isolates emissives while sky/city stay clean.
const BLOOM = { strength: 0.55, radius: 0.3, threshold: 0.85 };

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uCA: { value: 0.0022 },       // aberration strength (edge-scaled in shader)
    uGrain: { value: 0.016 },     // ± grain amplitude
    uVig: { value: 0.42 },        // vignette mix
    uScan: { value: 0.05 },       // scanline depth
    uSat: { value: 1.10 },        // saturation (≈ +10%)
    uSpeedLines: { value: 0.0 },  // radial streak intensity (0 = off)
    uPulse: { value: 0.0 },       // impact pulse (drives CA + vignette)
    uFlash: { value: 0.0 },       // white flash (crash)
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uCA, uGrain, uVig, uScan, uSat, uSpeedLines, uPulse, uFlash;
    uniform vec2 uRes;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float r2 = dot(dir, dir);

      // chromatic aberration — center-locked, edge-scaled, impact-boosted
      float ca = uCA * (0.3 + 2.4 * r2) * (1.0 + uPulse * 5.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ca).b;

      // radial speed streaks — 8 taps, screen edges only, scaled by speed
      if (uSpeedLines > 0.0015) {
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 1; i <= 8; i++) {
          float t = float(i) / 8.0;
          float w = 1.0 - t * 0.72;
          acc += texture2D(tDiffuse, uv - dir * (t * uSpeedLines * 0.13)).rgb * w;
          wsum += w;
        }
        col = mix(col, acc / wsum, smoothstep(0.14, 0.55, r2) * clamp(uSpeedLines * 1.7, 0.0, 1.0));
      }

      // grade: saturation + teal-shadow lift + magenta-highlight lift
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col += vec3(-0.010, 0.006, 0.018) * (1.0 - smoothstep(0.0, 0.5, l));
      col += vec3(0.020, -0.004, 0.016) * smoothstep(0.6, 1.0, l);

      // scanlines (CRT, very subtle — every 3rd pixel row)
      col *= 1.0 - uScan * (0.5 + 0.5 * sin(gl_FragCoord.y * 2.0944));

      // vignette — soft, darkens briefly on impacts
      float vig = smoothstep(1.18, 0.42, length(dir) * (1.0 + uPulse * 0.10));
      col *= mix(1.0, vig, uVig + uPulse * 0.25);

      // animated film grain
      col += (hash(uv * uRes + fract(uTime * 0.917) * 371.0) - 0.5) * uGrain;

      col += uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

class PostFXStack {
  constructor() {
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.composer = null;
    this.bloom = null;
    this.final = null;
    this.useComposer = true; // last update() verdict (returned for the contract)
    this.speedT = 0;
    this.pulse = 0;
    this.flash = 0;
    this.t = 0;
    this._w = 0;
    this._h = 0;
    this._flags = null;
    this.timeSrc = null;  // [W1-FX r2] Time surface (set via FX.watch → attachTime)
    this._lastGt = -1;
  }

  // [W1-FX r2] impact pulses must decay on GAME time: __NR.warp() advances
  // logic without rendering, so a phase-transition kick(0.55) decaying in
  // realtime would put a live CA/vignette/flash pulse into photo captures.
  attachTime(time) {
    this.timeSrc = time;
    this._lastGt = -1;
  }

  init(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this._baseFar = camera.far;
    this._baseFog = scene.fog ? scene.fog.density : null;
    const sz = new THREE.Vector2();
    renderer.getSize(sz);
    this._w = sz.x;
    this._h = sz.y;

    const gl = renderer.getContext();
    this.floatOK = !!(gl.getExtension('EXT_color_buffer_float') ||
                      gl.getExtension('EXT_color_buffer_half_float'));

    // EffectComposer renders many internal passes; with info.autoReset the
    // stats API would only ever report the final quad. Accumulate per frame
    // instead so __NR.stats() drawCalls stays honest (perf budget gate).
    renderer.info.autoReset = false;

    this._flags = quality.flags;
    quality.onFlags = (flags) => { this._flags = flags; this.rebuild(); }; // [W1-FX]
    this.rebuild();

    // impacts that must read on the post layer (FX owns particles separately)
    bus.on('death', () => this.kick(1.25));
    bus.on('phase:transition', () => this.kick(0.55));
    bus.on('box:open', () => this.kick(0.4));
    bus.on('run:start', () => { this.pulse = 0; this.flash = 0; });
  }

  // (re)build the composer for the current tier — called on init and tier drop.
  rebuild() {
    const flags = this._flags;
    this._applyDrawDistance(flags); // r2 (critic #6): drawDistance consumer (see below)
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    this.bloom = null;
    this.final = null;

    // LOW: no composer at all — direct render, zero extra cost.
    if (!flags.bloom && !flags.grain && !flags.ca) { this.useComposer = false; return; }

    const pr = this.renderer.getPixelRatio();
    let rt = undefined;
    if (!this.floatOK) {
      // weak context: byte RTs (grade-only chain, no HDR bloom)
      rt = new THREE.WebGLRenderTarget(this._w * pr, this._h * pr, { type: THREE.UnsignedByteType });
    }
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));

    if (flags.bloom && this.floatOK) {
      const s = flags.bloomRes;
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(this._w * pr * s, this._h * pr * s),
        BLOOM.strength, BLOOM.radius, BLOOM.threshold);
      composer.addPass(this.bloom);
    }

    composer.addPass(new OutputPass()); // ACES tone map + sRGB (renderToScreen skipped for RT)

    this.final = new ShaderPass(FinalShader);
    composer.addPass(this.final); // last pass → renders to screen

    this.composer = composer;
    this.useComposer = true;
    this.resize(this._w, this._h);
    this.applyFlagsToUniforms();

    // [FX R3, critic item 2] warm the new stack OUTSIDE the accounting window:
    // the first frame on a fresh composer compiles every program (and some GLs
    // issue one-time setup draws), which read as a draw-call spike right after
    // a tier switch. Render once here, then reset — render() resets info at the
    // top of every frame, so the next sampled frame is clean steady state.
    if (this.composer) {
      this.renderer.info.reset();
      try { this.composer.render(); } catch (e) { /* warm-up must never break */ }
      this.renderer.info.reset();
    }
  }

  // r2 (critic #6): quality.drawDistance had NO consumer anywhere — the MED
  // budget (≤90) is unreachable through composer params alone (scene ≈ 100-120
  // calls). Enforce the contract flag here on the renderer side: shorten the
  // camera frustum, deepen the fog to mask the cut, and rescale the sky dome
  // (its shader is pure view-direction, so scaling is visually a no-op).
  // Gated to budget tiers (drawDistance < 0.85 → MED/LOW); ULTRA/HIGH pixels
  // are byte-identical to before. Runs on every rebuild (tier change).
  _applyDrawDistance(flags) {
    if (!this.camera || !this.scene) return;
    const dd = flags && flags.drawDistance != null ? flags.drawDistance : 1;
    const fog = this.scene.fog;
    if (dd >= 0.85) {
      if (this.camera.far !== this._baseFar) {
        this.camera.far = this._baseFar;
        this.camera.updateProjectionMatrix();
      }
      if (this._sky) this._sky.scale.setScalar(1);
      if (fog && this._baseFog != null) fog.density = this._baseFog;
      return;
    }
    const far = 120 + 430 * dd; // MED 0.7 → 421 m — culls the back half of the 720 m chunk field
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
    if (!this._sky) {
      // the sky dome: unculled sphere with its own shader uniforms. geometry.type
      // (not isSphereGeometry — not exported by this three build)
      this.scene.traverse(o => {
        if (!this._sky && o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry' &&
            o.material && o.material.uniforms) this._sky = o;
      });
    }
    if (this._sky) this._sky.scale.setScalar(Math.max(0.2, (far - 60) / this._sky.geometry.parameters.radius));
    if (fog && this._baseFog != null) fog.density = this._baseFog * (1 + (0.85 - dd) * 1.5);
  }

  applyFlagsToUniforms() {
    if (!this.final) return;
    const u = this.final.uniforms, f = this._flags;
    u.uGrain.value = f.grain ? 0.016 : 0.0;
    u.uCA.value = f.ca ? 0.0022 : 0.0;
    u.uScan.value = f.scan ? 0.03 : 0.0;
  }

  // per-frame: decay pulses, advance grain clock, set radial streak amount.
  // Returns whether the composer should be used this frame.
  update(dt) {
    // [W1-FX r2] effective decay time = max(real dt, game-time delta): in live
    // play they are the same (hitstop/slow-mo keep pulses realtime, which is
    // correct for a screen-space effect); after a warp() the game-time delta
    // collapses pulses that belong to already-finished transitions, so photo
    // captures are deterministic. Frozen states (DEAD/PAUSE) fall back to dt.
    let dtFx = dt;
    if (this.timeSrc) {
      const gt = this.timeSrc.gameTime;
      if (this._lastGt >= 0) dtFx = Math.max(dt, Math.min(gt - this._lastGt, 30));
      this._lastGt = gt;
    }
    const decay = Math.exp(-dtFx * 5.5);
    this.pulse *= decay;
    this.flash *= Math.exp(-dtFx * 5.0);
    if (this.pulse < 0.001) this.pulse = 0;
    if (this.flash < 0.001) this.flash = 0;
    this.t += dt;

    if (this.final) {
      const u = this.final.uniforms;
      u.uTime.value = this.t;
      u.uPulse.value = this.pulse;
      u.uFlash.value = this.flash;
      // r2 (critic #5): radial onset 0.42 → 0.25 speedT (≈19 m/s at the 12-40
      // mapping) with a quickly-ramped small floor — the old onset needed
      // 36 m/s, so most runs never saw a single streak.
      // [FX R3, critic item 4] fever top-end: below ~35 m/s the ramp is
      // unchanged; above it the streaks climb harder (quadratic) so 38-40 m/s
      // reads as a distinct rush instead of capping at ≈0.34. Hard-camped at
      // 0.6 so the tap distance can never blow out.
      const on = Math.min(1, Math.max(0, (this.speedT - 0.25) / 0.75));
      const fever = Math.min(1, Math.max(0, (this.speedT - 0.821) / 0.179)); // 35→40 m/s
      const radial = this._flags && this._flags.radial
        ? Math.min(0.6, (on > 0 ? Math.min(1, on * 6) * (0.06 + 0.28 * on) : 0) * (1 + 0.7 * fever * fever) + this.pulse * 0.10)
        : 0;
      u.uSpeedLines.value = radial;
    }
    this.useComposer = !!this.composer;
    return this.useComposer;
  }

  render() {
    this.renderer.info.reset(); // manual accumulation across composer passes
    if (this.composer && this.useComposer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize(w, h) {
    this._w = w; this._h = h;
    if (!this.composer) return;
    this.composer.setSize(w, h);
    // composer.setSize scales the bloom mips to full size — re-apply tier res
    if (this.bloom && this._flags) {
      const pr = this.renderer.getPixelRatio();
      const s = this._flags.bloomRes || 1;
      this.bloom.setSize(w * pr * s, h * pr * s);
    }
    if (this.final) {
      const pr = this.renderer.getPixelRatio();
      this.final.uniforms.uRes.value.set(w * pr, h * pr);
    }
  }

  // speed normalised 0..1 (main.js maps ctx.speed 12..40 → 0..1)
  setSpeed(t) { this.speedT = Math.min(1, Math.max(0, t)); }

  // impact 0..1 — pulses chromatic aberration + vignette (crash ≈ 1.25).
  // r2 audit: flash cap 0.85 → 0.55 — ACES mapped ~0.7 flash on top of bloom
  // clipped a full-screen white pop at the crash frame.
  kick(impact) {
    const a = Math.min(1.5, Math.max(0, impact));
    this.pulse = Math.min(1.4, this.pulse + a);
    this.flash = Math.min(0.55, this.flash + a * (a > 0.9 ? 0.38 : 0.12));
  }
}

export const PostFX = new PostFXStack();
