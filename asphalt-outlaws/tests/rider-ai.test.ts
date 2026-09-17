import { describe, expect, test } from "bun:test";
import { LEVELS, RIVAL_COLORS, RIVAL_NAMES, SIM } from "../src/config";
import { raceMaxSpeed } from "../src/sim/bike";
import { spawnRivals, stepRivals } from "../src/sim/rider-ai";
import type { TrafficCar } from "../src/sim/types";
import { makeState } from "./helpers";

const DT = 1 / 60;
const GRID_X = 0.45;
const GRID_X_JITTER = 0.08;

describe("spawnRivals", () => {
  test("fills 7 rivals and 0 cops on level 0 with unique ids and names", () => {
    const state = makeState({ rivals: 0, level: { rivalCount: 7, copCount: 0 } });
    spawnRivals(state);

    expect(state.rivals.length).toBe(7);
    expect(state.rivals.every((r) => r.kind === "rival")).toBe(true);
    expect(new Set(state.rivals.map((r) => r.id)).size).toBe(7);
    expect(state.rivals.map((r) => r.name)).toEqual(RIVAL_NAMES.slice(0, 7));
    // Colors cycle RIVAL_COLORS in order.
    state.rivals.forEach((r, i) => expect(r.color).toBe(RIVAL_COLORS[i]!));
    expect(state.totalRacers).toBe(8);
  });

  test("rivals stagger ahead of the player on alternating grid sides", () => {
    const state = makeState({ rivals: 0, seed: 3 });
    spawnRivals(state);

    for (const r of state.rivals) {
      expect(r.z).toBeGreaterThan(state.player.z);
      expect(r.z).toBeLessThanOrEqual(state.player.z + 1500);
      expect(Math.abs(r.x)).toBeGreaterThanOrEqual(GRID_X - GRID_X_JITTER);
      expect(Math.abs(r.x)).toBeLessThanOrEqual(GRID_X + GRID_X_JITTER);
      expect(r.hp).toBe(100);
      expect(r.speed).toBe(0);
      expect(r.finished).toBe(false);
    }
  });

  test("level 2 adds two cops at the back of the grid in hunt mode", () => {
    const state = makeState({ rivals: 0, level: { ...LEVELS[2]! } });
    spawnRivals(state);

    expect(state.rivals.length).toBe(9);
    const cops = state.rivals.filter((r) => r.kind === "cop");
    const rivals = state.rivals.filter((r) => r.kind === "rival");
    expect(cops.length).toBe(2);
    expect(rivals.length).toBe(7);
    expect(cops.map((c) => c.name)).toEqual(["PATROL ONE", "PATROL TWO"]);

    const minRivalZ = Math.min(...rivals.map((r) => r.z));
    for (const cop of cops) {
      expect(cop.z).toBe(state.player.z + 150); // back of the grid
      expect(cop.z).toBeLessThan(minRivalZ);
      expect(cop.ai?.mode).toBe("hunt");
      expect(cop.color).toBe("#dfe6f2");
      expect(cop.accent).toBe("#1b2a5e");
    }
    for (const r of rivals) expect(r.ai?.mode).toBe("race");
    expect(state.totalRacers).toBe(10); // 9 riders + player
    // Rival ids stay unique across the whole grid (incl. player id 1).
    expect(new Set([state.player, ...state.rivals].map((r) => r.id)).size).toBe(10);
  });

  test("every rider gets ai stats derived from the level spec", () => {
    const state = makeState({ rivals: 0, level: { ...LEVELS[2]! }, seed: 21 });
    spawnRivals(state);

    for (const r of state.rivals) {
      const ai = r.ai!;
      expect(ai.skill).toBeGreaterThanOrEqual(0.05);
      expect(ai.skill).toBeLessThanOrEqual(1);
      const expectedAggression = r.kind === "cop" ? 0.8 : LEVELS[2]!.rivalAggression;
      expect(ai.aggression).toBe(expectedAggression);
      expect(ai.targetX).toBe(r.x);
      expect(ai.decisionT).toBeGreaterThanOrEqual(0);
      expect(ai.decisionT).toBeLessThanOrEqual(2);
      expect(ai.attackT).toBeGreaterThanOrEqual(1);
      expect(ai.attackT).toBeLessThanOrEqual(3);
    }
  });
});

