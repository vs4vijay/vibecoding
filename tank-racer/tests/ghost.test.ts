import { afterEach, describe, expect, it } from "bun:test";
import {
  GHOST_FORMAT_VERSION,
  GHOST_SAMPLE_INTERVAL,
  createGhostRecorder,
  loadGhost,
  storeGhost,
  type GhostRecording,
} from "../src/ghost";
import { installMemStorage, resetMemStorage } from "./helpers/mem-storage";

// ghost.ts imports three + tank.ts for its *playback* half, but neither is
// executed at module scope, so importing the module is DOM-free. Recorder and
// persistence are pure. Bun lacks a localStorage global → Map-backed shim.
installMemStorage();

afterEach(() => resetMemStorage());

const TRACK_ID = "dust-bowl";

function recording(samples: number[], lap = 6): GhostRecording {
  return { v: GHOST_FORMAT_VERSION, lap, samples };
}

/** Straight-line ghost: samples every 100 ms, 1 unit/s on each axis. */
function straightSamples(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(i * GHOST_SAMPLE_INTERVAL, i, i, 0);
  }
  return out;
}

describe("ghost persistence", () => {
  it("round-trips save → load", () => {
    const rec = recording(straightSamples(10), 0.9 + 8 * GHOST_SAMPLE_INTERVAL);
    storeGhost(TRACK_ID, rec);
    expect(loadGhost(TRACK_ID)).toEqual(rec);
  });

  it("keys storage per track", () => {
    storeGhost(TRACK_ID, recording(straightSamples(10)));
    expect(loadGhost("canyon-run")).toBeNull();
    expect(loadGhost(TRACK_ID)).not.toBeNull();
  });

  it("returns null for a missing key", () => {
    expect(loadGhost(TRACK_ID)).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    localStorage.setItem(`tankracer.ghost.${TRACK_ID}`, "{not json");
    expect(loadGhost(TRACK_ID)).toBeNull();
  });
});

describe("loadGhost validation", () => {
  function stored(rec: unknown): void {
    localStorage.setItem(`tankracer.ghost.${TRACK_ID}`, JSON.stringify(rec));
  }

  it("rejects a wrong format version", () => {
    stored({ ...recording(straightSamples(10)), v: GHOST_FORMAT_VERSION + 1 });
    expect(loadGhost(TRACK_ID)).toBeNull();
  });

  it("rejects a missing or non-positive lap time", () => {
    stored({ v: GHOST_FORMAT_VERSION, samples: straightSamples(10) });
    expect(loadGhost(TRACK_ID)).toBeNull();
    stored(recording(straightSamples(10), 0));
    expect(loadGhost(TRACK_ID)).toBeNull();
    stored(recording(straightSamples(10), -3));
    expect(loadGhost(TRACK_ID)).toBeNull();
  });

  it("rejects non-array or too-short sample buffers", () => {
    stored({ v: GHOST_FORMAT_VERSION, lap: 6, samples: "nope" });
    expect(loadGhost(TRACK_ID)).toBeNull();
    stored(recording([0, 0, 0, 0])); // < 2 complete samples
    expect(loadGhost(TRACK_ID)).toBeNull();
  });

  it("rejects a buffer whose length is not a multiple of 4", () => {
    stored(recording([...straightSamples(2), 0.2, 2, 2])); // 9 numbers
    expect(loadGhost(TRACK_ID)).toBeNull();
  });

  it("rejects non-finite numbers in the buffer", () => {
    // JSON.stringify drops NaN/∞ to null; inject null via raw JSON instead.
    localStorage.setItem(
      `tankracer.ghost.${TRACK_ID}`,
      '{"v":1,"lap":6,"samples":[0,0,0,0,0.1,null,1,0]}',
    );
    expect(loadGhost(TRACK_ID)).toBeNull();
  });

  it("rejects samples that are not time-ascending", () => {
    stored(recording([0, 0, 0, 0, 0.1, 1, 1, 0, 0.1, 2, 2, 0])); // duplicate t
    expect(loadGhost(TRACK_ID)).toBeNull();
    stored(recording([0.5, 0, 0, 0, 0.1, 1, 1, 0])); // backwards t
    expect(loadGhost(TRACK_ID)).toBeNull();
  });
});

describe("GhostRecorder", () => {
  it("emits one stride-4 sample per GHOST_SAMPLE_INTERVAL", () => {
    const rec = createGhostRecorder();
    // 102 frames × 0.05 s = 5.1 s — comfortably past the recorder's 5 s
    // junk-lap floor (a float-accumulated 5.0 can land a hair below it).
    for (let i = 0; i < 102; i++) rec.observe(0.05, i * 0.5, 0, 0);
    rec.completeLap();
    expect(rec.bestTime).toBeCloseTo(5.1, 6);
    expect(rec.bestSamples!.length).toBe(4 * 51); // 5.1 s at 10 Hz
    // Flat stride-4, time-ascending, values rounded to 2 decimals.
    // First sample lands at t = 0.1 with x = 0.5 (emit fires on the 2nd frame).
    expect(rec.bestSamples![0]).toBeCloseTo(GHOST_SAMPLE_INTERVAL, 2);
    expect(rec.bestSamples![1]).toBeCloseTo(0.5, 2);
    expect(rec.bestSamples![200]).toBeCloseTo(5.1, 2);
    for (let i = 4; i < rec.bestSamples!.length; i += 4) {
      expect(rec.bestSamples![i]).toBeGreaterThan(rec.bestSamples![i - 4]);
    }
  });

  it("keeps only the fastest completed lap across the race", () => {
    const rec = createGhostRecorder();
    const driveLap = (seconds: number) => {
      for (let i = 0; i < seconds / 0.05; i++) rec.observe(0.05, i, 0, 0);
      rec.completeLap();
    };
    driveLap(6);
    driveLap(5.5); // new best
    driveLap(7); // slower — must be ignored
    expect(rec.bestTime).toBeCloseTo(5.5, 6);
    expect(rec.bestSamples!.length).toBe(4 * 55); // 5.5 s at 10 Hz
  });

  it("drops junk laps (too short / too few samples)", () => {
    const rec = createGhostRecorder();
    for (let i = 0; i < 6; i++) rec.observe(0.05, i, 0, 0); // 0.3 s wreck blip
    rec.completeLap();
    expect(rec.bestTime).toBeNull();
    expect(rec.bestSamples).toBeNull();
  });

  it("reset() clears the best lap", () => {
    const rec = createGhostRecorder();
    for (let i = 0; i < 120; i++) rec.observe(0.05, i, 0, 0); // 6 s lap
    rec.completeLap();
    expect(rec.bestTime).not.toBeNull();
    rec.reset();
    expect(rec.bestTime).toBeNull();
    expect(rec.bestSamples).toBeNull();
    for (let i = 0; i < 102; i++) rec.observe(0.05, i, 0, 0); // fresh 5.1 s lap
    rec.completeLap();
    expect(rec.bestTime).toBeCloseTo(5.1, 6); // not 6 + 5.1 accumulated
  });
});
