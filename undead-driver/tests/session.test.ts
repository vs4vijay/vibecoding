import { describe, expect, it, vi } from "vitest";
import { Emitter } from "../src/core/emitter";
import type { GameEvents } from "../src/game/session";
import { CONFIG } from "../src/config";
import { Session } from "../src/game/session";
/** Minimal headless input double satisfying the Session input contract. */
function fakeInput() {
  const fireCbs: Array<(side: "left" | "right") => void> = [];
  const pauseCbs: Array<() => void> = [];
  return {
    steer: 0,
    onFire(cb: (side: "left" | "right") => void) {
      fireCbs.push(cb);
      return () => {
        const i = fireCbs.indexOf(cb);
        if (i >= 0) fireCbs.splice(i, 1);
      };
    },
    onPause(cb: () => void) {
      pauseCbs.push(cb);
      return () => {
        const i = pauseCbs.indexOf(cb);
        if (i >= 0) pauseCbs.splice(i, 1);
      };
    },
    fire(side: "left" | "right") {
      for (const cb of fireCbs) cb(side);
    },
    pause() {
      for (const cb of pauseCbs) cb();
    },
  };
}

function makeSession(seed = 7) {
  const input = fakeInput();
  const emitter = new Emitter<GameEvents>();
  const session = new Session({ input, emitter, render: null, seed });
  return { session, input, emitter };
}

/** Step the session at wall 60 fps until a predicate holds or budget expires. */
function runUntil(
  session: Session,
  predicate: () => boolean,
  maxSeconds = 30,
): boolean {
  const dt = 1 / 60;
  for (let t = 0; t < maxSeconds && !predicate(); t += dt) session.update(dt);
  return predicate();
}

