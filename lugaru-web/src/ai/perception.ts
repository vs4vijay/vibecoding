/**
 * Perception — sight cones (canSee) and hearing events (emitHearing / hear).
 *
 * Pure functions over plain data; no three, no Rapier, no clock. Heading uses
 * the repo's forwardXZ convention (forward along heading h is -sin h, -cos h),
 * so the FOV test is a convention-agnostic dot product against the forward
 * vector.
 */
import {
  BUSHES_BLOCK_COUNT,
  BUSH_RADIUS_M,
  CROUCH_SIGHT_MULT,
  HEARING_BASE_RABBIT_M,
  HEARING_BASE_WOLF_M,
  SIGHT_FOV_RAD,
  SIGHT_RANGE_RABBIT_M,
  SIGHT_RANGE_WOLF_M,
} from '../data/tuning';

export type Species = 'rabbit' | 'wolf';

/** A positioned, headed observer or target for the sight test. */
export interface Sighter {
  pos: { x: number; z: number };
  heading: number;
  species: Species;
}

/** A sight target; `crouched` halves the observer's effective range. */
export interface SightTarget extends Sighter {
  crouched: boolean;
}

/** A blocking bush: a circle in the ground plane with a radius. */
export interface Bush {
  pos: { x: number; z: number };
  radius: number;
}

/** World geometry the sight ray must travel through. */
export interface WorldGeometry {
  bushes: Bush[];
}

/** Clear-sky sight range (m) for a species observer. */
export function sightRange(species: Species): number {
  return species === 'wolf' ? SIGHT_RANGE_WOLF_M : SIGHT_RANGE_RABBIT_M;
}

/** True when `observer` can see `target` given range, FOV, crouch, and bushes. */
export function canSee(observer: Sighter, target: SightTarget, world: WorldGeometry): boolean {
  const dx = target.pos.x - observer.pos.x;
  const dz = target.pos.z - observer.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist === 0) return true; // co-located: plainly visible

  const range = sightRange(observer.species);
  const effective = target.crouched ? range * CROUCH_SIGHT_MULT : range;
  if (dist >= effective) return false; // at the edge is out of sight

  // FOV: forward vector (repo convention) vs direction to target.
  const fx = -Math.sin(observer.heading);
  const fz = -Math.cos(observer.heading);
  const dot = (fx * dx + fz * dz) / dist;
  if (dot < Math.cos(SIGHT_FOV_RAD / 2)) return false;

  // Blocking: count bushes the sight segment passes through (segment-circle).
  let hits = 0;
  for (const bush of world.bushes) {
    if (segmentHitsCircle(dx, dz, bush.pos.x - observer.pos.x, bush.pos.z - observer.pos.z, bush.radius)) {
      hits++;
      if (hits >= BUSHES_BLOCK_COUNT) return false;
    }
  }
  return true;
}

/**
 * True when the segment from the observer (origin) to the point (tx, tz)
 * reaches within `radius` of the circle center (cx, cz). Coordinates are
 * relative to the observer.
 */
function segmentHitsCircle(tx: number, tz: number, cx: number, cz: number, radius: number): boolean {
  const a = tx * tx + tz * tz;
  if (a === 0) return Math.hypot(cx, cz) <= radius;
  const t = Math.max(0, Math.min(1, (cx * tx + cz * tz) / a));
  const px = t * tx;
  const pz = t * tz;
  return Math.hypot(px - cx, pz - cz) <= radius;
}

// --- Hearing --------------------------------------------------------------

export type HearingKind = 'bushRustle' | 'landThud' | 'scream' | 'roll';

/** Loudness factor per event type; radius = loudness × listener base. */
export const HEARING_LOUDNESS: Record<HearingKind, number> = {
  bushRustle: 0.6,
  landThud: 0.9,
  roll: 1.2,
  scream: 1.5,
};

/** A sound event: what it is, where, and how loud (multiplier 0..~2). */
export interface HearingEvent {
  kind: HearingKind;
  pos: { x: number; z: number };
  loudness: number;
  /**
   * Emitter's fighter id, when the sound has one (rustles). A brain must
   * ignore its own emissions — hearing yourself rustle overwrites your
   * investigate memory with your own position.
   */
  sourceId?: string;
}

/** A listening body; `lastHeardPos` is written when a sound is heard. */
export interface Listener {
  pos: { x: number; z: number };
  species: Species;
  lastHeardPos?: { x: number; z: number };
}

/** Hearing reach (m) of a species listener (radius = loudness × this). */
export function hearingBase(species: Species): number {
  return species === 'wolf' ? HEARING_BASE_WOLF_M : HEARING_BASE_RABBIT_M;
}

/** Radius (m) within which a listener of `species` hears event `kind`. */
export function hearingRadius(kind: HearingKind, species: Species): number {
  return HEARING_LOUDNESS[kind] * hearingBase(species);
}

/** Append a just-spawned event to the shared per-frame event buffer. */
export function emitHearing(events: HearingEvent[], e: HearingEvent): void {
  events.push(e);
}

/**
 * True when `listener` hears `e` (dist ≤ radius). On a heard event it records
 * the source position on the listener so AI can investigate toward it.
 */
export function hear(listener: Listener, e: HearingEvent): boolean {
  const radius = hearingRadius(e.kind, listener.species);
  const dist = Math.hypot(
    e.pos.x - listener.pos.x,
    e.pos.z - listener.pos.z,
  );
  if (dist <= radius) {
    listener.lastHeardPos = { x: e.pos.x, z: e.pos.z };
    return true;
  }
  return false;
}
