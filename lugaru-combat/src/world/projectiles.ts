/**
 * Task 12 — thrown knives and weapon drops.
 *
 * Both share a single pool of dynamic Rapier bodies:
 * - `Projectiles.throwKnife` creates a small capsule, enables CCD, returns a
 *   `KnifeHandle` the caller can query; on body/fighter hit it fires a
 *   `KnifeEvent` and the knife becomes a pickup at rest.
 * - `WeaponDrops` uses the same physics bodies but with `WeaponBodyHandle`
 *   so pickups (Task 13) can be implemented by querying the pool.
 *
 * Events are returned per `step(dtMs)` so the combat sim can react to hits.
 */
import * as RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from './physics';
import type { FighterState } from '../combat/stateMachine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KnifeEvent {
  type: 'hit' | 'rest';
  /** If a body/fighter was hit. */
  targetId?: string;
  /** Rest position when the knife settles. */
  at?: { x: number; y: number; z: number };
}

/** A real weapon class that can lie on the ground as a pickup. */
export type WeaponDropClass = 'knife' | 'sword' | 'staff';

export interface DropHandle {
  weaponClass: WeaponDropClass;
  pos: { x: number; y: number; z: number };
}

interface ProjectileBody {
  handle: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  // For knives: identity for hit event.
  targetIds?: string[];
}

// ---------------------------------------------------------------------------

import { KNIFE_HIT_CHEST_Y_M, KNIFE_HIT_MIN_TRAVEL_M, KNIFE_HIT_RADIUS_M } from '../data/tuning';

// ---------------------------------------------------------------------------
// Knife parameters
// ---------------------------------------------------------------------------

const KNIFE_HALF_H = 0.18;
const KNIFE_RADIUS = 0.02;
const KNIFE_DENSITY = 7800; // kg/m^3 — steel
const KNIFE_LINEAR_DAMP = 0.02;
const KNIFE_ANGULAR_DAMP = 0.05;
const KNIFE_CCD = true;

// ---------------------------------------------------------------------------
// Projectiles class — knives only
// ---------------------------------------------------------------------------

export class Projectiles {
  private readonly world: PhysicsWorld;
  private readonly knives: ProjectileBody[] = [];

  constructor(world: PhysicsWorld) {
    this.world = world;
  }

  /** Launch a knife from `from` in direction `dir` (unit) at `speed` (m/s). */
  throwKnife(
    from: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    speed: number,
  ): void {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const vx = (dir.x / len) * speed;
    const vy = (dir.y / len) * speed;
    const vz = (dir.z / len) * speed;

    const body = this.world.raw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(from.x, from.y, from.z)
        .setLinvel(vx, vy, vz)
        .setLinearDamping(KNIFE_LINEAR_DAMP)
        .setAngularDamping(KNIFE_ANGULAR_DAMP)
        .setCcdEnabled(KNIFE_CCD),
    );
    const collider = this.world.raw.createCollider(
      RAPIER.ColliderDesc.capsule(KNIFE_HALF_H, KNIFE_RADIUS)
        .setDensity(KNIFE_DENSITY)
        .setFriction(0.3)
        .setRestitution(0.1),
      body,
    );
    this.knives.push({ handle: body, collider });
  }

  /**
   * Advance all knives by `dtMs` milliseconds; returns events fired this step.
   * Collisions with fighters are checked by ray-casting the knife's travel
   * segment (CCD ensures no tunneling for reasonable speeds; the ray is a
   * fallback). Fighter hit detection uses their capsule bounds approximated
   * from the Rig — caller supplies the current roster.
   */
  step(dtMs: number, fighters: FighterState[] = []): KnifeEvent[] {
    const events: KnifeEvent[] = [];
    const dtSec = dtMs / 1000;

    for (let i = this.knives.length - 1; i >= 0; i--) {
      const k = this.knives[i];
      const pos = k.handle.translation();

      // Ground contact handled analytically: Rapier's CCD does not sweep
      // against heightfields, so fast knives tunnel through. Terrain is
      // analytic in this codebase — when the knife reaches the surface it
      // STICKS where it lands (Lugaru thrown weapons stick). No bounce.
      const groundY = this.world.castGround(pos.x, pos.z);
      if (pos.y - KNIFE_RADIUS <= groundY) {
        events.push({ type: 'rest', at: { x: pos.x, y: groundY + KNIFE_RADIUS, z: pos.z } });
        this.world.raw.removeCollider(k.collider, true);
        this.world.raw.removeRigidBody(k.handle);
        this.knives.splice(i, 1);
        continue;
      }
      const vel = k.handle.linvel();

      // Hit detection: sweep a short ray along the knife's travel this step.
      // CCD + ray gives reliable "did we pass through someone" without
      // depending on contact callbacks which fire after the step.
      const travelX = vel.x * dtSec;
      const travelY = vel.y * dtSec;
      const travelZ = vel.z * dtSec;
      const travelDist = Math.hypot(travelX, travelY, travelZ);

      if (travelDist > KNIFE_HIT_MIN_TRAVEL_M && fighters.length > 0) {
        const rayDir = {
          x: travelX / travelDist,
          y: travelY / travelDist,
          z: travelZ / travelDist,
        };
        const ray = new RAPIER.Ray({ x: pos.x, y: pos.y, z: pos.z }, rayDir);
        const hit = this.world.raw.castRay(ray, travelDist + 0.1, true);

        if (hit && hit.collider) {
          // Is this collider attached to a fighter's ragdoll body? We don't
          // have a direct back-link, so we check against known fighter
          // positions (sim state). A hit is close if the impact point is
          // within ~0.6m of the fighter's chest position.
          const ix = pos.x + rayDir.x * hit.timeOfImpact;
          const iy = pos.y + rayDir.y * hit.timeOfImpact;
          const iz = pos.z + rayDir.z * hit.timeOfImpact;

          let victim: FighterState | undefined;
          for (const f of fighters) {
            // Chest at pos.x, pos.y + torsoLen*0.8, pos.z approx.
            const dist = Math.hypot(
              f.pos.x - ix,
              f.pos.y + KNIFE_HIT_CHEST_Y_M - iy,
              f.pos.z - iz,
            );
            if (dist < KNIFE_HIT_RADIUS_M) {
              victim = f;
              break;
            }
          }
          if (victim) {
            events.push({ type: 'hit', targetId: victim.id });
            // Stop the knife; it sticks where it hit.
            k.handle.setLinvel({ x: 0, y: 0, z: 0 }, true);
            k.handle.setAngvel({ x: 0, y: 0, z: 0 }, true);
            // It will become a pickup on the next step's rest check.
          }
        }
      }
    }
    return events;
  }
}