describe("Session", () => {
  it("fires gameOver once with cause 'flip' after forced weight overload", () => {
    const { session, emitter } = makeSession();
    const over = vi.fn();
    emitter.on("gameOver", over);

    session.startRun();
    // Force the imbalance past capacity (4 per side) instantly.
    session.addWeight("left", 5);
    expect(runUntil(session, () => session.phase === "over")).toBe(true);
    expect(over).toHaveBeenCalledTimes(1);
    const stats = over.mock.calls[0][0];
    expect(stats.cause).toBe("flip");
    expect(stats.level).toBe(1);
    expect(session.phase).toBe("over");
  });

  it("fires gameOver with cause 'crash' on a head-on obstacle", () => {
    const { session, emitter } = makeSession(11);
    const over = vi.fn();
    emitter.on("gameOver", over);

    session.startRun();
    // Drop a wreck directly in the car's lane just ahead.
    session.spawnObstacleForTest("wreck", 0, session.carZValue + 6);
    expect(runUntil(session, () => session.phase === "over")).toBe(true);
    expect(over).toHaveBeenCalledTimes(1);
    expect(over.mock.calls[0][0].cause).toBe("crash");
  });

  it("emits levelUp when score crosses 400 points", () => {
    const { session, emitter } = makeSession(3);
    const levels = vi.fn();
    emitter.on("levelUp", levels);

    session.startRun();
    expect(session.level).toBe(1);
    session.debugAddScore(399);
    expect(session.level).toBe(1);
    session.debugAddScore(2); // 401 total -> level 2
    expect(levels).toHaveBeenCalledTimes(1);
    expect(levels.mock.calls[0][0]).toBe(2);
    expect(session.level).toBe(2);
  });

  it("startRun() fully resets state", () => {
    const { session } = makeSession(5);
    session.startRun();
    session.addWeight("left", 2);
    session.debugAddScore(50);
    // Drive a little so distance accumulates.
    runUntil(session, () => session.scoring.distanceM > 5);

    session.startRun();
    expect(session.phase).toBe("running");
    expect(session.scoring.score).toBe(0);
    expect(session.scoring.distanceM).toBe(0);
    expect(session.level).toBe(1);
    expect(session.car.leftWeight).toBe(0);
    expect(session.car.rightWeight).toBe(0);
    expect(session.activeZombieCount).toBe(0);
    expect(session.obstacleCount).toBe(0);
  });

  it("togglePause pauses and resumes; hidden auto-pause only binds with document", () => {
    const { session, input } = makeSession();
    session.startRun();
    input.pause();
    expect(session.phase).toBe("paused");
    input.pause();
    expect(session.phase).toBe("running");
  });

  it("gun fire emits shot, honors refire cooldown, drains mag, reload gates", () => {
    const { session, emitter, input } = makeSession(42);
    const shots = vi.fn();
    emitter.on("shot", shots);
    session.startRun();
    const cdSteps = Math.ceil(CONFIG.gun.fireIntervalS / CONFIG.sim.dt);

    // Fire sides are screen-space: a screen-left pull fires the world-RIGHT
    // gun (the chase cam mirrors x), so gun.right spends the round.
    input.fire("left");
    session.update(1 / 60);
    expect(shots).toHaveBeenCalledTimes(1);
    expect(session.gun.right.mag).toBe(CONFIG.gun.magSize - 1);
    expect(session.gun.left.mag).toBe(CONFIG.gun.magSize);

    // Edges inside the refire window are dropped without spending ammo.
    input.fire("left");
    input.fire("left");
    session.update(1 / 60);
    expect(shots).toHaveBeenCalledTimes(1);
    expect(session.gun.right.mag).toBe(CONFIG.gun.magSize - 1);

    // Drain the mag with spaced pulls; every landed pull emits a shot.
    shots.mockClear();
    let guard = 200;
    while (session.gun.right.mag > 0 && guard-- > 0) {
      input.fire("left");
      for (let i = 0; i < cdSteps; i++) session.update(1 / 60);
    }
    expect(session.gun.right.mag).toBe(0);
    expect(shots).toHaveBeenCalledTimes(CONFIG.gun.magSize - 1);

    // Empty mag: fireGun arms reloadT and no shot event fires.
    shots.mockClear();
    input.fire("left");
    session.update(1 / 60);
    expect(shots).not.toHaveBeenCalled();
    expect(session.gun.right.reloadT).toBeGreaterThan(0);
  });

  it("magazine refills to full after the auto-reload completes", () => {
    const { session, input } = makeSession(42);
    session.startRun();
    const cdSteps = Math.ceil(CONFIG.gun.fireIntervalS / CONFIG.sim.dt);

    // Drain the mag with spaced pulls.
    let guard = 200;
    while (session.gun.right.mag > 0 && guard-- > 0) {
      input.fire("left");
      for (let i = 0; i < cdSteps; i++) session.update(1 / 60);
    }
    expect(session.gun.right.mag).toBe(0);

    // One more pull arms the reload; after reloadS elapses the mag is full.
    input.fire("left");
    session.update(1 / 60);
    expect(session.gun.right.reloadT).toBeGreaterThan(0);
    for (
      let t = 0;
      t < CONFIG.gun.reloadS + 0.25 && session.gun.right.mag === 0;
      t += 1 / 60
    ) {
      session.update(1 / 60);
    }
    expect(session.gun.right.mag).toBe(CONFIG.gun.magSize);
    expect(session.gun.right.reloadT).toBeLessThanOrEqual(0);
  });

  it("screen-right steer moves the car toward world -x (camera mirrors x)", () => {
    // Regression: input steer was fed to the sim unconverted, so pressing
    // right moved the car left on screen (the chase cam looks along +z,
    // which flips x).
    const { session, input } = makeSession(42);
    session.startRun();
    input.steer = 1; // player's right
    const x0 = session.car.x;
    session.update(1 / 60);
    session.update(1 / 60);
    expect(session.car.x).toBeLessThan(x0);
    const xRight = session.car.x;
    input.steer = -1; // player's left
    for (let i = 0; i < 30; i++) session.update(1 / 60);
    expect(session.car.x).toBeGreaterThan(xRight);
  });

  it("fixed-step accumulator is deterministic for equal wall time", () => {
    const a = makeSession(9);
    const b = makeSession(9);
    a.session.startRun();
    b.session.startRun();
    // Two 1/30 updates vs four 1/60 updates: same total sim time.
    for (let i = 0; i < 30; i++) {
      a.session.update(1 / 30);
    }
    for (let i = 0; i < 60; i++) {
      b.session.update(1 / 60);
    }
    expect(b.session.scoring.distanceM).toBeCloseTo(a.session.scoring.distanceM, 5);
  });

  it("clamps huge frame deltas to avoid spiral of death", () => {
    const { session } = makeSession();
    session.startRun();
    // A 10-second stall must not run 600 steps; maxFrameDt is 0.1s.
    const before = session.scoring.distanceM;
    session.update(10);
    const maxSteps = Math.ceil(CONFIG.sim.maxFrameDt / CONFIG.sim.dt);
    expect(session.stepsLastFrame).toBeLessThanOrEqual(maxSteps);
    expect(session.scoring.distanceM).toBeGreaterThanOrEqual(before);
  });
});
