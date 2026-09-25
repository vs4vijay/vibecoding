import * as THREE from 'three';

import { createTrackFrame, type TrackCurve } from '../track/TrackCurve';

/**
 * Pooled burst particles on a single THREE.Points draw call — asteroid
 * breakup, smart-bomb shatter, pickup sparkle. The pool is one fixed-size
 * buffer allocated at construction: bursts claim dead slots, `update`
 * compacts the live particles to the front of the buffer each frame and
 * fades them by darkening their vertex color (additive blending, so black =
 * invisible). Nothing allocates in steady state.
 */

export interface BurstOptions {
  /** Particle count (claiming fewer when the pool is exhausted). */
  count?: number;
  /** Base color; faded by darkening as the particle dies. */
  color?: THREE.ColorRepresentation;
  /** Initial speed spread in world units per second. Defaults to 7. */
  speed?: number;
  /** Lifetime in seconds. Defaults to 0.7. */
  life?: number;
  /** Extra upward bias in world units per second. Defaults to 2. */
  upBias?: number;
  /** Height above the road surface to spawn at. Defaults to 1.0. */
  hover?: number;
}

export interface ParticleSystemOptions {
  /** Hard particle budget. Defaults to 320. */
  max?: number;
  /** Point size in world units. Defaults to 0.4. */
  size?: number;
}

const MAX_PER_BURST = 48;

export class ParticleSystem {
  /** Scene root; add to the scene once. */
  public readonly points: THREE.Points;

  private readonly max: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly velocities: Float32Array;
  private readonly lives: Float32Array;
  private readonly maxLives: Float32Array;
  private readonly baseColors: Float32Array;
  private cursor = 0;
  private aliveCount = 0;

  // Scratch — burst() runs per event, update() per frame; neither allocates.
  private readonly frame = createTrackFrame();
  private readonly color = new THREE.Color();

  public constructor(options: ParticleSystemOptions = {}) {
    this.max = options.max ?? 320;
    const size = options.size ?? 0.4;
    if (!Number.isInteger(this.max) || this.max < 1) {
      throw new RangeError(`ParticleSystem max must be a positive integer, got ${String(this.max)}`);
    }

    this.positions = new Float32Array(this.max * 3);
    this.colors = new Float32Array(this.max * 3);
    this.velocities = new Float32Array(this.max * 3);
    this.lives = new Float32Array(this.max);
    this.maxLives = new Float32Array(this.max);
    this.baseColors = new Float32Array(this.max * 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geometry.setDrawRange(0, 0);

    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.name = 'particles';
    this.points.frustumCulled = false; // the buffer is a pool, not a shape
  }

  /** Live particle count (tests / budget assertions). */
  public get activeCount(): number {
    return this.aliveCount;
  }

  /**
   * Spawns a radial burst at track position (s, x) — rock debris outward
   * with an upward bias, colors fading from `color` to black over `life`.
   */
  public burst(track: TrackCurve, s: number, x: number, options: BurstOptions = {}): void {
    const count = Math.min(options.count ?? 12, MAX_PER_BURST);
    const speed = options.speed ?? 7;
    const life = options.life ?? 0.7;
    const upBias = options.upBias ?? 2;
    const hover = options.hover ?? 1.0;
    this.color.set(options.color ?? 0xffffff);

    track.sToWorld(s, x, this.frame);
    const cx = this.frame.position.x;
    const cy = this.frame.position.y + hover;
    const cz = this.frame.position.z;

    for (let i = 0; i < count; i += 1) {
      const index = this.claimSlot();
      const j = index * 3;

      // Random direction on the sphere, biased up and slightly along the road.
      const theta = Math.random() * Math.PI * 2;
      const elevation = Math.random() * 2 - 1;
      const horizontal = Math.sqrt(Math.max(0, 1 - elevation * elevation));
      const speedScale = speed * (0.35 + Math.random() * 0.65);

      this.positions[j] = cx + (Math.random() - 0.5) * 0.8;
      this.positions[j + 1] = cy + (Math.random() - 0.5) * 0.8;
      this.positions[j + 2] = cz + (Math.random() - 0.5) * 0.8;
      this.velocities[j] = Math.cos(theta) * horizontal * speedScale;
      this.velocities[j + 1] = Math.max(0, elevation) * speedScale * 0.7 + upBias;
      this.velocities[j + 2] = Math.sin(theta) * horizontal * speedScale;

      this.baseColors[j] = this.color.r;
      this.baseColors[j + 1] = this.color.g;
      this.baseColors[j + 2] = this.color.b;

      this.maxLives[index] = life * (0.75 + Math.random() * 0.5);
      this.lives[index] = this.maxLives[index];
    }
  }

  /** Integrates the live particles, fades them, compacts the draw buffer. */
  public update(dt: number): void {
    let writeIndex = 0;
    for (let index = 0; index < this.max; index += 1) {
      if (this.lives[index] <= 0) continue;
      this.lives[index] -= dt;
      if (this.lives[index] <= 0) continue;

      const j = index * 3;
      this.positions[j] += this.velocities[j] * dt;
      this.positions[j + 1] += this.velocities[j + 1] * dt;
      this.positions[j + 2] += this.velocities[j + 2] * dt;
      // Light drag so debris decelerates instead of coasting forever.
      const drag = Math.max(0, 1 - 2.4 * dt);
      this.velocities[j] *= drag;
      this.velocities[j + 1] = this.velocities[j + 1] * drag - 4.5 * dt; // slight gravity
      this.velocities[j + 2] *= drag;

      // Fade = darken (additive blending makes black invisible).
      const fade = Math.max(0, this.lives[index] / this.maxLives[index]);
      const glow = fade * fade;
      const w = writeIndex * 3;
      this.positions[w] = this.positions[j];
      this.positions[w + 1] = this.positions[j + 1];
      this.positions[w + 2] = this.positions[j + 2];
      this.colors[w] = this.baseColors[j] * glow;
      this.colors[w + 1] = this.baseColors[j + 1] * glow;
      this.colors[w + 2] = this.baseColors[j + 2] * glow;
      writeIndex += 1;
    }

    this.aliveCount = writeIndex;
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, writeIndex);
    if (writeIndex > 0) {
      (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** Kills every particle (retry / level swap). */
  public clear(): void {
    this.lives.fill(0);
    this.aliveCount = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  /** Next free slot (round-robin; oldest particles recycle first). */
  private claimSlot(): number {
    for (let attempt = 0; attempt < this.max; attempt += 1) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      if (this.lives[index] <= 0) return index;
    }
    // Pool exhausted: overwrite whichever slot the cursor landed on.
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    return index;
  }
}
