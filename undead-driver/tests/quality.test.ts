import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import {
  appliedQuality,
  clampTier,
  createQualityState,
  knobsForTier,
  stepQuality,
  type QualityState,
} from "../src/render/quality";

const Q = CONFIG.quality;
const DT = 1 / 60;

/** Feed the controller `frames` fixed steps at a constant fps. */
function run(state: QualityState, fps: number, frames: number): QualityState {
  for (let i = 0; i < frames; i++) stepQuality(state, fps, DT);
  return state;
}

describe("stepQuality — EMA", () => {
  it("smooths toward constant fps and is ~settled after one window", () => {
    const s = createQualityState();
    expect(s.ema).toBe(Q.fpsTarget);
    run(s, 40, Math.round(Q.emaWindowS / DT));
    // ~63% of the way after one time constant, converging monotonically.
    expect(s.ema).toBeGreaterThan(40);
    expect(s.ema).toBeLessThan(Q.fpsTarget);
    run(s, 40, Math.round(Q.emaWindowS / DT) * 4);
    expect(s.ema).toBeLessThan(41); // converged
  });

  it("barely moves on a single-frame spike", () => {
    const s = createQualityState();
    run(s, 60, 300);
    stepQuality(s, 5, DT);
    expect(s.ema).toBeGreaterThan(59);
  });

  it("does not allocate: mutates and returns the same state object", () => {
    const s = createQualityState();
    expect(stepQuality(s, 30, DT)).toBe(s);
  });
});

describe("stepQuality — stepping", () => {
  it("steps down exactly one tier after sustained fps below stepDownFps", () => {
    const s = createQualityState();
    expect(s.tier).toBe(Q.startTier);
    // ~2.7 s total: EMA settles under 55 (<0.5 s) then holdTimeS accrues.
    run(s, 40, 180);
    expect(s.tier).toBe(Q.startTier - 1);
  });

  it("does not step on a single bad frame or a brief dip", () => {
    const s = createQualityState();
    stepQuality(s, 5, DT);
    run(s, 40, Math.round(Q.holdTimeS * 0.5 / DT)); // half the hold time
    expect(s.tier).toBe(Q.startTier);
  });

  it("steps back up after sustained fps above stepUpFps (once cooldown clears)", () => {
    const s = createQualityState();
    run(s, 40, 180); // tier 2, cooldown armed
    run(s, 61, Math.ceil(Q.cooldownMs / 1000 / DT) + 10); // neutral, cooldown drains
    run(s, 80, 180); // EMA clears 67 (<0.5 s) then holdTimeS accrues
    expect(s.tier).toBe(Q.startTier);
  });

  it("cooldown blocks the reverse step right after a step (no flip-flop)", () => {
    const s = createQualityState();
    run(s, 40, 180); // stepped down; cooldown (4 s) just armed
    // 2.5 s of strong headroom: EMA clears 67 and holdTimeS elapses well
    // within 2.5 s, but the cooldown from the down-step has not cleared.
    run(s, 90, 150);
    expect(s.tier).toBe(Q.startTier - 1);
  });

  it("fps oscillating around the thresholds never flip-flops tiers", () => {
    const s = createQualityState();
    // 40 s of alternating 1 s bursts below/above the band: each burst is
    // shorter than holdTimeS and resets the opposing hold.
    for (let i = 0; i < 20; i++) {
      run(s, 40, 60);
      run(s, 80, 60);
    }
    expect(s.tier).toBe(Q.startTier);
  });

  it("clamps at tier 0 under sustained load", () => {
    const s = createQualityState();
    // Long enough for EMA + hold + cooldown ×3 remaining steps: ~2.4 s each.
    run(s, 40, 1200);
    expect(s.tier).toBe(0);
    run(s, 40, 600); // keeps grinding — stays clamped
    expect(s.tier).toBe(0);
  });

  it("clamps at startTier under sustained headroom", () => {
    const s = createQualityState();
    run(s, 90, 1200);
    expect(s.tier).toBe(Q.startTier);
  });

  it("walks the pinned tiers one at a time, never skipping", () => {
    const s = createQualityState();
    let prev = s.tier;
    // Drop to 0 under sustained load, asserting after EVERY frame that a
    // step moves exactly one tier (steps are cooldown-gated to ~4 s apart,
    // so stages of frames — not wall-clock samples — carry the invariant).
    for (let i = 0; i < 1500; i++) {
      stepQuality(s, 40, DT);
      expect(s.tier - prev).toBeLessThanOrEqual(1);
      expect(prev - s.tier).toBeLessThanOrEqual(1);
      prev = s.tier;
    }
    expect(s.tier).toBe(0);
  });
});

