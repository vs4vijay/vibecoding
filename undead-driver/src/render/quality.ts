import { CONFIG } from "../config";

/**
 * Adaptive quality controller (design D7, task 1.5).
 *
 * PURE state machine — no three.js, no DOM, no timers. The browser side
 * (main.ts) runs `stepQuality` once per RAF frame with the measured frame
 * fps and then APPLIES the outputs (pixel ratio, post toggle, particle
 * density multiplier, shadow map size). Everything tunable lives in
 * CONFIG.quality; this module adds no numbers of its own.
 *
 * Semantics:
 *  - `ema` is an exponential moving average of measured fps with time
 *    constant `emaWindowS` (alpha = 1 - e^(-dt/window)).
 *  - EMA < `stepDownFps` sustained for `holdTimeS` → tier -= 1 (clamp 0).
 *    EMA > `stepUpFps` sustained for `holdTimeS` → tier += 1. The deadband
 *    between the thresholds is the hysteresis; a single bad frame moves the
 *    EMA negligibly and resets the opposing hold, so no step fires on spikes.
 *  - Every step (up OR down) arms a `cooldownMs` blockade during which no
 *    further step can fire — sustained oscillation around a threshold can
 *    never flip-flop tiers.
 *  - Tier climbs never exceed `startTier`: the controller degrades from boot
 *    quality and restores to it, never above.
 *  - Degradation ORDER follows CONFIG.quality.degradationOrder (resolution →
 *    post → particles → shadows). The per-tier arrays in config are the
 *    single source for what each tier means (see `knobsForTier`): walking
 *    down applies the next-lower array row, so the first axis to give way is
 *    resolution scale, the last are shadows (off) — with post cut and
 *    particle density floored at the bottom tier. Where an axis saturates by
 *    config design (pixelRatioScales is 1.0 for the top two tiers) the array
 *    row still applies verbatim; the order array is the priority contract,
 *    the arrays are the values.
 */

/** Controller state — plain object, preallocated once, mutated in place. */
export type QualityState = {
  /** Current tier index (0 = lowest quality). */
  tier: number;
  /** EMA fps (seeded at fpsTarget so boot transients don't read as a crash). */
  ema: number;
  /** Seconds the below-`stepDownFps` condition has held continuously. */
  downHoldS: number;
  /** Seconds the above-`stepUpFps` condition has held continuously. */
  upHoldS: number;
  /** Seconds left in the post-step cooldown blockade. */
  cooldownS: number;
};

export function createQualityState(): QualityState {
  return {
    tier: CONFIG.quality.startTier,
    ema: CONFIG.quality.fpsTarget,
    downHoldS: 0,
    upHoldS: 0,
    cooldownS: 0,
  };
}

/**
 * Advance the controller one frame. `fps` is the measured frame rate for
 * this frame (1/rawDt at the caller), `dt` the frame dt in seconds (clamped
 * by the caller — hold timers and the EMA advance on sim-bounded time).
 * Mutates and returns `state`; allocates nothing.
 */
export function stepQuality(
  state: QualityState,
  fps: number,
  dt: number,
): QualityState {
  const q = CONFIG.quality;

  if (dt > 0 && Number.isFinite(fps)) {
    // EMA with time constant emaWindowS: ~63% settled after one window.
    const alpha = 1 - Math.exp(-dt / q.emaWindowS);
    state.ema += alpha * (fps - state.ema);
  }

  if (state.cooldownS > 0) {
    state.cooldownS = Math.max(0, state.cooldownS - dt);
  }

  // Sustained-condition tracking. The thresholds are disjoint (deadband), so
  // at most one hold can grow; the other resets immediately.
  if (state.ema < q.stepDownFps) {
    state.downHoldS += dt;
    state.upHoldS = 0;
  } else if (state.ema > q.stepUpFps) {
    state.upHoldS += dt;
    state.downHoldS = 0;
  } else {
    state.downHoldS = 0;
    state.upHoldS = 0;
  }

  if (state.cooldownS <= 0) {
    if (state.downHoldS >= q.holdTimeS && state.tier > 0) {
      state.tier -= 1;
      state.downHoldS = 0;
      state.upHoldS = 0;
      state.cooldownS = q.cooldownMs / 1000;
    } else if (
      state.upHoldS >= q.holdTimeS &&
      state.tier < q.startTier // never above boot quality
    ) {
      state.tier += 1;
      state.downHoldS = 0;
      state.upHoldS = 0;
      state.cooldownS = q.cooldownMs / 1000;
    }
  }

  return state;
}

/** The knobs one tier translates to (all values sourced from config arrays). */
export type TierKnobs = {
  /** Scale applied on top of min(devicePixelRatio, maxPixelRatio). */
  pixelRatioScale: number;
  /** Composer on/off for this tier (post is cut at the bottom tier). */
  postEnabled: boolean;
  /** Multiplier on particle burst counts / pool fill. */
  particleDensity: number;
  /** Shadow map resolution for this tier. */
  shadowMapSize: number;
  /** Shadows fully off at the bottom tier (degradationOrder tail). */
  shadowsOn: boolean;
};

/** Clamp to the arrays' index range so a bad tier can never read undefined. */
export function clampTier(tier: number): number {
  const max = CONFIG.quality.pixelRatioScales.length - 1;
  return tier < 0 ? 0 : tier > max ? max : tier;
}

/**
 * Derive the applied knobs for `tier` from the CONFIG arrays — the single
 * source of truth (task 1.5: main.ts must not re-derive). Pass a preallocated
 * `out` on per-frame hot paths; without one it allocates (boot/tier-change
 * only, which is where main.ts calls it).
 */
export function knobsForTier(tier: number, out?: TierKnobs): TierKnobs {
  const q = CONFIG.quality;
  const i = clampTier(tier);
  const o = out ?? {
    pixelRatioScale: 0,
    postEnabled: false,
    particleDensity: 0,
    shadowMapSize: 0,
    shadowsOn: false,
  };
  o.pixelRatioScale = q.pixelRatioScales[i];
  // Post is the second axis in degradationOrder and is cut at the bottom
  // tier, where resolution is also at its floor and shadows turn off.
  o.postEnabled = i > 0;
  o.particleDensity = q.particleDensity[i];
  o.shadowMapSize = q.shadowMapSizes[i];
  o.shadowsOn = q.shadowsOn[i];
  return o;
}

/**
 * The knobs CURRENTLY applied to the renderer — written by main.ts on boot
 * and on every tier change / resize; read by render systems that need the
 * live values (fx.ts particle density in task 6.1, the shadow sun's map size
 * in task 2.1). Plain mutable storage; only main.ts writes it.
 */
export const appliedQuality: TierKnobs & { tier: number; pixelRatio: number } = {
  tier: clampTier(CONFIG.quality.startTier),
  pixelRatio: 0,
  ...knobsForTier(CONFIG.quality.startTier),
};
