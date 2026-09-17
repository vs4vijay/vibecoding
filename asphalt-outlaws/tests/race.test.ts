import { describe, expect, test } from "bun:test";
import { BIKES, HUD, LEVELS, SIM, TRAFFIC } from "../src/config";
import type { InputState } from "../src/core/input";
import { raceMaxSpeed, stepPlayer } from "../src/sim/bike";
import { computeResults, createRace, stepRaceFlow } from "../src/sim/race";
import { stepRivals } from "../src/sim/rider-ai";
import { stepTraffic } from "../src/sim/traffic";
import type { RaceState } from "../src/sim/types";

const DT = 1 / 60;
const ZERO_INPUT: InputState = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
  attackL: false,
  attackR: false,
};

function race(seed = 7, levelIdx = 0): RaceState {
  return createRace({ levelIdx, level: LEVELS[levelIdx]!, bike: BIKES[0]!, seed });
}

function finishZ(state: RaceState): number {
  return state.track.finishIndex * SIM.segmentLength;
}

function intoRacing(state: RaceState): void {
  state.phase = "racing";
  state.countdown = 0;
}

describe("createRace", () => {
  test("builds a full countdown-ready state", () => {
    const state = race();

    expect(state.phase).toBe("countdown");
    expect(state.countdown).toBe(HUD.countdownTime);
    expect(state.time).toBe(0);
    expect(state.results).toBeNull();
    expect(state.rng).toBeDefined();

    expect(state.rivals.length).toBe(
      LEVELS[0]!.rivalCount + LEVELS[0]!.copCount,
    );
    expect(state.totalRacers).toBe(state.rivals.length + 1);
    expect(state.traffic.length).toBeGreaterThan(0);

    expect(state.track.segments.length).toBe(LEVELS[0]!.lengthSegs);
    expect(state.track.finishIndex).toBeGreaterThan(0);
    expect(state.track.finishIndex).toBeLessThan(LEVELS[0]!.lengthSegs);

    expect(state.player.name).toBe("YOU");
    expect(state.player.z).toBe(2 * SIM.segmentLength);
    expect(state.player.color).toBe(BIKES[0]!.color);
    expect(state.player.ai).toBeNull();

    // Grid ranked exactly once: rivals ahead, player last.
    expect(state.player.place).toBe(8);
    const places = [state.player, ...state.rivals]
      .map((r) => r.place)
      .sort((a, b) => a - b);
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("seed drives everything: same seed, same opening state", () => {
    const a = race(99);
    const b = race(99);
    expect(a.rivals.map((r) => [r.id, r.z, r.x, r.ai!.skill]))
      .toEqual(b.rivals.map((r) => [r.id, r.z, r.x, r.ai!.skill]));
    expect(a.traffic.map((c) => [c.id, c.z, c.x, c.speed]))
      .toEqual(b.traffic.map((c) => [c.id, c.z, c.x, c.speed]));
    expect(a.track.segments[100]!.curve).toBe(b.track.segments[100]!.curve);
  });
});

describe("stepRaceFlow: countdown", () => {
  test("3.999s at 60Hz: exactly 3 beeps, then GO into racing", () => {
    const state = race();
    const types: string[] = [];
    for (let t = 0; t < 240; t++) {
      stepRaceFlow(state, DT);
      for (const e of state.events) types.push(e.type);
      state.events.length = 0;
    }

    expect(types.filter((t) => t === "countdown-beep").length).toBe(3);
    expect(types.filter((t) => t === "go").length).toBe(1);
    expect(types[types.length - 1]).toBe("go");
    expect(state.phase).toBe("racing");
    expect(state.countdown).toBe(0);
    expect(state.toasts.some((t) => t.text === "GO!" && t.big)).toBe(true);
  });

  test("race clock runs only after GO and freezes once finished", () => {
    const state = race();

    for (let t = 0; t < 60; t++) stepRaceFlow(state, DT);
    expect(state.phase).toBe("countdown");
    expect(state.time).toBe(0);

    for (let t = 0; t < 200; t++) stepRaceFlow(state, DT);
    expect(state.phase).toBe("racing");
    const t1 = state.time;
    expect(t1).toBeGreaterThan(0);

    state.phase = "finished";
    for (let t = 0; t < 30; t++) stepRaceFlow(state, DT);
    expect(state.time).toBe(t1);
  });
});

describe("stepRaceFlow: finishing", () => {
  test("rival crossing the line finishes in order; race keeps going", () => {
    const state = race();
    intoRacing(state);
    state.rivals[0]!.z = finishZ(state) + 10;

    stepRaceFlow(state, DT);

    const rival = state.rivals[0]!;
    expect(rival.finished).toBe(true);
    expect(rival.finishTime).toBeCloseTo(DT, 9);
    expect(rival.place).toBe(1);
    // Player is still parked on the grid: every other rider is ahead of them.
    expect(state.player.place).toBe(8);
    expect(state.phase).toBe("racing");
    expect(state.results).toBeNull();
  });

  test("player finish locks results: qualified with the full prize", () => {
    const state = race();
    intoRacing(state);
    state.player.z = finishZ(state) + 5;

    stepRaceFlow(state, DT);

    expect(state.phase).toBe("finished");
    expect(state.player.finished).toBe(true);
    expect(state.player.finishTime).toBeCloseTo(DT, 9);
    const res = state.results!;
    expect(res.ending).toBe("finished");
    expect(res.place).toBe(1);
    expect(res.place).toBe(state.player.place);
    expect(res.totalRacers).toBe(8);
    expect(res.qualified).toBe(true);
    expect(res.prize).toBe(LEVELS[0]!.prize);
    expect(res.time).toBeCloseTo(DT, 9);
    expect(res.levelIdx).toBe(0);
    expect(state.events.some((e) => e.type === "finish")).toBe(true);
    expect(state.toasts.some((t) => t.text === "FINISHED!")).toBe(true);
  });

  test("player finishing behind five rivals: unqualified consolation prize", () => {
    const state = race();
    intoRacing(state);
    // Five rivals already home, in order, before the player crosses.
    for (let i = 0; i < 5; i++) {
      const r = state.rivals[i]!;
      r.finished = true;
      r.finishTime = i * 0.001;
    }
    state.player.z = finishZ(state) + 5;

    stepRaceFlow(state, DT);

    const res = state.results!;
    expect(state.player.place).toBe(6);
    expect(res.place).toBe(6);
    expect(res.qualified).toBe(false); // LEVELS[0] qualifies top 5
    expect(res.prize).toBe(Math.floor(LEVELS[0]!.prize * 0.25));
  });

  test("finish crossing survives a whole field teleport check", () => {
    // A rival already past the line plus the player crossing the same tick:
    // earlier finisher stays ahead in the standings.
    const state = race();
    intoRacing(state);
    const first = state.rivals[0]!;
    first.finished = true;
    first.finishTime = 0.005; // earlier than the player's DT crossing
    state.player.z = finishZ(state) + 1;

    stepRaceFlow(state, DT);

    expect(state.results!.place).toBe(2);
    expect(first.place).toBe(1);
  });
});

describe("stepRaceFlow: busted / wrecked endings", () => {
  test("busted phase finalizes results exactly once", () => {
    const state = race();
    intoRacing(state);
    for (let t = 0; t < 30; t++) stepRaceFlow(state, DT);

    state.phase = "busted";
    state.results = null;
    stepRaceFlow(state, DT);

    const res = state.results!;
    expect(res.ending).toBe("busted");
    expect(res.qualified).toBe(false); // player is last on the road
    expect(res.prize).toBe(Math.floor(LEVELS[0]!.prize * 0.25));
    const snapshot = state.results;
    stepRaceFlow(state, DT);
    expect(state.results).toBe(snapshot); // not recomputed
  });

  test("wrecked phase finalizes results", () => {
    const state = race();
    state.phase = "wrecked";
    state.results = null;
    stepRaceFlow(state, DT);
    expect(state.results!.ending).toBe("wrecked");
    expect(state.results!.qualified).toBe(false);
  });
});

describe("computeResults", () => {
  test("honors the level's qualifyPlace", () => {
    const state = race(7, 2); // Sunset Strip qualifies top 3
    state.time = 123.5;
    state.totalRacers = 9;

    state.player.place = 3;
    const inside = computeResults(state, "finished");
    expect(inside.qualified).toBe(true);
    expect(inside.prize).toBe(LEVELS[2]!.prize);
    expect(inside.time).toBe(123.5);
    expect(inside.levelIdx).toBe(2);

    state.player.place = 4;
    const outside = computeResults(state, "busted");
    expect(outside.qualified).toBe(false);
    expect(outside.prize).toBe(Math.floor(LEVELS[2]!.prize * 0.25));
    expect(outside.ending).toBe("busted");
  });
});

describe("determinism", () => {
  test("same seed + same script => identical world state and event stream", () => {
    const run = (): { state: RaceState; types: string[] } => {
      const state = race(123);
      const types: string[] = [];
      for (let t = 0; t < 240; t++) {
        stepRaceFlow(state, DT);
        for (const e of state.events) types.push(e.type);
        state.events.length = 0;
      }
      // 200 racing ticks, player input zero.
      for (let t = 0; t < 200; t++) {
        stepPlayer(state, ZERO_INPUT, DT);
        stepRivals(state, DT);
        stepTraffic(state, DT);
        stepRaceFlow(state, DT);
        for (const e of state.events) types.push(e.type);
        state.events.length = 0;
      }
      return { state, types };
    };

    const a = run();
    const b = run();

    expect(a.state.player.z).toBe(b.state.player.z);
    expect(a.state.player.speed).toBe(b.state.player.speed);
    expect(a.state.rivals.map((r) => [r.z, r.x, r.speed, r.hp, r.place]))
      .toEqual(b.state.rivals.map((r) => [r.z, r.x, r.speed, r.hp, r.place]));
    expect(a.state.traffic.map((c) => [c.z, c.x, c.speed]))
      .toEqual(b.state.traffic.map((c) => [c.z, c.x, c.speed]));
    expect(a.types).toEqual(b.types);
    expect(a.state.bustPressure).toBe(b.state.bustPressure);
  });

  test("rivals make real progress in a scripted race", () => {
    const state = race(5);
    for (let t = 0; t < 240; t++) stepRaceFlow(state, DT);
    const z0 = state.rivals.map((r) => r.z);
    for (let t = 0; t < 600; t++) {
      stepPlayer(state, ZERO_INPUT, DT);
      stepRivals(state, DT);
      stepTraffic(state, DT);
      stepRaceFlow(state, DT);
    }
    state.rivals.forEach((r, i) => {
      expect(r.z).toBeGreaterThan(z0[i]!);
      expect(Number.isFinite(r.z)).toBe(true);
    });
    // Traffic exists ahead of the pack and speeds are fractions of the cap.
    const cap = raceMaxSpeed(state);
    for (const car of state.traffic) {
      expect(car.speed).toBeGreaterThan(0);
      expect(car.speed).toBeLessThanOrEqual(
        TRAFFIC.oncomingSpeed * cap * (car.kind === "car" ? 1 : 0.8) + 1e-9,
      );
    }
  });
});
