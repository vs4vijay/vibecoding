import * as THREE from 'three';

import type { Entity } from '../entities/Entity';
import { createTrackFrame, type TrackCurve, type TrackFrame } from '../track/TrackCurve';
import { lowerBound } from './Collision';
import { isDestructible, type WeaponKind, type WeaponTier } from './Weapons';

/**
 * Pooled projectiles traveling in track coordinates: `s` advances at the
 * weapon's speed, `x` starts at the fire origin (plus the tier's barrel
 * offsets) and integrates the tier's lateral drift. All detection reuses the
 * sorted-by-s window scan — a binary search plus a short linear run, exactly
 * like player collision. Rendering converts (s, x) → world once per frame per
 * live projectile; nothing allocates in steady state.
 *
 * The pool is preallocated at construction (`max` slots, each a group holding
 * one mesh per weapon kind — only the active kind is visible), so firing
 * during a firefight never allocates.
 */

/** One live (or pooled-idle) projectile record. */
export interface Projectile {
  /** Unique per launch (pool records are reused, so this changes on refire). */
  id: number;
  kind: WeaponKind;
  alive: boolean;
  /** Arc-length position along the track. */
  s: number;
  /** Lateral offset from the center line. */
  x: number;
  /** Height above the road surface. */
  y: number;
  /** Lateral velocity (triple's outer bolts diverge, homing steers). */
  vx: number;
  /** Forward speed in s-units per second. */
  speed: number;
  damage: number;
  /** Hits remaining before the projectile dies (laser pierces). */
  pierce: number;
  homing: boolean;
  radius: number;
  /** Pooled visual; the visible child matches `kind`. */
  mesh: THREE.Group;
}

/** One projectile-enemy contact, valid until the next `update` call. */
export interface ProjectileHit {
  readonly entity: Entity;
  readonly projectile: Projectile;
}

export interface ProjectileSystemOptions {
  /** Pool size. Defaults to 48 — a triple with a 0.26 s cooldown peaks ~14. */
  max?: number;
  /** Height above the road projectiles fly at. Defaults to 1.0. */
  hover?: number;
}

/** Half-depth of the projectile's collision scan window, in s units. */
const HIT_WINDOW = 5;
/** How far a homing rocket will look for a target ahead, in s units. */
const HOMING_RANGE = 170;
/** Homing lateral steer rate, x units per second. */
const HOMING_TURN_RATE = 16;
/** Projectiles die this far past the player (they outrun Turbo quickly). */
const TRAIL_DISTANCE = 300;

// -- Shared geometry/material singletons (created once per process). --------

function forwardGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.rotateX(Math.PI / 2); // Y-long axis → Z (mesh forward = local -Z)
  return geometry;
}

const boltGeometry = forwardGeometry(new THREE.CapsuleGeometry(0.09, 0.5, 3, 8));
const laserGeometry = forwardGeometry(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 6));
const rocketGeometry = forwardGeometry(new THREE.ConeGeometry(0.17, 0.66, 8));

/** Overdriven colors — small emissive bolts that feed the bloom pass. */
const boltMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 2.2, 2.6) });
const laserMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.6, 2.8) });
const rocketMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 0.9, 0.35) });

const KIND_MESHBUILDERS: Readonly<Record<WeaponKind, () => THREE.Mesh>> = {
  bolt: () => new THREE.Mesh(boltGeometry, boltMaterial),
  laser: () => new THREE.Mesh(laserGeometry, laserMaterial),
  rocket: () => new THREE.Mesh(rocketGeometry, rocketMaterial),
};

/** Barrel offsets + lateral drift for a tier's shot pattern, per projectile. */
export function shotPattern(tier: WeaponTier): Array<{ offset: number; drift: number }> {
  if (tier.count === 1) return [{ offset: 0, drift: 0 }];
  if (tier.count === 2) {
    return [
      { offset: -tier.spread, drift: 0 },
      { offset: tier.spread, drift: 0 },
    ];
  }
  return [
    { offset: 0, drift: 0 },
    { offset: -tier.spread, drift: -tier.drift },
    { offset: tier.spread, drift: tier.drift },
  ];
}

