import { describe, expect, test } from "bun:test";
import { SIM, TRAFFIC } from "../src/config";
import { raceMaxSpeed } from "../src/sim/bike";
import {
  checkTrafficHit,
  spawnTraffic,
  SPAWN_CLEARANCE,
  stepTraffic,
} from "../src/sim/traffic";
import { stepRivals } from "../src/sim/rider-ai";
import type { RaceState, TrafficCar } from "../src/sim/types";
import { makeState } from "./helpers";

const DT = 1 / 60;

function manualCar(over: Partial<TrafficCar> & { id: number }): TrafficCar {
  return {
    kind: "car",
    dir: 1,
    z: 0,
    x: 0,
    speed: 0,
    color: "#b8342c",
    active: true,
    ...over,
  };
}

describe("spawnTraffic", () => {
  test("count tracks density within ±40%", () => {
    const state = makeState({ rivals: 0, level: { trafficDensity: 6.4 } });
    spawnTraffic(state);
    // Density applies to the seeded span: the ahead window minus the
    // guaranteed clear start runway (at least one chunk always seeds).
    const clearSegs = SPAWN_CLEARANCE / SIM.segmentLength;
    const chunks = Math.max(
      1,
      Math.ceil((TRAFFIC.aheadSegments - clearSegs) / 100),
    );
    const expected = Math.round(6.4) * chunks;
    expect(state.traffic.length).toBeGreaterThan(0);
    expect(Math.abs(state.traffic.length - expected)).toBeLessThanOrEqual(
      expected * 0.4,
    );
  });

  test("all cars spawn ahead of the clear zone, inside the ahead window", () => {
    const state = makeState({ rivals: 0, level: { trafficDensity: 6.4 }, seed: 8 });
    spawnTraffic(state);

    expect(state.traffic.length).toBeGreaterThan(0);
    const winEnd = state.player.z + TRAFFIC.aheadSegments * SIM.segmentLength;
    for (const car of state.traffic) {
      expect(car.z).toBeGreaterThan(state.player.z + 2500);
      expect(car.z).toBeLessThanOrEqual(winEnd);
      expect(car.active).toBe(true);
      expect(["car", "truck", "bus"]).toContain(car.kind);
      expect(car.speed).toBeGreaterThan(0);
    }
  });

  test("same-direction cars keep right, oncoming cars keep left", () => {
    const right = makeState({
      rivals: 0,
      level: { trafficDensity: 5, oncomingShare: 0 },
      seed: 12,
    });
    spawnTraffic(right);
    expect(right.traffic.length).toBeGreaterThan(0);
    for (const car of right.traffic) {
      expect(car.dir).toBe(1);
      expect(car.x).toBeGreaterThan(0);
    }

    const left = makeState({
      rivals: 0,
      level: { trafficDensity: 5, oncomingShare: 1 },
      seed: 13,
    });
    spawnTraffic(left);
    expect(left.traffic.length).toBeGreaterThan(0);
    for (const car of left.traffic) {
      expect(car.dir).toBe(-1);
      expect(car.x).toBeLessThan(0);
    }
  });

  test("no two cars share a lane within 900 units at spawn", () => {
    const state = makeState({ rivals: 0, level: { trafficDensity: 8 }, seed: 14 });
    spawnTraffic(state);
    expect(state.traffic.length).toBeGreaterThan(2);
    for (let i = 0; i < state.traffic.length; i++) {
      for (let j = i + 1; j < state.traffic.length; j++) {
        const a = state.traffic[i]!;
        const b = state.traffic[j]!;
        if (a.x === b.x) {
          expect(Math.abs(a.z - b.z)).toBeGreaterThanOrEqual(900);
        }
      }
    }
  });
});

