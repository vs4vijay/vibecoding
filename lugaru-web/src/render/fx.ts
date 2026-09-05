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
import { HEAVY_LAND_MIN_FALL_MPS } from '../data/tuning';
import { heightAt } from '../world/terrain';
import type { WeaponDropClass } from '../world/projectiles';
export { HEAVY_LAND_MIN_FALL_MPS };

/**
 * Fall speed (m/s) below which touching down counts as a HEAVY landing —
 * the game layer compares pre-step velY against this to spawn dust rings.
 * Above per-step ground noise (~0.25), just under the jump apex (~5.4).
 */

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

// ---------------------------------------------------------------------------
// Wind tells [Task 17] — drifting snow/dust so wind direction reads at a
// glance, plus floating pickup markers so ground drops are findable.
// ---------------------------------------------------------------------------

/** Pooled particle count (brief Task 17: 400). */
const WIND_PARTICLE_COUNT = 400;
/** Drift field is a box of this half-extent, wrapped around the player. */
const WIND_FIELD_HALF_M = 25;
/** Height of the drift band above the anchor. */
const WIND_FIELD_HEIGHT_M = 9;
/** Horizontal drift speed (m/s) at wind strength 1. */
const WIND_PARTICLE_SPEED_MPS = 7;
/** Constant gentle fall so the drift reads as snow, not smoke. */
const WIND_FALL_MPS = 0.5;
/** Cross-wind wobble amplitude (m/s). */
const WIND_WOBBLE_MPS = 0.4;

/**
 * Pooled THREE.Points drift: every particle's velocity IS the wind vector
 * (scaled), so the cloud's motion direction always matches the F3 wind
 * readout and the grass/bush lean. Particles wrap inside a box that
 * follows the player, so the field is everywhere without ever spawning.
 * Jitter comes from the same LCG discipline as FxParticles — no
 * Math.random anywhere.
 */
