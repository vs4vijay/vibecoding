import { describe, expect, it } from "bun:test";
import {
  createPositionCalloutTracker,
  createWrongWayDetector,
} from "../src/race-events";

// Frame-level feeds with plain numbers only. dt = 1/60 mirrors the real sim;
// where an exact arming frame matters, dt = 0.25 with sustain/clear powers of
// two sums exactly in binary floating point.

const DT = 1 / 60;

describe("createWrongWayDetector", () => {
  it("returns false on the first sample and never arms off it", () => {
    const feed = createWrongWayDetector();
    expect(feed(0.2, DT)).toBe(false);
    expect(feed(0.19, DT)).toBe(false); // one reverse frame cannot arm
  });

  it("forward progress across the 0↔1 wrap never arms", () => {
    const feed = createWrongWayDetector();
    let t = 0.97;
    // 0.02/frame forward for ~6.7s of continuous laps — each step crosses the
    // start line every 50 frames, far past the 0.6s sustain.
    for (let i = 0; i < 400; i++) {
      t = (t + 0.02) % 1;
      expect(feed(t, DT)).toBe(false);
    }
  });

  it("sustained reverse arms after ~sustain seconds and stays armed", () => {
    const feed = createWrongWayDetector();
    let t = 0.5;
    let armedAt = -1;
    let everFalseAfterArming = false;
    let seenArmed = false;
    for (let i = 1; i <= 120; i++) {
      t = (t - 0.02 + 1) % 1;
      const armed = feed(t, DT);
      if (armed && armedAt < 0) armedAt = i;
      if (armed) seenArmed = true;
      else if (seenArmed) everFalseAfterArming = true;
    }
    // Frame 1 only seeds prevT; 0.6s = 36 accumulating frames of -0.02/frame.
    // Allow a frame of slack for dt float summation.
    expect(armedAt).toBeGreaterThanOrEqual(36);
    expect(armedAt).toBeLessThanOrEqual(38);
    expect(seenArmed).toBe(true);
    expect(everFalseAfterArming).toBe(false);
  });

  it("reverse across the 0→1 wrap still arms (backward wrap)", () => {
    const feed = createWrongWayDetector();
    let t = 0.01;
    let armed = false;
    for (let i = 0; i < 60 && !armed; i++) {
      t = (t - 0.02 + 1) % 1;
      armed = feed(t, DT);
    }
    expect(armed).toBe(true);
  });

  it("forward travel after arming clears it again", () => {
    const feed = createWrongWayDetector();
    // Arm: ~0.67s of reverse.
    let t = 0.5;
    let armed = false;
    for (let i = 0; i < 40; i++) {
      t = (t - 0.02 + 1) % 1;
      armed = feed(t, DT);
    }
    expect(armed).toBe(true);

    // Clear needs 0.4s = 24 forward frames; one frame of dt-sum slack.
    let clearedAt = -1;
    for (let i = 1; i <= 40; i++) {
      t = (t + 0.02) % 1;
      if (!feed(t, DT)) {
        clearedAt = i;
        break;
      }
    }
    expect(clearedAt).toBeGreaterThanOrEqual(24);
    expect(clearedAt).toBeLessThanOrEqual(26);

    // And it stays cleared while forward travel continues.
    for (let i = 0; i < 60; i++) {
      t = (t + 0.02) % 1;
      expect(feed(t, DT)).toBe(false);
    }
  });

  it("brief reverse during a spin-out never arms", () => {
    const feed = createWrongWayDetector();
    let t = 0.5;
    // 18 frames = 0.3s of reverse, half the sustain window.
    for (let i = 0; i < 18; i++) {
      t = (t - 0.02 + 1) % 1;
      expect(feed(t, DT)).toBe(false);
    }
    // Driver recovers — forward from here on must never arm.
    for (let i = 0; i < 120; i++) {
      t = (t + 0.02) % 1;
      expect(feed(t, DT)).toBe(false);
    }
  });

  it("forward progress resets the reverse timer, so reverse restarts from zero", () => {
    const feed = createWrongWayDetector();
    let t = 0.5;
    for (let i = 0; i < 18; i++) {
      t = (t - 0.02 + 1) % 1;
      feed(t, DT);
    }
    for (let i = 0; i < 6; i++) {
      t = (t + 0.02) % 1;
      feed(t, DT);
    }
    // Only 0.5s of fresh reverse after the reset — under the 0.6s sustain.
    for (let i = 0; i < 30; i++) {
      t = (t - 0.02 + 1) % 1;
      expect(feed(t, DT)).toBe(false);
    }
  });

  it("absurd dt counts as no progress on both timers", () => {
    // dt = 0.25 and sustain/clear of 0.5/0.25 sum exactly — arming/clearing
    // frames are exact.
    const feed = createWrongWayDetector({ sustain: 0.5, clear: 0.25 });
    let t = 0.5;
    expect(feed(t, 0.25)).toBe(false); // seeds prevT
    t -= 0.02;
    expect(feed(t, 0.25)).toBe(false); // 0.25s reverse
    t -= 0.02;
    expect(feed(t, 5)).toBe(false); // tab-restored spike: timer still 0.25s
    t -= 0.02;
    expect(feed(t, 0.25)).toBe(true); // 0.5s exactly → arms a frame later

    t += 0.02;
    expect(feed(t, 5)).toBe(true); // spike while armed: forward timer unmoved
    t += 0.02;
    expect(feed(t, 0.25)).toBe(false); // 0.25s forward ≥ clear → cleared
  });

  it("dt ≤ 0 is ignored too", () => {
    const feed = createWrongWayDetector({ sustain: 0.5, clear: 0.25 });
    let t = 0.5;
    expect(feed(t, 0.25)).toBe(false); // seeds prevT
    t -= 0.02;
    expect(feed(t, 0.25)).toBe(false); // 0.25s reverse
    t -= 0.02;
    expect(feed(t, 0)).toBe(false); // zero dt: no accumulation
    t -= 0.02;
    expect(feed(t, 0.25)).toBe(true); // 0.5s reached one call later than without it
  });
});

