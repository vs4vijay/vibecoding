/**
 * Fixed-timestep input accumulator.
 *
 * The client must emit inputs (and step its local prediction) on the same
 * fixed cadence the server simulates at, once per `tickDtMs` of accumulated
 * play time — not once per rAF frame, which would scale movement speed and
 * input message rate with the display refresh rate.
 *
 * Pure and DOM-free: no timers or rAF inside. `advance()` is called from the
 * existing render loop with the real frame delta and synchronously runs
 * `stepFn` zero or more times.
 */

/** Catch-up cap: never run more than this many steps in a single frame. */
export const MAX_TICKS_PER_FRAME = 5;

/**
 * Clamp for huge frame deltas (e.g. returning from a background tab, where
 * rAF was suspended): elapsed time beyond this is discarded so returning to
 * the game never triggers a long catch-up burst.
 */
export const FRAME_DELTA_MAX_MS = 250;

export interface TickerOptions {
  /** Overrides MAX_TICKS_PER_FRAME. */
  maxTicksPerFrame?: number;
  /** Overrides FRAME_DELTA_MAX_MS. */
  frameDeltaMaxMs?: number;
}

export interface Ticker {
  /**
   * Account for one rendered frame of `frameDeltaMs` elapsed time (clamped to
   * FRAME_DELTA_MAX_MS) and run `stepFn` once per fully accumulated
   * `tickDtMs`, up to MAX_TICKS_PER_FRAME. Excess accumulation beyond the cap
   * is discarded, not banked, so a stall never causes a later burst.
   */
  advance(frameDeltaMs: number): void;
  /** Clear the accumulator (call when input becomes inactive so returning never bursts). */
  reset(): void;
}

export function createTicker(
  stepFn: () => void,
  tickDtMs: number,
  opts: TickerOptions = {},
): Ticker {
  const maxTicksPerFrame = opts.maxTicksPerFrame ?? MAX_TICKS_PER_FRAME;
  const frameDeltaMaxMs = opts.frameDeltaMaxMs ?? FRAME_DELTA_MAX_MS;

  // Invariant between calls: 0 <= accumulatedMs < tickDtMs (or exactly 0
  // after the cap discarded the excess).
  let accumulatedMs = 0;

  return {
    advance(frameDeltaMs: number) {
      if (!(frameDeltaMs > 0)) return; // also guards NaN
      accumulatedMs += Math.min(frameDeltaMs, frameDeltaMaxMs);

      let ticks = 0;
      while (accumulatedMs >= tickDtMs && ticks < maxTicksPerFrame) {
        stepFn();
        accumulatedMs -= tickDtMs;
        ticks++;
      }

      // The loop only exits with a full tick still accumulated when the
      // catch-up cap was hit: discard the excess rather than banking it.
      if (accumulatedMs >= tickDtMs) {
        accumulatedMs = 0;
      }
    },

    reset() {
      accumulatedMs = 0;
    },
  };
}
