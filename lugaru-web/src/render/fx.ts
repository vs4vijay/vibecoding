/**
 * FX particles [Task 14] — minimal preallocated particle system for combat
 * feedback: blood puffs when a blade opens a wound, dust rings when a body
 * lands hard (knockdown arcs, KO pops, big falls).
 *
 * three.js is allowed here (render layer). Allocation-conscious by design:
 * every particle slot and ring mesh is built once up front; spawning only
 * writes into existing buffers and updating only mutates them. Jitter comes
 * from a tiny internal LCG so runs stay deterministic and Math.random never
 * enters the codebase.
 */

import * as THREE from 'three';

/**
 * Fall speed (m/s) below which touching down counts as a HEAVY landing —
 * the game layer compares pre-step velY against this to spawn dust rings.
 * Above per-step ground noise (~0.25), just under the jump apex (~5.4).
 */
export const HEAVY_LAND_MIN_FALL_MPS = 3;

const BLOOD_PUFF_SLOTS = 96;
const DUST_RING_SLOTS = 6;
const PUFF_LIFE_MS = 550;
const RING_LIFE_MS = 450;
const RING_MAX_SCALE = 2.6;
const PUFF_GRAVITY_MPS2 = -7;
/** Particles parked here are invisible (one shared far-away graveyard). */
const PARKED_Y = -1e4;

const BLOOD_COLOR = 0x6a1212;
const DUST_COLOR = 0x9a8f7a;

export class FxParticles {
  private readonly scene: THREE.Scene;

  // Blood puffs: one Points cloud; slot i lives at positions[3i..3i+2].
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly lifes: Float32Array = new Float32Array(BLOOD_PUFF_SLOTS);
  private nextPuff = 0;

  // Dust rings: small pool of expanding, fading flat ring meshes.
  private readonly rings: THREE.Mesh[] = [];
  private readonly ringLifes: Float32Array = new Float32Array(DUST_RING_SLOTS);
  private nextRing = 0;

  /** Tiny LCG — deterministic visual jitter without touching the sim rng. */
  private lcgState = 0x9e3779b9;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(BLOOD_PUFF_SLOTS * 3).fill(PARKED_Y);
    this.velocities = new Float32Array(BLOOD_PUFF_SLOTS * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: BLOOD_COLOR,
      size: 0.14,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    for (let i = 0; i < DUST_RING_SLOTS; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.55, 24),
        new THREE.MeshBasicMaterial({
          color: DUST_COLOR,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2; // flat on the ground
      ring.visible = false;
      scene.add(ring);
      this.rings.push(ring);
    }
  }

  /** Blood spray where a blade just opened a wound. */
  spawnBloodPuff(pos: { x: number; y: number; z: number }): void {
    for (let n = 0; n < 10; n++) {
      const slot = this.nextPuff;
      this.nextPuff = (this.nextPuff + 1) % BLOOD_PUFF_SLOTS;
      const i = slot * 3;
      this.positions[i] = pos.x;
      this.positions[i + 1] = pos.y + 0.4;
      this.positions[i + 2] = pos.z;
      // Cone of droplets: mostly outward, slight rise, seeded jitter.
      this.velocities[i] = (this.rand() - 0.5) * 2.2;
      this.velocities[i + 1] = 0.6 + this.rand() * 1.4;
      this.velocities[i + 2] = (this.rand() - 0.5) * 2.2;
      this.lifes[slot] = PUFF_LIFE_MS;
    }
  }

  /** Dust ring where a body just slammed into the ground. */
  spawnDustRing(pos: { x: number; y: number; z: number }): void {
    // Pool scan, then steal the oldest live slot — rings are short-lived.
    let slot = -1;
    for (let i = 0; i < DUST_RING_SLOTS; i++) {
      if (this.ringLifes[i] <= 0) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      slot = this.nextRing;
      this.nextRing = (this.nextRing + 1) % DUST_RING_SLOTS;
    }
    const ring = this.rings[slot];
    ring.position.set(pos.x, pos.y + 0.05, pos.z);
    ring.scale.setScalar(0.4);
    ring.visible = true;
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.55;
    this.ringLifes[slot] = RING_LIFE_MS;
  }

  /** Advance every live particle; called once per rendered frame. */
  update(dtMs: number): void {
    const dtS = dtMs / 1000;

    for (let slot = 0; slot < BLOOD_PUFF_SLOTS; slot++) {
      if (this.lifes[slot] <= 0) continue;
      this.lifes[slot] -= dtMs;
      const i = slot * 3;
      if (this.lifes[slot] <= 0) {
        this.positions[i + 1] = PARKED_Y; // park dead droplets
        continue;
      }
      this.velocities[i + 1] += PUFF_GRAVITY_MPS2 * dtS;
      this.positions[i] += this.velocities[i] * dtS;
      this.positions[i + 1] += this.velocities[i + 1] * dtS;
      this.positions[i + 2] += this.velocities[i + 2] * dtS;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    for (let slot = 0; slot < DUST_RING_SLOTS; slot++) {
      if (this.ringLifes[slot] <= 0) continue;
      this.ringLifes[slot] -= dtMs;
      const ring = this.rings[slot];
      if (this.ringLifes[slot] <= 0) {
        ring.visible = false;
        continue;
      }
      const t = 1 - this.ringLifes[slot] / RING_LIFE_MS; // 0 → 1 over life
      ring.scale.setScalar(0.4 + t * RING_MAX_SCALE);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
    }
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    for (const ring of this.rings) {
      this.scene.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    this.rings.length = 0;
  }

  /** Next seeded pseudo-random in [0, 1). */
  private rand(): number {
    this.lcgState = (Math.imul(this.lcgState, 1664525) + 1013904223) | 0;
    return (this.lcgState >>> 8) / 0x1000000;
  }
}
