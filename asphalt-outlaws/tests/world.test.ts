// Integration tests: the whole sim through world.ts — determinism, NaN
// hygiene, race flow, and a full throttle-only race completion.

import { describe, expect, test } from "bun:test";
import { BIKES, HUD, LEVELS } from "../src/config";
import { SIM } from "../src/config";
import type { InputState } from "../src/core/input";
import { createWorld, drainEvents, stepWorld } from "../src/sim/world";

const IDLE: InputState = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
  attackL: false,
  attackR: false,
};
const FULL: InputState = { ...IDLE, throttle: true };

function run(seed: number, ticks: number, input: InputState = FULL) {
  const state = createWorld({
    levelIdx: 0,
    level: LEVELS[0]!,
    bike: BIKES[0]!,
    seed,
  });
  const eventTypes: string[] = [];
  for (let t = 0; t < ticks; t++) {
    stepWorld(state, input);
    for (const ev of drainEvents(state)) eventTypes.push(ev.type);
  }
  return { state, eventTypes };
}

function fingerprint(state: ReturnType<typeof createWorld>): string {
  return JSON.stringify({
    z: state.player.z,
    x: state.player.x,
    speed: state.player.speed,
    hp: state.player.hp,
    time: state.time,
    phase: state.phase,
    rivals: state.rivals.map((r) => [r.z, r.x, r.speed, r.hp, r.finished]),
    traffic: state.traffic.map((c) => [c.z, c.x, c.speed]),
  });
}

describe("world integration", () => {
  test("identical seed + input => identical race, tick for tick", () => {
    const a = run(1234, 4000);
    const b = run(1234, 4000);
    expect(fingerprint(a.state)).toBe(fingerprint(b.state));
    expect(a.eventTypes).toEqual(b.eventTypes);
  });

  test("different seeds diverge", () => {
    const a = run(1, 2500);
    const b = run(2, 2500);
    expect(a.state.player.z).not.toBe(b.state.player.z);
  });

  test("no NaN over 20k ticks of full throttle", () => {
    const { state } = run(77, 20000);
    const riders = [state.player, ...state.rivals];
    for (const r of riders) {
      for (const v of [r.z, r.x, r.speed, r.hp]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    for (const c of state.traffic) {
      expect(Number.isFinite(c.z)).toBe(true);
      expect(Number.isFinite(c.x)).toBe(true);
    }
  });

  test("countdown runs 3 beeps then go, then the clock advances", () => {
    const { state, eventTypes } = run(5, Math.ceil(HUD.countdownTime / SIM.step) + 10);
    expect(state.phase).toBe("racing");
    expect(eventTypes.filter((e) => e === "countdown-beep")).toHaveLength(3);
    expect(eventTypes).toContain("go");
    expect(state.time).toBeGreaterThan(0);
  });

  test("drainEvents clears the queue", () => {
    const state = createWorld({
      levelIdx: 0,
      level: LEVELS[0]!,
      bike: BIKES[0]!,
      seed: 9,
    });
    stepWorld(state, IDLE);
    drainEvents(state);
    expect(state.events).toHaveLength(0);
  });

  test("full-throttle race reaches the finish with results", () => {
    // Generous cap: ~8M world units at min ~4k/s even with crashes.
    const { state } = run(42, 20000);
    expect(state.results).not.toBeNull();
    expect(state.player.finished).toBe(true);
    expect(state.results!.ending).toBe("finished");
    expect(state.results!.totalRacers).toBe(8);
    expect(state.time).toBeGreaterThan(30);
    expect(state.player.place).toBeGreaterThanOrEqual(1);
    expect(state.player.place).toBeLessThanOrEqual(8);
  }, 30000);
});