describe("knobsForTier", () => {
  it("mirrors the config tier arrays exactly (single source)", () => {
    const tiers = Q.pixelRatioScales.length;
    expect(Q.particleDensity).toHaveLength(tiers);
    expect(Q.shadowMapSizes).toHaveLength(tiers);
    expect(Q.shadowsOn).toHaveLength(tiers);
    for (let t = 0; t < tiers; t++) {
      const k = knobsForTier(t);
      expect(k.pixelRatioScale).toBe(Q.pixelRatioScales[t]);
      expect(k.particleDensity).toBe(Q.particleDensity[t]);
      expect(k.shadowMapSize).toBe(Q.shadowMapSizes[t]);
      expect(k.shadowsOn).toBe(Q.shadowsOn[t]);
      // Post (2nd axis in degradationOrder) is cut at the bottom tier only.
      expect(k.postEnabled).toBe(t > 0);
    }
  });

  it("fills a preallocated out object and returns it", () => {
    const out = {
      pixelRatioScale: -1,
      postEnabled: true,
      particleDensity: -1,
      shadowMapSize: -1,
      shadowsOn: true,
    };
    const k = knobsForTier(0, out);
    expect(k).toBe(out);
    expect(k.pixelRatioScale).toBe(Q.pixelRatioScales[0]);
    expect(k.postEnabled).toBe(false);
  });

  it("never offers higher quality at a lower tier (monotone)", () => {
    const tiers = Q.pixelRatioScales.length;
    for (let t = 1; t < tiers; t++) {
      const lo = knobsForTier(t - 1);
      const hi = knobsForTier(t);
      expect(hi.pixelRatioScale).toBeGreaterThanOrEqual(lo.pixelRatioScale);
      expect(hi.particleDensity).toBeGreaterThanOrEqual(lo.particleDensity);
      expect(hi.shadowMapSize).toBeGreaterThanOrEqual(lo.shadowMapSize);
      if (!lo.shadowsOn) expect(hi.shadowsOn).toBe(true); // shadows only ever turn off downward
    }
  });

  it("degradation order tail: bottom tier cuts post + shadows + resolution", () => {
    const bottom = knobsForTier(0);
    expect(bottom.postEnabled).toBe(false);
    expect(bottom.shadowsOn).toBe(false);
    expect(bottom.pixelRatioScale).toBe(Math.min(...Q.pixelRatioScales));
    // Top tier is full quality on every axis.
    const top = knobsForTier(Q.startTier);
    expect(top.postEnabled).toBe(true);
    expect(top.shadowsOn).toBe(true);
    expect(top.particleDensity).toBe(Math.max(...Q.particleDensity));
    expect(top.shadowMapSize).toBe(Math.max(...Q.shadowMapSizes));
  });
});

describe("clampTier", () => {
  it("clamps below 0 and above the array range", () => {
    expect(clampTier(-3)).toBe(0);
    expect(clampTier(2)).toBe(2);
    expect(clampTier(99)).toBe(Q.pixelRatioScales.length - 1);
  });
});

describe("appliedQuality", () => {
  it("boots at startTier with matching knobs", () => {
    expect(appliedQuality.tier).toBe(clampTier(Q.startTier));
    const k = knobsForTier(appliedQuality.tier);
    expect(appliedQuality.pixelRatioScale).toBe(k.pixelRatioScale);
    expect(appliedQuality.particleDensity).toBe(k.particleDensity);
    expect(appliedQuality.shadowMapSize).toBe(k.shadowMapSize);
    expect(appliedQuality.shadowsOn).toBe(k.shadowsOn);
  });
});
