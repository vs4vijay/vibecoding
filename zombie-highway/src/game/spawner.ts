import { CONFIG } from "../config";
import type { Knobs } from "./difficulty";
import { dimsFor, type Obstacle, type ObstacleKind, type ObstaclePool } from "./obstacles";
import type { ZombiePool, ZombieType } from "./zombies";

// Type mix per brief: walker 60%, runner 30%, brute 10%.
const TYPE_WEIGHTS: Array<[ZombieType, number]> = [
  ["walker", 0.6],
  ["runner", 0.3],
  ["brute", 0.1],
];

const ROW_INTERVAL_MS_AT_DENSITY_1 = 2600; // faster rows as density rises
const ROW_AHEAD_M = 90;
const MIN_DENSITY = 0.05; // guards divide-by-zero on degenerate knobs

/** Streams zombie lurkers and guaranteed-passable obstacle rows ahead of the car. */
export class Spawner {
  private zombieT = 0;
  private obstacleT = 0;
  private rng: () => number;

  constructor(
    private zombies: ZombiePool,
    private obstacles: ObstaclePool,
    rng?: () => number,
  ) {
    this.rng = rng ?? Math.random;
  }

  update(dt: number, ctx: { carX: number; carZ: number; knobs: Knobs }): void {
    const s = CONFIG.spawn;
    this.zombieT += dt * 1000;
    if (this.zombieT >= ctx.knobs.spawnIntervalMs) {
      this.zombieT = 0;
      if (this.busyCount() < ctx.knobs.maxZombies) {
        const sideSign = this.rng() < 0.5 ? -1 : 1;
        const z = ctx.carZ + s.zMinAhead + this.rng() * (s.zMaxAhead - s.zMinAhead);
        this.zombies.spawnLurker(this.pickType(), sideSign * (CONFIG.road.halfWidth + s.shoulderOffset), z);
      }
    }

    this.obstacleT += dt * 1000;
    if (this.obstacleT >= ROW_INTERVAL_MS_AT_DENSITY_1 / Math.max(ctx.knobs.obstacleDensity, MIN_DENSITY)) {
      this.obstacleT = 0;
      for (const o of this.spawnObstacleRow(ctx.carZ + ROW_AHEAD_M, ctx.knobs)) {
        if (o) this.obstacles.spawn(o.kind, o.x, o.z);
      }
    }
  }

  /**
   * One pattern row across the road lanes at world z: single wreck, double
   * wreck flanking one open lane, or an edge barrier. Every pattern keeps a
   * >=2.6m passable gap somewhere in [-5.6, 5.6] by construction.
   */
  spawnObstacleRow(z: number, _knobs: Knobs): (Obstacle | null)[] {
    const lanes = CONFIG.road.lanes;
    const row: (Obstacle | null)[] = lanes.map(() => null);
    const open = Math.floor(this.rng() * lanes.length); // always-empty lane
    let r = this.rng();
    if (r < 0.5) {
      const lane = this.pickLane(open);
      row[lane] = this.makeObstacle("wreck", lanes[lane], z);
      return row;
    }
    r -= 0.5;
    if (r < 0.3) {
      for (const lane of [open - 1, open + 1]) {
        if (lane >= 0 && lane < lanes.length) row[lane] = this.makeObstacle("wreck", lanes[lane], z);
      }
      return row;
    }
    const barrierLane = open <= (lanes.length - 1) / 2 ? lanes.length - 1 : 0;
    row[barrierLane] = this.makeObstacle("barrier", lanes[barrierLane], z);
    return row;
  }

  reset(): void {
    this.zombieT = 0;
    this.obstacleT = 0;
  }

  private makeObstacle(kind: ObstacleKind, x: number, z: number): Obstacle {
    const d = dimsFor(kind);
    return { active: true, kind, x, z, halfW: d.halfW, halfD: d.halfD };
  }

  private pickLane(exclude: number): number {
    let lane = Math.floor(this.rng() * CONFIG.road.lanes.length);
    while (lane === exclude) lane = Math.floor(this.rng() * CONFIG.road.lanes.length);
    return lane;
  }

  /** Zombies that count against the cap: telegraphing, leaping, clinging. */
  private busyCount(): number {
    let n = 0;
    for (const z of this.zombies.all()) {
      if (z.state === "telegraphing" || z.state === "leaping" || z.state === "clinging") n++;
    }
    return n;
  }

  private pickType(): ZombieType {
    const roll = this.rng();
    let acc = 0;
    for (const [type, w] of TYPE_WEIGHTS) {
      acc += w;
      if (roll < acc) return type;
    }
    return TYPE_WEIGHTS[TYPE_WEIGHTS.length - 1][0];
  }
}
