import type { Entity } from '../entities/Entity';

/**
 * Collision detection in pure track coordinates — no world-space math.
 *
 * Entities are kept sorted by `s` (the Spawner guarantees this), so the check
 * is a binary search for the lower edge of an s-window around the player
 * followed by a short linear scan: O(window), independent of level length.
 * Inside the window each candidate is a plain circle test on (ds, dx) against
 * the summed radii, returning the *nearest* hit so overlapping pickups resolve
 * to the most relevant one.
 *
 * Entities are pooled and reused across retries, so dead (`alive === false`)
 * records must always be skipped — that is the "wrap of entity reuse" rule.
 */

/** The player snail's own collision radius in (s, x) space. */
export const PLAYER_RADIUS = 0.9;

/**
 * Types the circle-contact test applies to. All four pass-through types are
 * plane-crossing events, not contacts — they are detected by the dedicated
 * crossing check (`findRingPass`) and must be excluded here.
 */
export function isContactType(entity: Entity): boolean {
  return (
    entity.type !== 'whiteRing' &&
    entity.type !== 'yellowRing' &&
    entity.type !== 'redRing' &&
    entity.type !== 'jumpPod'
  );
}

/**
 * Ground hazards: lane-bound contact threats that sit on the road surface.
 * While Turbo is airborne (jump-pod flight) these are simply not there —
 * the contact filter in the gameplay loop drops them mid-flight.
 */
export function isGroundHazard(entity: Entity): boolean {
  return entity.type === 'slug' || entity.type === 'asteroid';
}

/** Types detected by the s-plane crossing check instead of circle contact. */
export function isPassThroughType(entity: Entity): boolean {
  return (
    entity.type === 'whiteRing' ||
    entity.type === 'yellowRing' ||
    entity.type === 'redRing' ||
    entity.type === 'jumpPod'
  );
}

/**
 * Half-width of the s-scan window around the player, in world units. Larger
 * than the biggest possible radius sum (~2.6) by a wide margin; the exact
 * circle test decides actual contact.
 */
export const COLLISION_WINDOW = 8;

/**
 * Returns the nearest living entity whose (s, x) circle overlaps the player's,
 * or null. `entities` must be sorted by ascending `s`. The optional `filter`
 * lets the caller exclude types that are not circle contacts (rings use the
 * dedicated plane-crossing check in `findRingPass`).
 */
export function findHit(
  entities: readonly Entity[],
  playerS: number,
  playerX: number,
  playerRadius: number = PLAYER_RADIUS,
  window: number = COLLISION_WINDOW,
  filter?: (entity: Entity) => boolean,
): Entity | null {
  const minS = playerS - window;
  const maxS = playerS + window;

  let first = lowerBound(entities, minS);
  let best: Entity | null = null;
  let bestDistanceSq = Infinity;

  for (let i = first; i < entities.length; i += 1) {
    const entity = entities[i];
    if (entity.s > maxS) break;
    if (!entity.alive) continue;
    if (filter && !filter(entity)) continue;

    const ds = entity.s - playerS;
    const dx = entity.x - playerX;
    const radiusSum = playerRadius + entity.radius;
    const distanceSq = ds * ds + dx * dx;
    if (distanceSq <= radiusSum * radiusSum && distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = entity;
    }
  }

  return best;
}

/**
 * Pass-through crossing: arches span (or partially span) the road, so the
 * test is "did the player cross the entity's s-plane this step" — exact plane
 * crossing between `prevS` and `playerS`, plus |x − lane| within the entity
 * radius. Reward rings (white/yellow) and jump pods span the whole road, so
 * their radius always catches every lane; the red trap ring is smaller and
 * lane-placed, so a player steering around it never crosses within radius.
 * Returns the first crossing this step, or null.
 */
export function findRingPass(
  entities: readonly Entity[],
  prevS: number,
  playerS: number,
  playerX: number,
): Entity | null {
  for (let i = lowerBound(entities, prevS); i < entities.length; i += 1) {
    const entity = entities[i];
    if (entity.s > playerS) break;
    if (entity.s <= prevS) continue; // crossed strictly this step
    if (!entity.alive) continue;
    if (!isPassThroughType(entity)) continue;
    if (Math.abs(playerX - entity.x) <= entity.radius) return entity;
  }
  return null;
}

/**
 * Gap-fall check: Turbo is over open air this step while grounded. `gaps` is
 * the level's TrackGaps (any object exposing `spanOverlapping`); the swept
 * interval `(prevS, playerS]` catches the exact step the snail crosses the
 * cliff edge, and airborne flights (jump pods) are immune — a pod arc may
 * pass over open air freely, but *landing* inside a gap still falls, because
 * the check runs on the step where `airborne` has already turned false.
 * Null/absent gap data (levels without gaps) never falls.
 */
export function checkFall(
  gaps: { spanOverlapping(from: number, to: number): unknown } | null | undefined,
  prevS: number,
  playerS: number,
  airborne: boolean,
): boolean {
  if (airborne || !gaps) return false;
  return gaps.spanOverlapping(prevS, playerS) !== null;
}

/** Index of the first entity with `s >= value` (binary search over the sorted list). */
export function lowerBound(entities: readonly Entity[], value: number): number {
  let low = 0;
  let high = entities.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (entities[mid].s < value) low = mid + 1;
    else high = mid;
  }
  return low;
}