interface PoolSlot {
  readonly projectile: Projectile;
  readonly meshes: Readonly<Record<WeaponKind, THREE.Mesh>>;
}

export class ProjectileSystem {
  /** Scene root for every projectile mesh; add to the scene once. */
  public readonly group = new THREE.Group();

  private readonly track: TrackCurve;
  private readonly slots: PoolSlot[] = [];
  private readonly hover: number;
  private nextId = 1;

  // Reused scratch — update() is a hot path, nothing allocates here.
  private readonly frame: TrackFrame = createTrackFrame();
  private readonly hits: ProjectileHit[] = [];
  private readonly hitThisStep = new Set<number>();
  private readonly tiltQuat = new THREE.Quaternion();
  private readonly LOCAL_Y = new THREE.Vector3(0, 1, 0);

  public constructor(track: TrackCurve, options: ProjectileSystemOptions = {}) {
    this.track = track;
    this.hover = options.hover ?? 1.0;
    const max = options.max ?? 48;
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError(`ProjectileSystem max must be a positive integer, got ${String(max)}`);
    }

    this.group.name = 'projectiles';
    for (let i = 0; i < max; i += 1) {
      const meshes = {
        bolt: KIND_MESHBUILDERS.bolt(),
        laser: KIND_MESHBUILDERS.laser(),
        rocket: KIND_MESHBUILDERS.rocket(),
      };
      const mesh = new THREE.Group();
      mesh.add(meshes.bolt, meshes.laser, meshes.rocket);
      mesh.visible = false;
      this.group.add(mesh);
      this.slots.push({
        projectile: {
          id: 0,
          kind: 'bolt',
          alive: false,
          s: 0,
          x: 0,
          y: this.hover,
          vx: 0,
          speed: 0,
          damage: 1,
          pierce: 1,
          homing: false,
          radius: 0.5,
          mesh,
        },
        meshes,
      });
    }
  }

  /** Every pool record (alive and idle) — tests inspect this. */
  public get all(): readonly Projectile[] {
    return this.slots.map((slot) => slot.projectile);
  }

  /** Number of projectiles currently in flight. */
  public get activeCount(): number {
    let count = 0;
    for (const slot of this.slots) if (slot.projectile.alive) count += 1;
    return count;
  }

  /**
   * Fires one volley for `tier` from the fire origin (s, x). Returns how many
   * projectiles actually launched — fewer than `tier.count` only when the
   * pool is momentarily exhausted (at which point dropping shots is the right
   * failure mode; nothing allocates to catch up).
   */
  public fire(tier: WeaponTier, originS: number, originX: number): number {
    let fired = 0;
    for (const barrel of shotPattern(tier)) {
      const slot = this.slots.find((candidate) => !candidate.projectile.alive);
      if (!slot) break;

      const projectile = slot.projectile;
      projectile.id = this.nextId++;
      projectile.kind = tier.kind;
      projectile.alive = true;
      projectile.s = originS;
      projectile.x = originX + barrel.offset;
      projectile.y = this.hover;
      projectile.vx = barrel.drift;
      projectile.speed = tier.speed;
      projectile.damage = tier.damage;
      projectile.pierce = tier.pierce;
      projectile.homing = tier.homing;
      projectile.radius = tier.radius;

      this.showKind(projectile);
      this.placeMesh(projectile);
      fired += 1;
    }
    return fired;
  }

  /**
   * Advances every live projectile by `dt` and resolves projectile-enemy
   * contacts against the sorted-by-s entity list. Returns the hits — valid
   * until the next `update` call. The caller applies damage/kills/score;
   * duplicates within one step are already deduped per entity (a laser and a
   * bolt reaching the same rock in the same tick count once).
   */
  public update(dt: number, enemies: readonly Entity[], playerS: number): readonly ProjectileHit[] {
    this.hits.length = 0;
    this.hitThisStep.clear();

    for (const slot of this.slots) {
      const projectile = slot.projectile;
      if (!projectile.alive) continue;

      if (projectile.homing) this.steerHoming(projectile, enemies);

      projectile.s += projectile.speed * dt;
      projectile.x += projectile.vx * dt;

      // Off the front of the play space (or past the finish): recycle.
      if (projectile.s > playerS + TRAIL_DISTANCE || projectile.s >= this.track.getCurveLength()) {
        this.deactivate(projectile);
        continue;
      }

      this.resolveHits(projectile, enemies);
      if (projectile.alive) this.placeMesh(projectile);
    }

    return this.hits;
  }

  /** Deactivates everything (retry / level swap). */
  public clear(): void {
    for (const slot of this.slots) this.deactivate(slot.projectile);
    this.hits.length = 0;
    this.hitThisStep.clear();
  }

  // -- Internals ------------------------------------------------------------

  private deactivate(projectile: Projectile): void {
    projectile.alive = false;
    projectile.mesh.visible = false;
  }

  private showKind(projectile: Projectile): void {
    // Each pool slot owns one mesh per kind; show only the active kind.
    for (const candidate of this.slots) {
      if (candidate.projectile !== projectile) continue;
      candidate.meshes.bolt.visible = projectile.kind === 'bolt';
      candidate.meshes.laser.visible = projectile.kind === 'laser';
      candidate.meshes.rocket.visible = projectile.kind === 'rocket';
      break;
    }
    projectile.mesh.visible = true;
  }

  /** Rockets bend toward the nearest destructible enemy ahead of them. */
  private steerHoming(projectile: Projectile, enemies: readonly Entity[]): void {
    let bestScore = Infinity;
    let targetX = 0;
    let hasTarget = false;

    for (let i = lowerBound(enemies, projectile.s); i < enemies.length; i += 1) {
      const entity = enemies[i];
      if (entity.s > projectile.s + HOMING_RANGE) break;
      if (!entity.alive || !isDestructible(entity.type)) continue;
      const ds = entity.s - projectile.s;
      const dx = entity.x - projectile.x;
      const score = ds * ds + dx * dx * 4; // prefer enemies roughly dead-ahead
      if (score < bestScore) {
        bestScore = score;
        targetX = entity.x;
        hasTarget = true;
      }
    }

    if (!hasTarget) return;
    const desired = Math.max(-HOMING_TURN_RATE, Math.min(HOMING_TURN_RATE, (targetX - projectile.x) * 4));
    projectile.vx = desired;
  }

  /** Window scan + circle test against destructible entities. */
  private resolveHits(projectile: Projectile, enemies: readonly Entity[]): void {
    const minS = projectile.s - HIT_WINDOW;
    const maxS = projectile.s + HIT_WINDOW;

    for (let i = lowerBound(enemies, minS); i < enemies.length; i += 1) {
      const entity = enemies[i];
      if (entity.s > maxS) break;
      if (!entity.alive || !isDestructible(entity.type)) continue;
      if (this.hitThisStep.has(entity.id)) continue;

      const ds = entity.s - projectile.s;
      const dx = entity.x - projectile.x;
      const radiusSum = projectile.radius + entity.radius;
      if (ds * ds + dx * dx > radiusSum * radiusSum) continue;

      this.hitThisStep.add(entity.id);
      this.hits.push({ entity, projectile });
      if (projectile.pierce > 0) {
        projectile.pierce -= 1;
        if (projectile.pierce === 0) {
          this.deactivate(projectile);
          return;
        }
      }
    }
  }

  /** (s, x) → world placement, rockets leaning into their lateral motion. */
  private placeMesh(projectile: Projectile): void {
    this.track.sToWorld(projectile.s, projectile.x, this.frame);
    projectile.mesh.position.copy(this.frame.position);
    projectile.mesh.position.addScaledVector(this.frame.normal, projectile.y);
    projectile.mesh.quaternion.copy(this.frame.quaternion);
    if (projectile.vx !== 0) {
      const tilt = -Math.atan2(projectile.vx, Math.max(projectile.speed, 1e-6));
      this.tiltQuat.setFromAxisAngle(this.LOCAL_Y, tilt);
      projectile.mesh.quaternion.multiply(this.tiltQuat);
    }
  }
}
