// src/render3d/PostFX.ts — composer chain: RenderPass → UnrealBloom → grade →
// OutputPass (ACES tone mapping + sRGB conversion, read from the renderer that
// GameView configured, so tone mapping happens after bloom as required).
//
// Bloom gate, tuned from the authored emitters actually present:
//   lava      emissiveIntensity 2.0 x ~1.6 shader pulse (materials.ts:93,113)
//   crystal   1.6, pulsing 1.05..2.23 (materials.ts:173, updateMaterialTime)
//   gems      emissive 0.9 amber + key light on top (EntitiesView.ts:34)
//   flames    additive basic-material cones stacking > 1 where they overlap
// World PBR surfaces peak ≈ 0.5-0.6 linear under the 1.35 key light, so a
// 0.85 threshold with restrained strength blooms only authored emission.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

const BLOOM_STRENGTH = 0.5;
const BLOOM_RADIUS = 0.35;
const BLOOM_THRESHOLD = 0.85;

// Final grade shader — runs in linear HDR before OutputPass tone mapping.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0.045 },
    uVignette: { value: 0.42 },
    uAberr: { value: 0.0015 },
    uExposure: { value: 1.0 },
    uContrast: { value: 1.045 },
    uSat: { value: 1.05 },
    uWarm: { value: 0 }, // menu blend: warm/hazy dream grade
    uPulse: { value: 0 }, // hit: contrast + red punch + aberration spike
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
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberr;
    uniform float uExposure;
    uniform float uContrast;
    uniform float uSat;
    uniform float uWarm;
    uniform float uPulse;
    varying vec2 vUv;

    float hash( vec2 p ) {
      return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot( c, c );

      // chromatic aberration: radial channel split, stronger at the edges
      vec2 off = c * uAberr * ( 0.5 + 3.0 * r2 ) * ( 1.0 + 3.0 * uPulse );
      vec3 col;
      col.r = texture2D( tDiffuse, vUv + off ).r;
      col.g = texture2D( tDiffuse, vUv ).g;
      col.b = texture2D( tDiffuse, vUv - off ).b;

      // exposure + contrast around linear mid grey
      col *= uExposure;
      col = ( col - 0.18 ) * ( uContrast + 0.35 * uPulse ) + 0.18;
      float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( vec3( lum ), col, uSat );

      // menu grade: hazy, slightly desaturated, warmed
      vec3 hazy = mix( col, vec3( lum ), 0.28 ) + vec3( 0.035, 0.02, 0.05 );
      col = mix( col, hazy * vec3( 1.07, 0.99, 0.9 ), uWarm );

      // hit pulse: red punch weighted toward the edges
      col += vec3( 0.12, -0.025, -0.03 ) * uPulse * ( 0.3 + 0.7 * min( 1.0, r2 * 3.0 ) );

      // vignette
      col *= 1.0 - uVignette * smoothstep( 0.15, 0.62, r2 );

      // animated film grain, stronger in the shadows
      float g = hash( vUv * vec2( 1287.0, 711.0 )
        + vec2( mod( uTime * 83.0, 97.0 ), mod( uTime * 59.0, 71.0 ) ) ) - 0.5;
      col += g * uGrain * ( 1.0 - 0.6 * lum );

      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};

// Typed handles over the cloned uniforms (ShaderPass uniforms are index-typed).
interface GradeUniforms {
  tDiffuse: { value: THREE.Texture | null };
  uTime: { value: number };
  uGrain: { value: number };
  uVignette: { value: number };
  uAberr: { value: number };
  uExposure: { value: number };
  uContrast: { value: number };
  uSat: { value: number };
  uWarm: { value: number };
  uPulse: { value: number };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class PostFX {
  readonly composer: EffectComposer;

  private renderer: THREE.WebGLRenderer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private output: OutputPass;
  private gu: GradeUniforms;
  private time = 0;
  private menuTarget = 0;
  private menuBlend = 0;
  private pulse = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
    this.gu = this.grade.uniforms as unknown as GradeUniforms;
  }

  /** Warmer, hazier dream grade on the title-screen diorama (eased in update). */
  setMenuGrade(on: boolean): void {
    this.menuTarget = on ? 1 : 0;
  }

  /** Red punch + contrast + aberration spike on death (1) or glancing hits (<1). */
  hitPulse(intensity = 1): void {
    this.pulse = Math.max(this.pulse, Math.min(Math.max(intensity, 0), 1));
  }

  update(dt: number): void {
    const d = Math.min(Math.max(dt, 0), 0.1);
    this.time += d;
    this.menuBlend += (this.menuTarget - this.menuBlend) * (1 - Math.exp(-d * 3));
    if (this.menuBlend < 0.0005 && this.menuTarget === 0) this.menuBlend = 0;
    this.pulse *= Math.exp(-d * 4.5);
    if (this.pulse < 0.001) this.pulse = 0;

    const m = this.menuBlend;
    const gu = this.gu;
    gu.uTime.value = this.time;
    gu.uWarm.value = m;
    gu.uPulse.value = this.pulse;
    gu.uContrast.value = lerp(1.045, 0.92, m);
    gu.uSat.value = lerp(1.05, 0.9, m);
    gu.uExposure.value = lerp(1.0, 1.04, m);
    gu.uVignette.value = lerp(0.42, 0.55, m);
    gu.uAberr.value = lerp(0.0015, 0.0022, m);
  }

  resize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.renderPass.dispose();
    this.bloom.dispose();
    this.grade.dispose();
    this.output.dispose();
    this.composer.dispose();
  }
}
