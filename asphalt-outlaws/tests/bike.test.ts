import { describe, expect, test } from "bun:test";
import type { InputState } from "../src/core/input";
import { MAX_SPEED, PLAYER, SIM } from "../src/config";
import { moveRider, raceMaxSpeed, stepPlayer } from "../src/sim/bike";
import type { ProjPoint, RaceState, Segment, TrackData } from "../src/sim/types";
import { makeState } from "./helpers";

const DT = SIM.step;

function input(over: Partial<InputState> = {}): InputState {
  return {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    attackL: false,
    attackR: false,
    ...over,
  };
}

function projPoint(y: number, z: number): ProjPoint {
  return {
    world: { x: 0, y, z },
    camera: { x: 0, y: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
  };
}

/** Constant-radius fixture built inline (helpers.ts stays straight-only). */
function makeCurvedTrack(curve: number, segs = 600): TrackData {
  const segments: Segment[] = [];
  for (let i = 0; i < segs; i++) {
    segments.push({
      index: i,
      p1: projPoint(0, i * SIM.segmentLength),
      p2: projPoint(0, (i + 1) * SIM.segmentLength),
      curve,
      colors: {
        road: "#5e5e66",
        grass: "#37a34a",
        rumble: "#c9463a",
        lane: null,
      },
      clip: 0,
    });
  }
  return { segments, scenery: new Map(), finishIndex: segs - 10 };
}

function ticks(seconds: number): number {
  return Math.round(seconds / DT);
}

function runFor(
  state: RaceState,
  seconds: number,
  inp: InputState,
  fn: (s: RaceState, inp: InputState, dt: number) => void = stepPlayer,
): void {
  for (let i = 0; i < ticks(seconds); i++) fn(state, inp, DT);
}

describe("stepPlayer: longitudinal", () => {
  test("throttle accelerates toward max speed and stops there", () => {
    const state = makeState();
    const max = raceMaxSpeed(state);
    expect(state.player.speed).toBe(0);

    stepPlayer(state, input({ throttle: true }), DT);
    // One tick of accel = PLAYER.accelMul * max * bike.accelMul.
    expect(state.player.speed).toBeCloseTo(
      PLAYER.accelMul * max * state.cfg.bike.accelMul * DT,
      9,
    );

    runFor(state, 30, input({ throttle: true }));
    expect(state.player.speed).toBe(max);
  });

  test("brake decelerates faster than coasting", () => {
    const braked = makeState();
    const coasting = makeState();
    braked.player.speed = raceMaxSpeed(braked);
    coasting.player.speed = raceMaxSpeed(coasting);

    runFor(braked, 1, input({ brake: true }));
    runFor(coasting, 1, input());

    expect(braked.player.speed).toBe(0); // 1.3 * max/s eats 12000 in under a second
    expect(coasting.player.speed).toBeGreaterThan(0);
    expect(coasting.player.speed).toBeLessThan(raceMaxSpeed(coasting));
    expect(braked.player.speed).toBeLessThan(coasting.player.speed);
  });

  test("off-road caps speed at offRoadLimitMul * max", () => {
    const state = makeState();
    state.player.x = 1.4;
    state.player.speed = raceMaxSpeed(state);

    runFor(state, 8, input({ throttle: true }));

    expect(state.player.offRoad).toBe(true);
    expect(state.player.speed).toBeCloseTo(
      PLAYER.offRoadLimitMul * raceMaxSpeed(state),
      6,
    );
  });

  test("on-road riding clears the offRoad flag", () => {
    const state = makeState();
    state.player.offRoad = true;
    runFor(state, 0.5, input({ throttle: true }));
    expect(state.player.offRoad).toBe(false);
  });
});

describe("stepPlayer: steering + curves", () => {
  test("steering clamps at ±PLAYER.xClamp", () => {
    const right = makeState();
    runFor(right, 5, input({ right: true }));
    expect(right.player.x).toBeCloseTo(PLAYER.xClamp, 10);

    const left = makeState();
    runFor(left, 5, input({ left: true }));
    expect(left.player.x).toBeCloseTo(-PLAYER.xClamp, 10);
  });

  test("centrifugal drift pushes the player outward on curves", () => {
    const state = makeState({ track: makeCurvedTrack(2) });
    state.player.speed = raceMaxSpeed(state) * 0.9;
    const x0 = state.player.x;

    runFor(state, 2, input({ throttle: true }));

    expect(state.player.x).toBeLessThan(x0 - 0.5);
  });

  test("straight track produces no drift with no steering", () => {
    const state = makeState();
    state.player.speed = raceMaxSpeed(state);
    runFor(state, 2, input({ throttle: true }));
    expect(state.player.x).toBe(0);
  });

  test("lean stays within [-1, 1] and reflects steering + curve", () => {
    const state = makeState({ track: makeCurvedTrack(2) });
    state.player.speed = raceMaxSpeed(state);
    for (let i = 0; i < ticks(3); i++) {
      const inp =
        i % 2 === 0
          ? input({ throttle: true, right: true })
          : input({ throttle: true, left: true });
      stepPlayer(state, inp, DT);
      expect(state.player.lean).toBeGreaterThanOrEqual(-1);
      expect(state.player.lean).toBeLessThanOrEqual(1);
      expect(Number.isNaN(state.player.lean)).toBe(false);
    }
    // Full lock on a straight: lean = steer * (0.4 + 0.6 * speedFrac).
    // (Sustained right lock runs off-road, so speedFrac is the capped value.)
    const straight = makeState();
    runFor(straight, 10, input({ throttle: true, right: true }));
    expect(straight.player.speed).toBeGreaterThan(0);
    expect(straight.player.lean).toBeCloseTo(
      0.4 + 0.6 * (straight.player.speed / raceMaxSpeed(straight)),
      9,
    );
    expect(straight.player.lean).toBeLessThanOrEqual(1);
  });

  test("x stays clamped on curves at speed", () => {
    const state = makeState({ track: makeCurvedTrack(6) });
    state.player.speed = raceMaxSpeed(state);
    runFor(state, 6, input({ throttle: true, left: true }));
    expect(Math.abs(state.player.x)).toBeLessThanOrEqual(PLAYER.xClamp);
  });
});

describe("stepPlayer: downed + state hygiene", () => {
  test("downed player is skipped entirely", () => {
    const state = makeState();
    const p = state.player;
    p.downT = 1.5;
    p.speed = 500;
    const z0 = p.z;
    const x0 = p.x;

    runFor(state, 1, input({ throttle: true, right: true }));

    expect(p.speed).toBe(500);
    expect(p.z).toBe(z0);
    expect(p.x).toBe(x0);
    expect(p.lean).toBe(0);
  });

  test("no NaN leaks over a long mixed-input run", () => {
    const state = makeState({ track: makeCurvedTrack(3) });
    for (let i = 0; i < ticks(20); i++) {
      const phase = Math.floor(i / 30) % 4;
      const inp = [
        input({ throttle: true }),
        input({ throttle: true, left: true }),
        input({ brake: true }),
        input({ throttle: true, right: true }),
      ][phase]!;
      stepPlayer(state, inp, DT);
      expect(Number.isNaN(state.player.x)).toBe(false);
      expect(Number.isNaN(state.player.speed)).toBe(false);
      expect(Number.isNaN(state.player.z)).toBe(false);
    }
  });
});

describe("moveRider", () => {
  test("accelerates toward target speed and steers to target x", () => {
    const state = makeState();
    const r = state.rivals[0]!;
    expect(r.speed).toBe(0);

    moveRider(state, r, MAX_SPEED, 0.5, DT);
    expect(r.speed).toBeCloseTo(
      PLAYER.accelMul * MAX_SPEED * state.cfg.level.maxSpeedMul * DT,
      9,
    );

    for (let i = 0; i < ticks(6); i++) moveRider(state, r, MAX_SPEED, 0.5, DT);
    expect(r.speed).toBe(MAX_SPEED);
    expect(r.x).toBeCloseTo(0.5, 9);
    expect(r.steer).toBe(0);
    expect(r.z).toBeGreaterThan(0);
  });

  test("decelerates toward a lower target speed", () => {
    const state = makeState();
    const r = state.rivals[0]!;
    r.speed = MAX_SPEED;
    for (let i = 0; i < ticks(6); i++) {
      moveRider(state, r, MAX_SPEED * 0.5, r.x, DT);
      expect(r.speed).toBeGreaterThan(MAX_SPEED * 0.5 - 1e-9);
    }
    expect(r.speed).toBeLessThan(MAX_SPEED);
  });

  test("downed rival is skipped", () => {
    const state = makeState();
    const r = state.rivals[0]!;
    r.downT = 2;
    r.speed = 300;
    const z0 = r.z;
    moveRider(state, r, MAX_SPEED, 0, DT);
    expect(r.speed).toBe(300);
    expect(r.z).toBe(z0);
  });

  test("centrifugal drift applies to AI riders too", () => {
    const straight = makeState();
    const curved = makeState({ track: makeCurvedTrack(2) });
    straight.rivals[0]!.speed = MAX_SPEED;
    curved.rivals[0]!.speed = MAX_SPEED;
    const straightStart = straight.rivals[0]!.x;
    const curvedStart = curved.rivals[0]!.x;

    for (let i = 0; i < ticks(1); i++) {
      // targetX pinned to the current x: on a straight the rival holds the
      // line, on a curve the drift leaves them visibly outside it.
      moveRider(straight, straight.rivals[0]!, MAX_SPEED, straight.rivals[0]!.x, DT);
      moveRider(curved, curved.rivals[0]!, MAX_SPEED, curved.rivals[0]!.x, DT);
    }

    expect(straight.rivals[0]!.x).toBeCloseTo(straightStart, 9);
    expect(curved.rivals[0]!.x).toBeLessThan(curvedStart - 0.005);
  });

  test("x clamps to PLAYER.xClamp even with an extreme targetX", () => {
    const state = makeState();
    const r = state.rivals[0]!;
    for (let i = 0; i < ticks(5); i++) moveRider(state, r, MAX_SPEED, 10, DT);
    expect(r.x).toBeCloseTo(PLAYER.xClamp, 10);
  });
});