describe("stepTraffic", () => {
  test("2000 ticks: length constant, window populated, movement follows dir", () => {
    const state: RaceState = makeState({
      rivals: 0,
      level: { trafficDensity: 6.4, oncomingShare: 0.5 },
      seed: 17,
    });
    spawnTraffic(state);
    const len = state.traffic.length;
    expect(len).toBeGreaterThan(0);

    const back = state.player.z - TRAFFIC.behindSegments * SIM.segmentLength;
    const ahead = state.player.z + TRAFFIC.aheadSegments * SIM.segmentLength;
    const prevZ = new Map(state.traffic.map((c) => [c.id, c.z]));

    for (let t = 0; t < 2000; t++) {
      stepTraffic(state, DT);
      expect(state.traffic.length).toBe(len);
      for (const car of state.traffic) {
        expect(Number.isFinite(car.z)).toBe(true);
        expect(Number.isFinite(car.x)).toBe(true);
        expect(car.z).toBeGreaterThanOrEqual(back - 1);
        expect(car.z).toBeLessThanOrEqual(ahead + 1);
        const moved = car.z - prevZ.get(car.id)!;
        // Normal ticks move <= ~104 units; respawn jumps are >= ~500
        // (recycling re-places a car 500..2500 inside the ahead edge).
        if (Math.abs(moved) < 250) {
          if (car.dir === 1) expect(moved).toBeGreaterThan(0);
          else expect(moved).toBeLessThan(0);
        }
        prevZ.set(car.id, car.z);
      }
    }
  });

  test("oncoming car crossing the player's line emits exactly one near-miss", () => {
    const state = makeState({ rivals: 0 });
    state.player.x = 0;
    state.traffic = [
      manualCar({ id: 4242, dir: -1, z: state.player.z + 600, x: 0.2, speed: 3000 }),
    ];

    // Cross at tick ~12; stop before the car can be recycled for a second pass.
    for (let t = 0; t < 50; t++) stepTraffic(state, DT);

    const misses = state.events.filter((e) => e.type === "near-miss");
    expect(misses.length).toBe(1);
    expect(Math.abs(misses[0]!.x! - state.player.x)).toBeLessThan(0.35);
  });

  test("a car crossing far to the side is not a near-miss", () => {
    const state = makeState({ rivals: 0 });
    state.player.x = 0;
    state.traffic = [
      manualCar({ id: 4243, dir: -1, z: state.player.z + 600, x: 0.8, speed: 3000 }),
    ];
    for (let t = 0; t < 50; t++) stepTraffic(state, DT);
    expect(state.events.some((e) => e.type === "near-miss")).toBe(false);
  });
});

describe("checkTrafficHit", () => {
  test("returns the car overlapping the rider's hit box", () => {
    const state = makeState({ rivals: 0 });
    const car = manualCar({ id: 9001, z: state.player.z, x: 0 });
    state.traffic = [car];
    expect(checkTrafficHit(state, state.player)).toBe(car);
  });

  test("ignores inactive cars and cars outside the z window", () => {
    const state = makeState({ rivals: 0 });
    const car = manualCar({ id: 9002, z: state.player.z, x: 0, active: false });
    state.traffic = [car];
    expect(checkTrafficHit(state, state.player)).toBeNull();

    car.active = true;
    car.z = state.player.z + 10 * SIM.segmentLength;
    expect(checkTrafficHit(state, state.player)).toBeNull();
  });

  test("trucks and buses have wider hit boxes than cars", () => {
    const state = makeState({ rivals: 0 });
    const dx = TRAFFIC.hitX + 0.06; // inside the truck box, outside the car's
    const car = manualCar({ id: 9003, z: state.player.z, x: dx });
    const truck = manualCar({ id: 9004, kind: "truck", z: state.player.z, x: dx });
    state.traffic = [car];
    expect(checkTrafficHit(state, state.player)).toBeNull();
    state.traffic = [truck];
    expect(checkTrafficHit(state, state.player)).toBe(truck);
  });
});

describe("rival traffic crash hook", () => {
  test("a rival buried in a car crashes via startCrash", () => {
    // Exercises the stepRivals -> checkTrafficHit -> startCrash path end to end.
    const state = makeState({ rivals: 1, seed: 19 });
    const rival = state.rivals[0]!;
    rival.z = state.player.z + 100;
    rival.x = 0;
    rival.speed = 4000;
    const car = manualCar({ id: 9005, z: rival.z + 50, x: rival.x });
    state.traffic = [car];

    stepRivals(state, DT);

    expect(rival.downT).toBeGreaterThan(0);
    expect(state.events.some((e) => e.type === "crash")).toBe(true);
  });
});

describe("raceMaxSpeed sanity for traffic speeds", () => {
  test("traffic speeds are fractions of the race cap", () => {
    const state = makeState({ rivals: 0, level: { trafficDensity: 5 }, seed: 23 });
    spawnTraffic(state);
    const cap = raceMaxSpeed(state);
    for (const car of state.traffic) {
      if (car.dir === 1) {
        const heavy = car.kind === "car" ? 1 : 0.8;
        expect(car.speed).toBeGreaterThan(0);
        expect(car.speed).toBeLessThanOrEqual(TRAFFIC.sameSpeedMax * cap * heavy + 1e-9);
      } else {
        expect(car.speed).toBeCloseTo(
          TRAFFIC.oncomingSpeed * cap * (car.kind === "car" ? 1 : 0.8),
          6,
        );
      }
    }
  });
});
