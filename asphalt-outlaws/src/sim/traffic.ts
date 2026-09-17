import type { RaceState, Rider, TrafficCar, TrafficKind } from "./types";
import type { RNG } from "../core/rng";
import { SIM, TRAFFIC } from "../config";
import { raceMaxSpeed } from "./bike";

// OWNER: Agent C. Traffic field lifecycle + collisions. Contract per
// .plan.md §5 and §6. Do not change signatures.

// ---------------------------------------------------------------------------
// Spawn-table data (not gameplay balance): paint palette and lane centers in
// road-half-width fractions. Same-direction traffic keeps right of the center
// line, oncoming keeps left.
// ---------------------------------------------------------------------------
const CAR_COLORS = [
  "#b8342c", // rust red
  "#2e6fc8", // sedan blue
  "#d8c23a", // taxi yellow
  "#3da05a", // forest green
  "#c9ced8", // silver
  "#7a4ae0", // violet
] as const;
const SAME_DIR_LANES = [0.05, 0.45, 0.85] as const;
const ONCOMING_LANES = [-0.85, -0.45, -0.05] as const;
/** Vehicle mix: 60% cars, 25% trucks, 15% buses (cumulative thresholds). */
const KIND_CAR_MAX = 0.6;
const KIND_TRUCK_MAX = 0.85;
/** Spawn density is defined per this many segments. */
const CHUNK_SEGS = 100;
/** Guaranteed clear runway at the race start (~4 s at full tilt) — the
 * initial field only; recycled cars respawn at the far window edge anyway. */
export const SPAWN_CLEARANCE = 20000;
/** Minimum |dz| between two cars sharing a lane. */
const LANE_GAP = 900;
/** Heavy vehicles cruise at this fraction of their base speed. */
const HEAVY_SPEED_MUL = 0.8;
/** |dx| for a car crossing the player's line to count as a near miss. */
const NEAR_MISS_X = 0.35;
/** Respawn this far (min..max) inside the far edge of the ahead window. */
const RECYCLE_MARGIN_MIN = 500;
const RECYCLE_MARGIN_MAX = 2500;

// Previous signed offset (car.z - player.z) per car id, for ahead->behind
// crossing detection. Race states stepped in lockstep share ids but hold
// identical offsets, so a single id-keyed map stays correct.
const prevOffsets = new Map<number, number>();

function pickKind(rng: RNG): TrafficKind {
  const roll = rng.next();
  if (roll < KIND_CAR_MAX) return "car";
  if (roll < KIND_TRUCK_MAX) return "truck";
  return "bus";
}

function speedFor(state: RaceState, dir: 1 | -1, kind: TrafficKind, rng: RNG): number {
  const base =
    dir === 1
      ? rng.range(TRAFFIC.sameSpeedMin, TRAFFIC.sameSpeedMax)
      : TRAFFIC.oncomingSpeed;
  return base * raceMaxSpeed(state) * (kind === "car" ? 1 : HEAVY_SPEED_MUL);
}

function lanesFor(dir: 1 | -1): readonly number[] {
  return dir === 1 ? SAME_DIR_LANES : ONCOMING_LANES;
}

/**
 * Seed the initial traffic field ahead of the player per the level's
 * trafficDensity / oncomingShare, using state.rng. Cars live in both same-
 * direction lanes (slow) and oncoming lanes; store nothing beyond
 * state.traffic.
 */
export function spawnTraffic(state: RaceState): void {
  const level = state.cfg.level;
  const rng = state.rng;
  const player = state.player;
  const seg = SIM.segmentLength;
  const windowEnd = player.z + TRAFFIC.aheadSegments * seg;
  const perChunk = Math.round(level.trafficDensity);

  // Pass 1: draw every candidate (fixed rng order keeps runs reproducible).
  const candidates: TrafficCar[] = [];
  for (let start = player.z; start < windowEnd; start += CHUNK_SEGS * seg) {
    const lo = Math.max(start, player.z + SPAWN_CLEARANCE);
    const hi = Math.min(start + CHUNK_SEGS * seg, windowEnd);
    if (hi - lo <= LANE_GAP) continue;
    for (let n = 0; n < perChunk; n++) {
      const dir: 1 | -1 = rng.chance(level.oncomingShare) ? -1 : 1;
      const kind = pickKind(rng);
      candidates.push({
        id: state.nextId++,
        kind,
        dir,
        z: rng.range(lo, hi),
        x: rng.pick(lanesFor(dir)),
        speed: speedFor(state, dir, kind, rng),
        color: rng.pick(CAR_COLORS),
        active: true,
      });
    }
  }

  // Pass 2: drop candidates that overlap an already-accepted car (same lane).
  const kept: TrafficCar[] = [];
  for (const car of candidates) {
    const clash = kept.some(
      (k) => k.x === car.x && Math.abs(k.z - car.z) < LANE_GAP,
    );
    if (!clash) {
      kept.push(car);
      prevOffsets.set(car.id, car.z - player.z);
    }
  }
  state.traffic = kept;
}

/** Respawn one car near the far edge of the ahead window (id/kind kept). */
function recycleCar(state: RaceState, car: TrafficCar): void {
  const rng = state.rng;
  car.x = rng.pick(lanesFor(car.dir));
  car.speed = speedFor(state, car.dir, car.kind, rng);
  car.z =
    state.player.z +
    TRAFFIC.aheadSegments * SIM.segmentLength -
    rng.range(RECYCLE_MARGIN_MIN, RECYCLE_MARGIN_MAX);
  prevOffsets.set(car.id, car.z - state.player.z);
}

/**
 * Move active cars (same-direction cruise, oncoming approach), recycle cars
 * that fall behind / get too far ahead to keep density constant ahead of
 * the player, emit "near-miss" events for close calls.
 */
export function stepTraffic(state: RaceState, dt: number): void {
  const player = state.player;
  const seg = SIM.segmentLength;
  const backEdge = player.z - TRAFFIC.behindSegments * seg;
  const aheadEdge = player.z + TRAFFIC.aheadSegments * seg;

  for (const car of state.traffic) {
    if (!car.active) continue;

    car.z += car.dir * car.speed * dt;
    // Deterministic lane sway: pure function of race time + id, no rng.
    car.x += Math.sin((state.time + car.id) * 1.7) * 0.002;

    const offset = car.z - player.z;
    const prev = prevOffsets.get(car.id);
    if (
      prev !== undefined &&
      prev > 0 &&
      offset <= 0 &&
      Math.abs(car.x - player.x) < NEAR_MISS_X
    ) {
      state.events.push({ type: "near-miss", z: car.z, x: car.x });
    }
    prevOffsets.set(car.id, offset);

    if (car.z < backEdge || car.z > aheadEdge) recycleCar(state, car);
  }
}

/** The car colliding with `rider` right now, or null (TRAFFIC hit box). */
export function checkTrafficHit(
  state: RaceState,
  rider: Rider,
): TrafficCar | null {
  for (const car of state.traffic) {
    if (!car.active) continue;
    // Wider bodies get a wider box: cars +0.04, trucks/buses +0.08.
    const widthPad = car.kind === "car" ? 0.04 : 0.08;
    if (
      Math.abs(car.z - rider.z) < TRAFFIC.hitZ &&
      Math.abs(car.x - rider.x) < TRAFFIC.hitX + widthPad
    ) {
      return car;
    }
  }
  return null;
}
