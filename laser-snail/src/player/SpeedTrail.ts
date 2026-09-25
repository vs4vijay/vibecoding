import * as THREE from 'three';

/**
 * Turbo's speed trail — an additive ribbon of the road the snail just burned
 * over, alive only near cruise speed (it dies during a red-ring crawl, which
 * makes the slow-down read at a glance).
 *
 * Pooling discipline: every buffer (positions, colors, the anchor ring buffer)
 * is allocated once at construction. `update` writes a sample each time the
 * snail has moved `sampleDistance` world units and rebuilds the small vertex
 * buffer in place — zero steady-state allocation. Fading uses the same trick
 * as the particle pool: vertex colors darken to black along the tail, which
 * additive blending renders as invisible.
 */

export interface SpeedTrailOptions {
  /** History samples in the ribbon. Defaults to 26. */
  points?: number;
  /** Ribbon half-width at the freshest sample, world units. Defaults to 0.34. */
  width?: number;
  /** World units between history samples. Defaults to 0.6. */
  sampleDistance?: number;
  /** Trail color (overdriven tones feed the bloom pass). Defaults to cyan. */
  color?: THREE.ColorRepresentation;
  /** Height above the path the ribbon floats. Defaults to 0.42. */
  lift?: number;
}

interface TrailSample {
  readonly position: THREE.Vector3;
  readonly right: THREE.Vector3;
}

export class SpeedTrail {
  /** Scene object; add to the scene once. */
  public readonly mesh: THREE.Mesh;

  private readonly capacity: number;
  private readonly halfWidth: number;
  private readonly sampleDistance: number;
  private readonly lift: number;
  private readonly baseColor = new THREE.Color();

  // Ring buffer of past anchors; `cursor` is where the NEXT sample lands.
  private readonly samples: TrailSample[] = [];
  private cursor = 0;
  private filled = 0;
  private readonly lastSample = new THREE.Vector3();
  private hasLastSample = false;

  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly color = new THREE.Color();

  public constructor(options: SpeedTrailOptions = {}) {
    this.capacity = options.points ?? 26;
    this.halfWidth = options.width ?? 0.34;
    this.sampleDistance = options.sampleDistance ?? 0.6;
    this.lift = options.lift ?? 0.42;
    this.baseColor.set(options.color ?? 0x35d8ef);

    if (this.capacity < 2) throw new RangeError('SpeedTrail needs at least 2 history points');
    if (!(this.sampleDistance > 0)) throw new RangeError('SpeedTrail sampleDistance must be positive');

    const vertexCount = this.capacity * 2;
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);

    for (let i = 0; i < this.capacity; i += 1) {
      this.samples.push({ position: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0) });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geometry.setDrawRange(0, 0);

    // Index quads between consecutive samples: 2 triangles per segment.
    const indices: number[] = [];
    for (let i = 0; i < this.capacity - 1; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(indices);

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'speed-trail';
    this.mesh.frustumCulled = false; // the buffer is a pool, not a shape
    this.mesh.visible = false;
  }

  /**
   * Advances the ribbon: records a history sample when the snail has moved
   * far enough, then rebuilds the vertex buffer newest-first. `intensity`
   * 0..1 gates both the emission (samples are skipped at 0) and the glow.
   * Runs at render rate; allocates nothing.
   */
  public update(position: THREE.Vector3, quaternion: THREE.Quaternion, intensity: number): void {
    if (intensity <= 0) {
      this.mesh.visible = false;
      this.hasLastSample = false;
      this.filled = 0;
      this.mesh.geometry.setDrawRange(0, 0);
      return;
    }
    this.mesh.visible = true;

    if (!this.hasLastSample || position.distanceToSquared(this.lastSample) >= this.sampleDistance * this.sampleDistance) {
      this.writeSample(position, quaternion);
    }

    this.rebuild(intensity);
  }

  /** Drops the whole ribbon (retry, knock-off, level swap). */
  public clear(): void {
    this.cursor = 0;
    this.filled = 0;
    this.hasLastSample = false;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  private writeSample(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    const sample = this.samples[this.cursor];
    sample.position.copy(position);
    // Local +X is the road's right axis: the ribbon lies across the path.
    sample.right.set(1, 0, 0).applyQuaternion(quaternion);
    this.cursor = (this.cursor + 1) % this.capacity;
    this.filled = Math.min(this.filled + 1, this.capacity);
    this.lastSample.copy(position);
    this.hasLastSample = true;
  }

  /** Writes the vertices newest-first: k = 0 at the snail, k max = oldest. */
  private rebuild(intensity: number): void {
    const segments = Math.max(0, this.filled - 1);
    for (let k = 0; k < this.filled; k += 1) {
      // (cursor - 1 - k) mod capacity: k = 0 is the freshest sample.
      const sample = this.samples[(this.cursor - 1 - k + this.capacity * 2) % this.capacity];
      const width = this.halfWidth * (1 - k / this.capacity) * (0.45 + 0.55 * intensity);
      const j = k * 6;
      this.positions[j] = sample.position.x + sample.right.x * width;
      this.positions[j + 1] = sample.position.y + this.lift;
      this.positions[j + 2] = sample.position.z + sample.right.z * width;
      this.positions[j + 3] = sample.position.x - sample.right.x * width;
      this.positions[j + 4] = sample.position.y + this.lift;
      this.positions[j + 5] = sample.position.z - sample.right.z * width;

      // Fade to black along the tail (additive: black = invisible).
      const fade = Math.pow(1 - k / Math.max(1, this.filled - 1), 1.6) * intensity;
      this.color.copy(this.baseColor).multiplyScalar(fade);
      this.colors[j] = this.color.r;
      this.colors[j + 1] = this.color.g;
      this.colors[j + 2] = this.color.b;
      this.colors[j + 3] = this.color.r;
      this.colors[j + 4] = this.color.g;
      this.colors[j + 5] = this.color.b;
    }

    const geometry = this.mesh.geometry;
    geometry.setDrawRange(0, segments > 0 ? segments * 6 : 0);
    if (this.filled > 1) {
      (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