describe("createPositionCalloutTracker", () => {
  it("returns null on the first call and on unchanged positions", () => {
    const feed = createPositionCalloutTracker();
    expect(feed(3, 10)).toBe(null);
    expect(feed(3, 10.5)).toBe(null);
    expect(feed(3, 12)).toBe(null);
  });

  it("fires +1 on improvement and -1 on worsening", () => {
    const feed = createPositionCalloutTracker({ cooldown: 1.5 });
    expect(feed(3, 0)).toBe(null); // first call only records
    expect(feed(2, 1)).toBe(1); // improved 3 → 2
    expect(feed(2, 1.5)).toBe(null); // no change
    expect(feed(3, 2.6)).toBe(-1); // worsened 2 → 3, 1.6s after last fire
  });

  it("swallows flip-flops inside the cooldown without losing the real change", () => {
    const feed = createPositionCalloutTracker({ cooldown: 1.5 });
    expect(feed(2, 0)).toBe(null); // initial
    expect(feed(1, 1)).toBe(1); // fires, lastFire = 1
    expect(feed(2, 1.4)).toBe(null); // swap back inside cooldown — swallowed
    expect(feed(1, 1.8)).toBe(null); // swap again — still swallowed
    // The flip to 2 STAYED: first call after the window re-fires it.
    expect(feed(2, 2.6)).toBe(-1);
    expect(feed(2, 3)).toBe(null);
  });

  it("reports at most one callout per cooldown even at frame rate", () => {
    const feed = createPositionCalloutTracker({ cooldown: 1.5 });
    expect(feed(4, 0)).toBe(null);
    expect(feed(3, 0.1)).toBe(1);
    let callouts = 0;
    // 80 frames (~1.33s) of swap-flip-flop, all inside the cooldown window.
    for (let i = 0; i < 80; i++) {
      const pos = i % 2 === 0 ? 3 : 4;
      if (feed(pos, 0.1 + (i + 1) * DT) !== null) callouts++;
    }
    expect(callouts).toBe(0);
  });
});
