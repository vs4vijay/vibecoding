/**
 * WindSystem — a slow random walk of wind direction and strength.
 *
 * Pure sim state: only plain numbers and the seeded RNG closure. No three,
 * no Rapier, no clock. Every WIND_TURN_MS the direction drifts by up to
 * ±WIND_MAX_TURN_RAD and a fresh strength is drawn in [0, 1], so the same
 * seed reproduces the same sequence deterministically.
 */
import type { Rng } from '../core/rng';
import { WIND_TURN_MS, WIND_MAX_TURN_RAD } from '../data/tuning';

export class WindSystem {
  private readonly rng: Rng;
  private directionRad: number;
  private sinceTurnMs: number;
  /** Current wind strength in [0, 1] (magnitude of `vector`). */
  strength: number;

  constructor(rng: Rng) {
    this.rng = rng;
    this.directionRad = rng() * 2 * Math.PI;
    this.strength = rng(); // 0..1
    this.sinceTurnMs = 0;
  }

  /** Unit wind direction (the way the wind blows TOWARD), scaled by strength. */
  get vector(): { x: number; z: number } {
    const mag = this.strength;
    return { x: Math.cos(this.directionRad) * mag, z: Math.sin(this.directionRad) * mag };
  }

  update(dtMs: number): void {
    if (dtMs <= 0) return;
    this.sinceTurnMs += dtMs;
    while (this.sinceTurnMs >= WIND_TURN_MS) {
      this.sinceTurnMs -= WIND_TURN_MS;
      // Random walk: drift direction by up to ±WIND_MAX_TURN_RAD.
      const turn = (this.rng() * 2 - 1) * WIND_MAX_TURN_RAD;
      this.directionRad += turn;
      // Pick a fresh uniform strength in [0, 1].
      this.strength = this.rng();
    }
  }
}
