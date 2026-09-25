import type * as THREE from 'three';

/**
 * Runtime record for one spawnable track entity (package, heart, slug).
 *
 * Gameplay state lives entirely in track coordinates — `s` (arc length) and
 * `x` (lateral offset) — so collision and spawning never touch world space.
 * The mesh side is wrapped in an `EntityVisual` whose outer transform is owned
 * by the Spawner; the visual itself only animates its inner pivot.
 *
 * Lifecycle: `alive` is the gameplay flag (a collected package is dead until
 * the level resets — collision must skip dead entities); `active` is the
 * streaming flag (only entities inside the Spawner's s-window have a visible
 *, animated mesh). Entities are reused across retries: `Spawner.reset()`
 * revives every record and its pooled visual.
 */

/**
 * Behavioral types the roster spawns. `packageArc` expands into several
 * `package`s. Phase 3 added the destructible asteroid and the reward rings
 * (white = ladder up, yellow = smart bomb); Phase 4 adds the red trap ring
 * and the road-spanning jump pod (`gap` features expand into pods — the gap
 * itself is track structure, owned by `TrackGaps`/`TrackMesh`).
 */
export type SpawnType =
  | 'package'
  | 'heart'
  | 'slug'
  | 'asteroid'
  | 'whiteRing'
  | 'yellowRing'
  | 'redRing'
  | 'jumpPod';

/**
 * A code-built mesh + per-entity animation for one entity type.
 *
 * `object` is the outer group: the Spawner positions/orients it in world
 * space on activation. All animation (spin, slither, pulse, pickup pop)
 * happens on an inner pivot so the two never fight over the same transform.
 */
export interface EntityVisual {
  readonly object: THREE.Object3D;
  /** Advances the idle animation. Called only while the entity is active. */
  update(dt: number, elapsed: number): void;
  /** One-shot pickup pop (scale burst); optional. */
  pop?(): void;
}

export interface Entity {
  /** Stable id within a level load (also the sort tiebreaker). */
  readonly id: number;
  readonly type: SpawnType;
  /** Arc-length position along the track (0..length). */
  readonly s: number;
  /** Lateral offset from the center line (positive = right). */
  readonly x: number;
  /** Collision radius in (s, x) space, in world units. */
  readonly radius: number;
  /** Original feature type this entity came from (`package`, `packageArc`, ...). */
  readonly sourceType: string;
  /**
   * Deterministic per-instance seed (hash of the stable id). The asteroid
   * factory uses it to precompute its noise displacement once at load —
   * every retry rebuilds the exact same rock, and nothing runs noise
   * per frame.
   */
  readonly seed: number;
  /** Gameplay flag: false once collected/destroyed, true again after a reset. */
  alive: boolean;
  /** Streaming flag: true while inside the Spawner's activation window. */
  active: boolean;
  /** Pooled visual; non-null for every entity built from a known factory. */
  visual: EntityVisual | null;
}

/** Collision radii per type in (s, x) space. */
export const ENTITY_RADII: Readonly<Record<SpawnType, number>> = {
  package: 1.7,
  heart: 1.7,
  slug: 1.35,
  /**
   * Asteroids block a lane: radius 3 covers roughly one 4.7-unit lane plus
   * margin on the 14-wide road. Walls are authored with one lane open.
   */
  asteroid: 3.0,
  /**
   * Rings span the road: pass-through is "crossed the ring plane anywhere
   * across the road", so the gameplay radius is the torus radius. Only used
   * by the dedicated ring check (`findRingPass`), not the contact test.
   */
  whiteRing: 7.4,
  yellowRing: 7.4,
  /**
   * The red trap ring is lane-placed and *dodgeable*: radius 4.2 around its
   * lane leaves a steer-around lane on the 14-wide road. Pass-through only —
   * detected by `findRingPass`, never a circle contact.
   */
  redRing: 4.2,
  /**
   * Jump pods span the whole road (a launch strip, impossible to miss): any
   * lane crossing the pod's s-plane triggers the launch. Pass-through only.
   */
  jumpPod: 7.6,
};

let nextEntityId = 1;

/** Stable id-hash for per-instance determinism (asteroid displacement). */
function seedFromId(id: number): number {
  let hash = (id + 0x9e3779b9) | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) | 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * Creates one entity record. Radius defaults to the per-type gameplay value;
 * the seed defaults to a stable hash of the id and only matters to visuals
 * that need per-instance variation.
 */
export function createEntity(
  type: SpawnType,
  s: number,
  x: number,
  options: { radius?: number; sourceType?: string; seed?: number } = {},
): Entity {
  const id = nextEntityId++;
  return {
    id,
    type,
    s,
    x,
    radius: options.radius ?? ENTITY_RADII[type],
    sourceType: options.sourceType ?? type,
    seed: options.seed ?? seedFromId(id),
    alive: true,
    active: false,
    visual: null,
  };
}