// ---------------------------------------------------------------------------
// WeaponDrops — dropped weapons become ground pickups
// ---------------------------------------------------------------------------

const DROP_HALF_EXTENTS: Record<WeaponDropClass, { x: number; y: number; z: number }> = {
  knife: { x: 0.08, y: 0.18, z: 0.02 },
  sword: { x: 0.1, y: 0.45, z: 0.03 },
  staff: { x: 0.05, y: 0.9, z: 0.05 },
};

const DROP_DENSITY = 500; // wood/metal mix, lighter than solid steel
const DROP_FRICTION = 0.5;

export class WeaponDrops {
  private readonly world: PhysicsWorld;
  private readonly drops: Map<number, { body: RAPIER.RigidBody; collider: RAPIER.Collider; cls: WeaponDropClass }> = new Map();
  private nextId = 1;

  constructor(world: PhysicsWorld) {
    this.world = world;
  }

  /** Spawn a weapon drop at `pos` with optional initial `vel`. */
  spawnDrop(
    weaponClass: WeaponDropClass,
    pos: { x: number; y: number; z: number },
    vel?: { x: number; y: number; z: number },
  ): number {
    const he = DROP_HALF_EXTENTS[weaponClass];
    const body = this.world.raw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinvel(vel?.x ?? 0, vel?.y ?? 0, vel?.z ?? 0)
        .setLinearDamping(0.08)
        .setAngularDamping(0.12),
    );
    const collider = this.world.raw.createCollider(
      RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
        .setDensity(DROP_DENSITY)
        .setFriction(DROP_FRICTION)
        .setRestitution(0.1),
      body,
    );
    const id = this.nextId++;
    this.drops.set(id, { body, collider, cls: weaponClass });
    return id;
  }

  /** Find the nearest drop to `pos` within `maxM` metres. */
  nearest(
    pos: { x: number; y: number; z: number },
    maxM: number,
  ): DropHandle | null {
    let best: { id: number; d2: number } | null = null;
    for (const [id, drop] of this.drops) {
      const t = drop.body.translation();
      const dx = t.x - pos.x;
      const dy = t.y - pos.y;
      const dz = t.z - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= maxM * maxM && (!best || d2 < best.d2)) {
        best = { id, d2 };
      }
    }
    if (!best) return null;
    const drop = this.drops.get(best.id)!;
    const t = drop.body.translation();
    return { weaponClass: drop.cls, pos: { x: t.x, y: t.y, z: t.z } };
  }

  /**
   * Allocation-free nearest drop probe for per-step game loops: writes the
   * hit into `out` and returns true, or returns false (out untouched)
   * when nothing lies within `maxM`. (`nearest` is the convenience twin.)
   */
  nearestInto(
    pos: { x: number; y: number; z: number },
    maxM: number,
    out: { id: number; weaponClass: WeaponDropClass; pos: { x: number; y: number; z: number } },
  ): boolean {
    let bestId = 0;
    let bestD2 = maxM * maxM;
    let bx = 0;
    let by = 0;
    let bz = 0;
    for (const [id, drop] of this.drops) {
      const t = drop.body.translation();
      const dx = t.x - pos.x;
      const dy = t.y - pos.y;
      const dz = t.z - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= bestD2) {
        bestD2 = d2;
        bestId = id;
        bx = t.x;
        by = t.y;
        bz = t.z;
      }
    }
    if (bestId === 0) return false;
    out.id = bestId;
    out.weaponClass = this.drops.get(bestId)!.cls;
    out.pos.x = bx;
    out.pos.y = by;
    out.pos.z = bz;
    return true;
  }

  /**
   * Iterate live drops (id, class, body position) without building an
   * array — the pickup visuals sync through this each frame. The position
   * object is Rapier's own translation vector: read it, don't keep it.
   */
  forEachDrop(fn: (id: number, weaponClass: WeaponDropClass, pos: { x: number; y: number; z: number }) => void): void {
    for (const [id, drop] of this.drops) {
      fn(id, drop.cls, drop.body.translation());
    }
  }

  /** Remove a drop by the handle returned from `spawnDrop`. */
  remove(id: number): void {
    const drop = this.drops.get(id);
    if (!drop) return;
    this.world.raw.removeRigidBody(drop.body);
    this.world.raw.removeCollider(drop.collider, true);
    this.drops.delete(id);
  }
}