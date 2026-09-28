import * as THREE from "three";

/**
 * Pooled CPU particle bursts (chaff on pickup, dust on deposit, motes on the
 * win glint). Deterministic: every particle's velocity/life derives from a
 * hash of (burstIndex, particleIndex) — never from call-time randomness — and
 * a staged burst can be fast-forwarded a fixed age in 1/60 s steps so pinned
 * shots can freeze a burst mid-air exactly.
 */

export interface BurstOpts {
  count: number;
  colorA: number;
  colorB: number;
  /** Launch speed spread (u/s). */
  speed: [number, number];
  up: number;
  gravity: number;
  drag: number;
  life: [number, number];
  /** Point sprite diameter in world units. */
  size: [number, number];
  /** Optional constant velocity added to every particle (wind streaks). */
  velocity?: THREE.Vector3;
}

const CAP = 160;

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.05, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.12, length(d)) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const _c = new THREE.Color();
const _tmpColor = new THREE.Color();

export class Puffs {
  readonly points: THREE.Points;
  private groundAt: ((x: number, z: number) => number) | null = null;
  private readonly positions = new Float32Array(CAP * 3);
  private readonly velocities = new Float32Array(CAP * 3);
  private readonly colors = new Float32Array(CAP * 3);
  private readonly sizes = new Float32Array(CAP);
  private readonly alphas = new Float32Array(CAP);
  private readonly life = new Float32Array(CAP);
  private readonly maxLife = new Float32Array(CAP);
  private readonly grav = new Float32Array(CAP);
  private readonly drag = new Float32Array(CAP);
  private cursor = 0;
  private burstIndex = 0;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 700 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.alphas.fill(0);
  }

  /** Viewport-height-based attenuation constant (call on resize). */
  setScale(heightPx: number): void {
    this.mat.uniforms.uScale.value = heightPx * 1.1;
  }

  /** Surface sampler: particles settle onto the terrain instead of hovering. */
  setGround(fn: (x: number, z: number) => number): void {
    this.groundAt = fn;
  }

  /**
   * Spawns a burst at `pos`. `preAge` (seconds) fast-forwards the burst in
   * fixed 1/60 steps — used by staged shots to freeze a burst mid-air.
   */
  burst(pos: THREE.Vector3, opts: BurstOpts, preAge = 0): void {
    const b = this.burstIndex++;
    for (let i = 0; i < opts.count; i++) {
      const slot = this.cursor;
      this.cursor = (this.cursor + 1) % CAP;
      const i3 = slot * 3;
      const ha = hash2(b * 131 + i, 17);
      const hb = hash2(b * 131 + i, 91);
      const hc = hash2(b * 131 + i, 41);
      const hd = hash2(b * 131 + i, 63);
      const ang = ha * Math.PI * 2;
      const sp = opts.speed[0] + (opts.speed[1] - opts.speed[0]) * hb;
      this.positions[i3] = pos.x + (hc - 0.5) * 0.03;
      this.positions[i3 + 1] = pos.y + (hd - 0.5) * 0.03;
      this.positions[i3 + 2] = pos.z + (hash2(b * 131 + i, 87) - 0.5) * 0.03;
      this.velocities[i3] = Math.cos(ang) * sp;
      this.velocities[i3 + 1] = opts.up * (0.6 + 0.8 * hc) + (hb - 0.5) * sp * 0.4;
      this.velocities[i3 + 2] = Math.sin(ang) * sp;
      if (opts.velocity) {
        this.velocities[i3] += opts.velocity.x;
        this.velocities[i3 + 1] += opts.velocity.y;
        this.velocities[i3 + 2] += opts.velocity.z;
      }
      _c.set(opts.colorA).lerp(_tmpColor.set(opts.colorB), hd);
      this.colors[i3] = _c.r;
      this.colors[i3 + 1] = _c.g;
      this.colors[i3 + 2] = _c.b;
      this.sizes[slot] = opts.size[0] + (opts.size[1] - opts.size[0]) * ha;
      this.maxLife[slot] = opts.life[0] + (opts.life[1] - opts.life[0]) * hb;
      this.life[slot] = this.maxLife[slot];
      this.grav[slot] = opts.gravity;
      this.drag[slot] = opts.drag;
      this.alphas[slot] = 1;
    }
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    for (let t = 0; t < preAge; t += 1 / 60) this.step(1 / 60);
  }

  update(dt: number): void {
    this.step(dt);
  }

  private step(dt: number): void {
    let any = false;
    for (let i = 0; i < CAP; i++) {
      if (this.alphas[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      const i3 = i * 3;
      const dampF = Math.max(0, 1 - this.drag[i] * dt);
      this.velocities[i3] *= dampF;
      this.velocities[i3 + 1] = this.velocities[i3 + 1] * dampF - this.grav[i] * dt;
      this.velocities[i3 + 2] *= dampF;
      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;
      // Ground the particle: settle onto the surface, scrub horizontal speed —
      // no chaff hovering in mid-air where it reads as a rendering blob.
      if (this.groundAt) {
        const gy = this.groundAt(this.positions[i3], this.positions[i3 + 2]) + 0.012;
        if (this.positions[i3 + 1] < gy) {
          this.positions[i3 + 1] = gy;
          this.velocities[i3 + 1] = 0;
          this.velocities[i3] *= 0.82;
          this.velocities[i3 + 2] *= 0.82;
        }
      }
      const u = this.life[i] / this.maxLife[i];
      this.alphas[i] = Math.min(1, u * 1.6);
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
    }
  }
}
