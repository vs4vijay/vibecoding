// Final-review verification, not part of the standing suite.
// I1: pause button stays tappable while paused (touch resume path).
// I2: L1 spawner only emits unlocked types (walkers) over a ~60s sim.
import { describe, expect, it } from "vitest";
import { Emitter } from "../src/core/emitter";
import type { GameEvents } from "../src/game/session";
import { Session } from "../src/game/session";
import { knobsForLevel } from "../src/game/difficulty";

/** Minimal headless input double satisfying the Session input contract. */
function fakeInput() {
  const pauseCbs: Array<() => void> = [];
  return {
    steer: 0,
    onFire() {
      return () => {};
    },
    onPause(cb: () => void) {
      pauseCbs.push(cb);
      return () => {
        const i = pauseCbs.indexOf(cb);
        if (i >= 0) pauseCbs.splice(i, 1);
      };
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
  session.startRun();
  return session;
}

describe("final review fixes", () => {
  it("I1: pause tap while paused flips phase back to running (touch resume)", () => {
    const session = makeSession();
    expect(session.phase).toBe("running");
    session.togglePause();
    expect(session.phase).toBe("paused");
    // The HUD pause button calls session.togglePause(); a second tap resumes.
    session.togglePause();
    expect(session.phase).toBe("running");
  });


  it("I2: L1 spawner spawns only walkers across a ~60s headless sim", () => {
    const seen = new Map<string, number>();
    let allWalkers = true;
    for (let seed = 1; seed <= 5; seed++) {
      const session = makeSession(seed);
      const dt = 1 / 60;
      for (let t = 0; t < 60; t += dt) {
        if (session.phase !== "running") break;
        session.update(dt);
      }
      for (const z of session.zombies.all()) {
        seen.set(z.type, (seen.get(z.type) ?? 0) + 1);
        if (z.type !== "walker") allWalkers = false;
      }
    }
    // Sanity: the sim actually spawned something at L1 pace.
    expect(seen.get("walker") ?? 0).toBeGreaterThan(0);
    expect(allWalkers).toBe(true);
    expect(knobsForLevel(1).types).toEqual(["walker"]);
  });
});
