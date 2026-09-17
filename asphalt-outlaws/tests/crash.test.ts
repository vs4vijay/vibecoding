import { describe, expect, test } from "bun:test";
import { COMBAT } from "../src/config";
import { isDowned, startCrash, stepDowned } from "../src/sim/crash";
import type { RaceState, Rider } from "../src/sim/types";
import { makeState } from "./helpers";

const DT = 1 / 60;

function makeDuo(): { state: RaceState; player: Rider; rival: Rider } {
  const state = makeState({ rivals: 1 });
  return { state, player: state.player, rival: state.rivals[0]! };
}

describe("startCrash", () => {
  test("zeroes speed and combat state, starts the tumble timer", () => {
    const { state, player } = makeDuo();
    player.speed = 9000;
    player.wobble = 0.8;
    player.attackT = 0.2;
    player.invulnT = 1.5;

    startCrash(state, player, "offroad");

    expect(player.speed).toBe(0);
    expect(player.downT).toBe(COMBAT.downTime);
    expect(player.downSpin).toBe(0);
    expect(player.attackT).toBe(0);
    expect(player.wobble).toBe(0);
    expect(player.invulnT).toBe(0);
    expect(isDowned(player)).toBe(true);
    expect(state.phase).toBe("racing"); // hp untouched => race continues
    expect(state.events.some((e) => e.type === "crash")).toBe(true);
    expect(state.toasts.some((t) => t.text === "WIPEOUT!" && t.big)).toBe(true);
  });

  test("player crash toast names the cause", () => {
    const cases: Array<["traffic" | "offroad" | "combat" | "wobble", string]> = [
      ["traffic", "TRAFFIC!"],
      ["offroad", "WIPEOUT!"],
      ["combat", "KNOCKED OUT!"],
      ["wobble", "KNOCKED OUT!"],
    ];
    for (const [cause, text] of cases) {
      const { state } = makeDuo();
      startCrash(state, state.player, cause);
      expect(state.toasts.some((t) => t.text === text)).toBe(true);
    }
  });

  test("player at hp <= 0 ends wrecked", () => {
    const { state, player } = makeDuo();
    player.hp = 0;
    startCrash(state, player, "combat");
    expect(state.phase).toBe("wrecked");
    const wrecked = state.events.filter((e) => e.type === "wrecked");
    expect(wrecked.length).toBe(1);
    expect(wrecked[0]!.big).toBe(true);
    expect(state.toasts.some((t) => t.text === "WRECKED!" && t.big)).toBe(true);
    // Still put on the tarmac so the tumble animates until race flow finalizes.
    expect(player.downT).toBe(COMBAT.downTime);
  });

  test("rival: combat/wobble emits knockdown, other causes emit crash", () => {
    const { state, rival } = makeDuo();
    startCrash(state, rival, "combat");
    expect(state.events.filter((e) => e.type === "knockdown").length).toBe(1);
    expect(state.events.some((e) => e.type === "crash")).toBe(false);
    expect(state.toasts.length).toBe(0); // rival crashes are not player toasts

    const second = makeDuo();
    startCrash(second.state, second.rival, "traffic");
    expect(second.state.events.filter((e) => e.type === "crash").length).toBe(1);
    expect(second.state.events.some((e) => e.type === "knockdown")).toBe(false);

    const third = makeDuo();
    startCrash(third.state, third.rival, "wobble");
    expect(third.state.events.some((e) => e.type === "knockdown")).toBe(true);
  });
});

describe("stepDowned", () => {
  test("downed riders spin while down, then remount with invulnerability", () => {
    const { state, player, rival } = makeDuo();
    player.speed = 8000;
    rival.speed = 8000;
    startCrash(state, player, "offroad");
    startCrash(state, rival, "combat");

    const halfway = COMBAT.downTime / 2;
    for (let i = 0; i < Math.round(halfway / DT); i++) stepDowned(state, DT);
    expect(player.downT).toBeCloseTo(halfway, 9);
    expect(player.downSpin).toBeCloseTo(halfway * 9, 9);
    expect(player.hp).toBe(100);

    for (let i = 0; i < Math.ceil(COMBAT.downTime / DT) + 2; i++) {
      stepDowned(state, DT);
    }

    for (const r of [player, rival]) {
      expect(r.downT).toBe(0);
      expect(r.downSpin).toBe(0);
      expect(r.speed).toBe(0);
      expect(r.invulnT).toBe(COMBAT.remountInvuln);
    }
    expect(state.events.filter((e) => e.type === "remount").length).toBe(2);
  });

  test("remount keeps player hp but resets rival hp to 60", () => {
    const { state, player, rival } = makeDuo();
    player.hp = 42;
    rival.hp = 7;
    startCrash(state, player, "traffic");
    startCrash(state, rival, "combat");

    for (let i = 0; i < Math.ceil(COMBAT.downTime / DT) + 1; i++) {
      stepDowned(state, DT);
    }

    expect(player.hp).toBe(42);
    expect(rival.hp).toBe(60);
  });

  test("riders who are up are untouched and never emit remounts", () => {
    const { state, player, rival } = makeDuo();
    player.speed = 6000;
    const z0 = player.z;
    for (let i = 0; i < 120; i++) stepDowned(state, DT);
    expect(player.speed).toBe(6000);
    expect(player.z).toBe(z0);
    expect(rival.downT).toBe(0);
    expect(state.events.filter((e) => e.type === "remount").length).toBe(0);
  });

  test("isDowned mirrors the tumble timer", () => {
    const { state, rival } = makeDuo();
    expect(isDowned(rival)).toBe(false);
    startCrash(state, rival, "wobble");
    expect(isDowned(rival)).toBe(true);
    for (let i = 0; i < Math.ceil(COMBAT.downTime / DT) + 1; i++) {
      stepDowned(state, DT);
    }
    expect(isDowned(rival)).toBe(false);
  });
});
