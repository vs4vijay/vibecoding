/**
 * ScentField — a 48×48 advection–diffusion scalar field over the arena.
 *
 * Pure sim: plain arrays + math only, no three/Rapier/clock. Grid covers the
 * arena [-ARENA/2, ARENA/2) on each axis; cell edge = ARENA/GRID = 2.5m.
 *
 * Update per step:
 *   1. Inject each emitter's `rate` (units/s) into its cell.
 *   2. Explicit scalar diffusion: c += D·∇²c·dt.
 *   3. Upwind advection: c -= w·∇c·dt (field carried along the wind vector).
 * Boundaries are no-flux (boxed gradient → reflecting).
 *
 * Wolves sample intensityAt() and investigate when it exceeds the tuning
 * threshold.
 */
import {
  ARENA_SIZE_M,
  SCENT_DIFFUSION_D,
  SCENT_EMIT_RATE_BASE,
  SCENT_EMIT_RATE_BLOODIED,
  SCENT_GRID_CELLS,
} from '../data/tuning';

/** A scent source: where and how strongly it emits (units per second). */
export interface ScentEmitter {
  pos: { x: number; z: number };
  rate: number;
}

/** A 2-D wind vector (x, z magnitude = strength). */
export interface WindVec {
  x: number;
  z: number;
}

/** Emission rate (units/s) for a clean vs bloodied fighter (via caller). */
export function emissionRateFor(bloodied: boolean): number {
  return bloodied ? SCENT_EMIT_RATE_BLOODIED : SCENT_EMIT_RATE_BASE;
}

export class ScentField {
  private readonly cells: Float64Array;
  private readonly n: number;
  private readonly cell: number;

  constructor() {
    this.n = SCENT_GRID_CELLS;
    this.cell = ARENA_SIZE_M / SCENT_GRID_CELLS;
    this.cells = new Float64Array(this.n * this.n);
  }

  private idx(i: number, j: number): number {
    return j * this.n + i;
  }


  /** Clamp a world coordinate to the arena, then to a grid index. */
  private toIndex(world: number): number {
    const clamped = Math.max(-ARENA_SIZE_M / 2, Math.min(ARENA_SIZE_M / 2, world));
    let i = Math.floor((clamped + ARENA_SIZE_M / 2) / this.cell);
    if (i < 0) i = 0;
    if (i >= this.n) i = this.n - 1;
    return i;
  }

  /** Advance the field by `dtMs`, injecting `emitters` and advecting by `wind`. */
  update(dtMs: number, emitters: ScentEmitter[], wind: WindVec): void {
    const dt = dtMs / 1000;
    if (dt <= 0) return;
    this.inject(emitters, dt);
    this.diffuseAdvect(dt, wind);
  }

  private inject(emitters: ScentEmitter[], dt: number): void {
    for (const e of emitters) {
      const i = this.toIndex(e.pos.x);
      const j = this.toIndex(e.pos.z);
      this.cells[this.idx(i, j)] += e.rate * dt;
    }
  }

  /** One explicit diffusion + upwind-advection sweep with no-flux bounds. */
  private diffuseAdvect(dt: number, wind: WindVec): void {
    const src = this.cells;
    const next = new Float64Array(src.length);
    const d = SCENT_DIFFUSION_D * dt / (this.cell * this.cell);
    const wx = wind.x * dt / this.cell;
    const wz = wind.z * dt / this.cell;

    for (let j = 0; j < this.n; j++) {
      const jm = j > 0 ? j - 1 : 0; // reflect north boundary (z-)
      const jp = j < this.n - 1 ? j + 1 : this.n - 1; // reflect south (z+)
      for (let i = 0; i < this.n; i++) {
        const im = i > 0 ? i - 1 : 0; // reflect west (x-)
        const ip = i < this.n - 1 ? i + 1 : this.n - 1; // reflect east (x+)
        const c = src[this.idx(i, j)];
        if (c === 0 && src[this.idx(im, j)] === 0 && src[this.idx(ip, j)] === 0 &&
            src[this.idx(i, jm)] === 0 && src[this.idx(i, jp)] === 0) {
          continue; // untouched empty cell fast path
        }
        const lap = src[this.idx(ip, j)] + src[this.idx(im, j)] +
                    src[this.idx(i, jp)] + src[this.idx(i, jm)] - 4 * c;

        // Upwind advection — take the gradient from the cell the wind comes
        // from (i.e. opposite the wind direction).
        const gradX = wx >= 0
          ? (c - src[this.idx(im, j)]) / this.cell
          : (src[this.idx(ip, j)] - c) / this.cell;
        const gradZ = wz >= 0
          ? (c - src[this.idx(i, jm)]) / this.cell
          : (src[this.idx(i, jp)] - c) / this.cell;

        const adv = wx * this.cell * gradX + wz * this.cell * gradZ;
        next[this.idx(i, j)] = c + d * lap - adv;
      }
    }

    // Clamp tiny negatives from discretization noise to zero.
    for (let k = 0; k < next.length; k++) {
      if (next[k] < 0) next[k] = 0;
    }
    this.cells.set(next);
  }

  /** Bilinear sample of the field at a world position (out of bounds → 0). */
  intensityAt(pos: { x: number; z: number }): number {
    const x = pos.x;
    const z = pos.z;
    const half = ARENA_SIZE_M / 2;
    if (x < -half || x > half || z < -half || z > half) return 0;

    // World → continuous grid coordinate.
    const gx = (x + half) / this.cell;
    const gz = (z + half) / this.cell;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gz);
    const fx = gx - i0;
    const fz = gz - j0;
    const i1 = Math.min(i0 + 1, this.n - 1);
    const j1 = Math.min(j0 + 1, this.n - 1);
    const i0c = Math.min(i0, this.n - 1);

    const v00 = this.cells[this.idx(i0c, Math.min(j0, this.n - 1))];
    const v10 = this.cells[this.idx(i1, Math.min(j0, this.n - 1))];
    const v01 = this.cells[this.idx(i0c, j1)];
    const v11 = this.cells[this.idx(i1, j1)];
    const top = v00 + fx * (v10 - v00);
    const bot = v01 + fx * (v11 - v01);
    return top + fz * (bot - top);
  }
}