export class WindParticles {
  private readonly scene: THREE.Scene;
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly phase: Float32Array;
  private timeSec = 0;
  private lcgState = 0x2545f491;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(WIND_PARTICLE_COUNT * 3);
    this.phase = new Float32Array(WIND_PARTICLE_COUNT);
    for (let i = 0; i < WIND_PARTICLE_COUNT; i++) {
      this.positions[i * 3] = (this.rand() * 2 - 1) * WIND_FIELD_HALF_M;
      this.positions[i * 3 + 1] = this.rand() * WIND_FIELD_HEIGHT_M;
      this.positions[i * 3 + 2] = (this.rand() * 2 - 1) * WIND_FIELD_HALF_M;
      this.phase[i] = this.rand() * Math.PI * 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xf2f6f8,
      size: 0.09,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /**
   * Advance the drift. `wind` is WindSystem.vector (direction × strength);
   * `anchor` (the player) re-centers the wrap box every frame.
   */
  update(dtMs: number, wind: { x: number; z: number }, anchor: { x: number; y: number; z: number }): void {
    const dt = Math.min(dtMs, 100) / 1000;
    if (dt <= 0) return;
    this.timeSec += dt;

    const vx = wind.x * WIND_PARTICLE_SPEED_MPS;
    const vz = wind.z * WIND_PARTICLE_SPEED_MPS;

    for (let i = 0; i < WIND_PARTICLE_COUNT; i++) {
      const p = i * 3;
      const wob = Math.sin(this.timeSec * 1.3 + this.phase[i]) * WIND_WOBBLE_MPS;
      // Cross-wind wobble: perpendicular direction is (-wind.z, wind.x).
      this.positions[p] += (vx - wind.z * wob) * dt;
      this.positions[p + 1] += (-WIND_FALL_MPS + Math.cos(this.timeSec * 0.9 + this.phase[i]) * WIND_WOBBLE_MPS) * dt;
      this.positions[p + 2] += (vz + wind.x * wob) * dt;

      // Wrap into the band around the anchor.
      this.positions[p] = wrap(this.positions[p], anchor.x - WIND_FIELD_HALF_M, anchor.x + WIND_FIELD_HALF_M);
      this.positions[p + 1] = wrap(this.positions[p + 1], anchor.y, anchor.y + WIND_FIELD_HEIGHT_M);
      this.positions[p + 2] = wrap(this.positions[p + 2], anchor.z - WIND_FIELD_HALF_M, anchor.z + WIND_FIELD_HALF_M);
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }

  /** Next seeded pseudo-random in [0, 1). */
  private rand(): number {
    this.lcgState = (Math.imul(this.lcgState, 1664525) + 1013904223) | 0;
    return (this.lcgState >>> 8) / 0x1000000;
  }
}

/** Modulo wrap of `v` into [min, max). */
function wrap(v: number, min: number, max: number): number {
  const span = max - min;
  let r = (v - min) % span;
  if (r < 0) r += span;
  return min + r;
}

// --- Pickup markers ---------------------------------------------------------

/** Visual float height above a drop body's rest position. */
const PICKUP_BOB_BASE_M = 0.12;
const PICKUP_BOB_AMP_M = 0.05;
const PICKUP_BOB_HZ = 2.2;

/**
 * Bobbing weapon mesh + ground ring decal per live WeaponDrops entry.
 * Meshes are simple per-class proxies (the drop bodies themselves have no
 * render geometry); the ring is what actually says "walk here and crouch".
 */
export class PickupVisuals {
  private readonly scene: THREE.Scene;
  private readonly entries = new Map<
    number,
    { mesh: THREE.Mesh; ring: THREE.Mesh; phase: number }
  >();
  /** Reused diff scratch — no per-frame Set allocation. */
  private readonly seen = new Set<number>();

  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Sync markers to the live drop pool; `timeSec` drives the bob. */
  update(timeSec: number, drops: { forEachDrop(fn: (id: number, weaponClass: WeaponDropClass, pos: { x: number; y: number; z: number }) => void): void }): void {
    this.seen.clear();
    drops.forEachDrop((id, weaponClass, pos) => {
      let e = this.entries.get(id);
      if (e === undefined) {
        e = this.build(weaponClass);
        this.entries.set(id, e);
        this.scene.add(e.mesh, e.ring);
      }
      this.seen.add(id);

      const groundY = heightAt(pos.x, pos.z);
      e.mesh.position.set(
        pos.x,
        Math.max(pos.y, groundY) + PICKUP_BOB_BASE_M + Math.sin(timeSec * PICKUP_BOB_HZ + e.phase) * PICKUP_BOB_AMP_M,
        pos.z,
      );
      e.ring.position.set(pos.x, groundY + 0.03, pos.z);
      const pulse = 1 + Math.sin(timeSec * 3 + e.phase) * 0.05;
      e.ring.scale.set(pulse, pulse, 1);
    });

    // Remove markers whose drop was picked up (or otherwise left the pool).
    for (const [id, e] of this.entries) {
      if (this.seen.has(id)) continue;
      this.scene.remove(e.mesh, e.ring);
      this.entries.delete(id);
    }
  }

  dispose(): void {
    for (const e of this.entries.values()) this.scene.remove(e.mesh, e.ring);
    this.entries.clear();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos.length = 0;
    this.mats.length = 0;
  }

  /** Build one weapon proxy + ring from shared geometry/material pools. */
  private build(weaponClass: WeaponDropClass): { mesh: THREE.Mesh; ring: THREE.Mesh; phase: number } {
    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;
    let tiltX = 0;
    if (weaponClass === 'knife') {
      geo = this.geo(() => new THREE.BoxGeometry(0.03, 0.03, 0.42));
      mat = this.mat(0xb8bcc4);
      tiltX = -Math.PI / 2; // blade flat, pointing along -z
    } else if (weaponClass === 'sword') {
      geo = this.geo(() => new THREE.BoxGeometry(0.05, 0.03, 1.1));
      mat = this.mat(0xc8ccd4);
      tiltX = -Math.PI / 2;
    } else {
      geo = this.geo(() => new THREE.CylinderGeometry(0.025, 0.035, 1.8, 6));
      mat = this.mat(0x7a5b3a);
      tiltX = Math.PI / 2 - 0.35; // staff leans, mostly flat
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = tiltX;
    mesh.castShadow = true;

    const ring = new THREE.Mesh(
      this.geo(() => new THREE.RingGeometry(0.26, 0.34, 24)),
      this.mat(0xd8b45a, true),
    );
    ring.rotation.x = -Math.PI / 2;

    return { mesh, ring, phase: (this.entries.size * 1.7) % (Math.PI * 2) };
  }

  private geo(make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    const g = make();
    this.geos.push(g);
    return g;
  }

  private mat(color: number, basic = false): THREE.Material {
    const m = basic
      ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ color, flatShading: true });
    this.mats.push(m);
    return m;
  }
}