describe("stepRivals progress + stability", () => {
  test("3000 ticks: rivals advance, z never decreases, no NaN anywhere", () => {
    const state = makeState({ rivals: 3, seed: 11 });
    state.player.speed = 0.6 * raceMaxSpeed(state);
    const z0 = state.rivals.map((r) => r.z);

    for (let i = 0; i < 3000; i++) stepRivals(state, DT);

    state.rivals.forEach((r, i) => {
      expect(Number.isFinite(r.z)).toBe(true);
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.speed)).toBe(true);
      expect(Number.isFinite(r.hp)).toBe(true);
      expect(r.z).toBeGreaterThan(z0[i]!); // strictly moved up the road
    });
  });

  test("finished riders cruise instead of racing and never attack", () => {
    const state = makeState({ rivals: 1, seed: 13 });
    const rival = state.rivals[0]!;
    rival.finished = true;
    rival.z = 10 * SIM.segmentLength;

    const z0 = rival.z;
    for (let i = 0; i < 60; i++) stepRivals(state, DT);

    expect(rival.z).toBeGreaterThan(z0);
    expect(rival.speed).toBeLessThanOrEqual(0.5 * raceMaxSpeed(state) + 1);
    expect(state.events.length).toBe(0);
  });
});

describe("stepRivals traffic avoidance", () => {
  test("rival steers off the lane of a car blocking it ahead, no crash", () => {
    const state = makeState({ rivals: 1, seed: 5 });
    const rival = state.rivals[0]!;
    const ai = rival.ai!;
    rival.z = 8 * SIM.segmentLength;
    rival.x = 0.45;
    ai.targetX = 0.45;
    ai.decisionT = 999; // lock the lane: the car is the only influence

    const car: TrafficCar = {
      id: 777,
      kind: "car",
      dir: 1,
      z: rival.z + 1800,
      x: 0.45,
      speed: 0.2 * raceMaxSpeed(state),
      color: "#b8342c",
      active: true,
    };
    state.traffic = [car];

    let deviationWhileAhead = 0;
    for (let i = 0; i < 120; i++) {
      stepRivals(state, DT);
      if (car.z > rival.z) {
        deviationWhileAhead = Math.max(deviationWhileAhead, Math.abs(rival.x - car.x));
      }
    }

    // Cleared the car's lane before reaching it, and survived.
    expect(deviationWhileAhead).toBeGreaterThan(0.3);
    expect(state.events.some((e) => e.type === "crash")).toBe(false);
    expect(rival.downT).toBe(0);
  });
});

describe("stepRivals cop behavior", () => {
  test("cop closes on a slow player, settles alongside, and flips to bust", () => {
    const state = makeState({ rivals: 1, seed: 9 });
    const cop = state.rivals[0]!;
    cop.kind = "cop";
    cop.name = "PATROL ONE";
    cop.z = state.player.z - 3000;
    cop.x = 0.3;
    cop.ai!.mode = "hunt";
    state.player.speed = 0.15 * raceMaxSpeed(state);
    state.player.x = 0;

    const dz0 = Math.abs(cop.z - state.player.z);
    const seenModes = new Set<string>();
    let minDz = dz0;
    for (let i = 0; i < 300; i++) {
      stepRivals(state, DT);
      seenModes.add(cop.ai!.mode);
      minDz = Math.min(minDz, Math.abs(cop.z - state.player.z));
    }
    const dzEnd = Math.abs(cop.z - state.player.z);

    expect(dzEnd).toBeLessThan(dz0); // closed the gap overall
    expect(minDz).toBeLessThanOrEqual(300); // got alongside at least once
    expect(seenModes.has("bust")).toBe(true);
  });

  test("cops never start attacks even when the player is in range", () => {
    const state = makeState({ rivals: 1, seed: 4 });
    const cop = state.rivals[0]!;
    cop.kind = "cop";
    cop.ai!.mode = "bust"; // parked right next to the player
    cop.ai!.attackT = 0.01;
    cop.z = state.player.z;
    cop.x = state.player.x + 0.3;

    for (let i = 0; i < 120; i++) stepRivals(state, DT);

    expect(cop.attackKind).toBeNull();
    expect(state.events.some((e) => e.type === "swing")).toBe(false);
  });
});
