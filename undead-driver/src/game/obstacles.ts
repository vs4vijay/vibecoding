import { CONFIG } from "../config";

export type ObstacleKind = "wreck" | "barrier";
export type Obstacle = {
  active: boolean;
  kind: ObstacleKind;
  x: number;
  z: number;
  halfW: number;
  halfD: number;
};

// Wreck: car-sized hulk. Barrier: long, low fence piece hugging a rail.
const DIMS: Record<ObstacleKind, { halfW: number; halfD: number }> = {
  wreck: { halfW: 1.2, halfD: 2.2 },
  barrier: { halfW: 3.4, halfD: 0.6 },
};

export function dimsFor(kind: ObstacleKind): { halfW: number; halfD: number } {
  return { ...DIMS[kind] };
}

const DESPAWN_BEHIND_M = 30;
const HEADON_LAT_FACTOR = 0.55; // fraction of car halfWidth
const GRAZE_LAT_SLACK_M = 0.55;
const GRAZE_Z_SLACK_M = 0.2;

/** Pooled static hazards in world z (car travels toward +z). */
export class ObstaclePool {
  private obstacles: Obstacle[];

  constructor(capacity = 16) {
    this.obstacles = [];
    for (let i = 0; i < capacity; i++) {
      this.obstacles.push({ active: false, kind: "wreck", x: 0, z: 0, halfW: 0, halfD: 0 });
    }
  }

  /** Activates a free slot; silently drops the spawn when saturated. */
  spawn(kind: ObstacleKind, x: number, z: number): void {
    const spot = this.obstacles.find((o) => !o.active);
    if (!spot) return;
    const d = DIMS[kind];
    spot.active = true;
    spot.kind = kind;
    spot.x = x;
    spot.z = z;
    spot.halfW = d.halfW;
    spot.halfD = d.halfD;
  }

  update(carZ: number): void {
    for (const o of this.obstacles) {
      if (o.active && o.z < carZ - DESPAWN_BEHIND_M) o.active = false;
    }
  }

  forEachNear(z0: number, z1: number, cb: (o: Obstacle) => void): void {
    for (const o of this.obstacles) {
      if (o.active && o.z >= z0 && o.z <= z1) cb(o);
    }
  }

  reset(): void {
    for (const o of this.obstacles) o.active = false;
  }

  /** Fixed pool size; mesh pools bind one mesh per stable slot index. */
  slotCount(): number {
    return this.obstacles.length;
  }
}

export type ObstacleContact = "none" | "graze" | "headOn";

/**
 * HeadOn: solid nose-in overlap. Graze: lateral clip within +0.55m beyond the
 * head-on window, needing only 0.2m of longitudinal overlap.
 */
export function classifyContact(o: Obstacle, carX: number, carZ: number): ObstacleContact {
  const lat = Math.abs(carX - o.x);
  const lon = Math.abs(carZ - o.z);
  const headOnLat = o.halfW + CONFIG.car.halfWidth * HEADON_LAT_FACTOR;
  if (lat < headOnLat && lon < o.halfD + CONFIG.car.length / 2) return "headOn";
  if (lat < headOnLat + GRAZE_LAT_SLACK_M && lon < o.halfD + GRAZE_Z_SLACK_M) return "graze";
  return "none";
}
