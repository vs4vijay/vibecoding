/**
 * Timed speed modifiers — the Phase 3 hook the Controller consumes through
 * `speedMultiplier`. Asteroid contact applies −40% for 2 s (spec section 3.2);
 * Phase 4's red ring will reuse this with its own key.
 *
 * Modifiers are keyed: re-applying a key refreshes its timer instead of
 * stacking, so grazing a second asteroid mid-slowdown never compounds into a
 * crawl. Multiple distinct keys multiply (a red ring during an asteroid slow
 * is meant to feel terrible). Pure logic — no Three.js.
 */

/** A single active timed modifier. */
export interface ActiveSpeedMod {
  readonly key: string;
  readonly multiplier: number;
  /** Seconds remaining before the modifier expires. */
  remaining: number;
}

export class SpeedModifiers {
  private readonly active = new Map<string, ActiveSpeedMod>();

  /** Currently in effect (product of all active multipliers; 1 when none). */
  public get multiplier(): number {
    let result = 1;
    for (const mod of this.active.values()) result *= mod.multiplier;
    return result;
  }

  /** Number of distinct modifiers currently active. */
  public get count(): number {
    return this.active.size;
  }

  /** True while the modifier `key` is actively slowing (red-ring vignette, HUD). */
  public isActive(key: string): boolean {
    const mod = this.active.get(key);
    return mod !== undefined && mod.remaining > 0;
  }

  /**
   * Applies (or refreshes) the modifier `key` at `multiplier` for `duration`
   * seconds. Multiplier must be in (0, 1] — this system only ever slows.
   */
  public apply(key: string, multiplier: number, duration: number): void {
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1) {
      throw new RangeError(`SpeedModifiers multiplier must be in (0, 1], got ${String(multiplier)}`);
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new RangeError(`SpeedModifiers duration must be positive, got ${String(duration)}`);
    }
    this.active.set(key, { key, multiplier, remaining: duration });
  }

  /**
   * Advances every modifier's timer by `dt` and returns the multiplier in
   * effect for the interval this step covers (1 when none) — the value the
   * Controller assigns to `speedMultiplier` each simulation step. A modifier
   * applied for `duration` slows exactly `duration` seconds of sim time: it
   * counts as active on every step that starts before its timer runs out,
   * and is dropped the moment the timer crosses zero.
   */
  public update(dt: number): number {
    let result = 1;
    for (const [key, mod] of this.active) {
      if (mod.remaining > 0) result *= mod.multiplier;
      mod.remaining -= dt;
      if (mod.remaining <= 0) this.active.delete(key);
    }
    return result;
  }

  /** Instantly removes every modifier (retry / knock-off). */
  public clear(): void {
    this.active.clear();
  }
}
