import { describe, expect, test } from "bun:test";
import type { InputState } from "../src/core/input";
import { COMBAT, PLAYER, SIM } from "../src/config";
import { raceMaxSpeed, stepPlayer } from "../src/sim/bike";
import {
  inStrikeRange,
  resolveCombat,
  tryAttack,
} from "../src/sim/combat";
import type { RaceState, Rider } from "../src/sim/types";
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

/** State with one rival parked alongside the player (0.5 to their right). */
function makeDuel(): { state: RaceState; player: Rider; rival: Rider } {
  const state = makeState({ rivals: 1 });
  const player = state.player;
  const rival = state.rivals[0]!;
  rival.z = player.z;
  rival.x = player.x + 0.5;
  return { state, player, rival };
}

/** Start a manual swing without touching the rng (kind is caller-chosen). */
function primeSwing(attacker: Rider, side: "left" | "right", kind: "punch" | "kick"): void {
  attacker.attackKind = kind;
  attacker.attackT = COMBAT.swingTime;
  attacker.attackHitDone = false;
  attacker.attackSide = side;
}

describe("inStrikeRange", () => {
  test("side semantics: 'left' means attacker.x < target.x", () => {
    const { player, rival } = makeDuel(); // rival at player.x + 0.5
    expect(inStrikeRange(player, rival, "left")).toBe(true);
    expect(inStrikeRange(player, rival, "right")).toBe(false);
    expect(inStrikeRange(rival, player, "right")).toBe(true);
    expect(inStrikeRange(rival, player, "left")).toBe(false);
  });

  test("gap must be within [minSideGap, maxSideGap]", () => {
    const { player, rival } = makeDuel();
    rival.x = player.x + COMBAT.minSideGap;
    expect(inStrikeRange(player, rival, "left")).toBe(true);
    rival.x = player.x + COMBAT.minSideGap - 0.001;
    expect(inStrikeRange(player, rival, "left")).toBe(false);
    rival.x = player.x + COMBAT.maxSideGap;
    expect(inStrikeRange(player, rival, "left")).toBe(true);
    rival.x = player.x + COMBAT.maxSideGap + 0.001;
    expect(inStrikeRange(player, rival, "left")).toBe(false);
  });

  test("longitudinal reach is ±rangeZ", () => {
    const { player, rival } = makeDuel();
    rival.z = player.z + COMBAT.rangeZ;
    expect(inStrikeRange(player, rival, "left")).toBe(true);
    rival.z = player.z - COMBAT.rangeZ;
    expect(inStrikeRange(player, rival, "left")).toBe(true);
    rival.z = player.z + COMBAT.rangeZ + 1;
    expect(inStrikeRange(player, rival, "left")).toBe(false);
    rival.z = player.z - COMBAT.rangeZ - 1;
    expect(inStrikeRange(player, rival, "left")).toBe(false);
  });

  test("downed riders can neither strike nor be struck", () => {
    const { player, rival } = makeDuel();
    rival.downT = 1;
    expect(inStrikeRange(player, rival, "left")).toBe(false);
    rival.downT = 0;
    player.downT = 1;
    expect(inStrikeRange(player, rival, "left")).toBe(false);
  });
});

describe("tryAttack", () => {
  test("starts a swing when a target is in range", () => {
    const { state, player } = makeDuel();
    expect(tryAttack(state, player, "left")).toBe(true);
    expect(player.attackT).toBe(COMBAT.swingTime);
    expect(player.attackHitDone).toBe(false);
    expect(player.attackSide).toBe("left");
    expect(player.attackKind === "punch" || player.attackKind === "kick").toBe(true);
    const swings = state.events.filter((e) => e.type === "swing");
    expect(swings.length).toBe(1);
    expect(swings[0]!.side).toBe("left");
    expect(swings[0]!.z).toBe(player.z);
  });

  test("refuses with no target in range", () => {
    const { state, player, rival } = makeDuel();
    rival.z += COMBAT.rangeZ * 3;
    expect(tryAttack(state, player, "left")).toBe(false);
    expect(player.attackT).toBe(0);
    expect(state.events.length).toBe(0);
  });

  test("refuses while swinging / on cooldown / downed", () => {
    const { state, player, rival } = makeDuel();
    expect(tryAttack(state, player, "left")).toBe(true);
    expect(tryAttack(state, player, "left")).toBe(false); // mid-swing

    // Burn the swing timer (0.42s > swingTime) — cooldown still running.
    for (let i = 0; i < 25; i++) resolveCombat(state, DT);
    expect(player.attackT).toBe(0);
    expect(player.attackCd).toBeGreaterThan(0);
    expect(tryAttack(state, player, "left")).toBe(false);

    // Past the 0.55s cooldown a new swing goes.
    for (let i = 0; i < 20; i++) resolveCombat(state, DT);
    expect(player.attackCd).toBe(0);
    expect(tryAttack(state, player, "left")).toBe(true);

    // Downed riders never swing.
    player.attackT = 0;
    player.attackCd = 0;
    player.downT = 1;
    expect(tryAttack(state, player, "left")).toBe(false);
    void rival;
  });

  test("cops only strike the player; rivals never strike cops", () => {
    const state = makeState({ rivals: 2 });
    const cop = state.rivals[0]!;
    const other = state.rivals[1]!;
    cop.kind = "cop";
    state.player.z = 80000; // player far away

    // Cop alongside a plain rival: no legal target on either side.
    cop.z = other.z;
    cop.x = other.x - 0.5;
    expect(tryAttack(state, cop, "left")).toBe(false);
    expect(tryAttack(state, cop, "right")).toBe(false);

    // Rival alongside the cop: still refused (rivals don't fight cops).
    expect(tryAttack(state, other, "right")).toBe(false);

    // Once the player is alongside, the cop can strike.
    cop.z = state.player.z;
    cop.x = state.player.x - 0.5;
    expect(tryAttack(state, cop, "left")).toBe(true);
  });
});

describe("resolveCombat: hit resolution", () => {
  test("a swing lands damage exactly once", () => {
    const { state, player, rival } = makeDuel();
    primeSwing(player, "left", "punch");

    for (let i = 0; i < 60; i++) resolveCombat(state, DT);

    expect(rival.hp).toBe(100 - COMBAT.punchDamage);
    expect(player.attackHitDone).toBe(true);
    expect(state.events.filter((e) => e.type === "hit-given").length).toBe(1);
    expect(state.events.filter((e) => e.type === "hit-taken").length).toBe(1);
    expect(state.toasts.some((t) => t.text === "HIT!")).toBe(true);
  });

  test("impact lands at impactAt, not at swing start", () => {
    const { state, rival } = makeDuel();
    primeSwing(state.player, "left", "punch");
    resolveCombat(state, DT);
    expect(rival.hp).toBe(100); // swing just started — no damage yet
  });

  test("wobble and cleanT: player weight scales wobble, hits reset clean", () => {
    // Two identical duels, only the player's bike weight differs.
    const mk = (weight: number) => {
      const s = makeState({ rivals: 1, seed: 7, bike: { weight } });
      const r = s.rivals[0]!;
      r.z = s.player.z;
      r.x = s.player.x - 0.5; // attacker sits left of the player
      s.player.cleanT = 10;
      return s;
    };
    const hitOnce = (s: RaceState): { wobble: number; cleanT: number } => {
      expect(tryAttack(s, s.rivals[0]!, "left")).toBe(true);
      for (let i = 0; i < 60 && s.player.hp >= 100; i++) resolveCombat(s, DT);
      return { wobble: s.player.wobble, cleanT: s.player.cleanT };
    };

    const a = mk(1);
    const b = mk(2);
    const ra = hitOnce(a);
    const rb = hitOnce(b);

    // The rival is the attacker here; the player is the target.
    const kindA = a.rivals[0]!.attackKind;
    const kindB = b.rivals[0]!.attackKind;
    expect(kindA).toBe(kindB); // same seed => same kind
    const base = kindA === "punch" ? COMBAT.punchWobble : COMBAT.kickWobble;
    expect(ra.wobble).toBeCloseTo(base, 12);
    expect(rb.wobble).toBeCloseTo(base / 2, 12); // weight 2 halves the wobble
    expect(ra.cleanT).toBe(0); // taking a hit resets the clean timer
    expect(a.rivals[0]!.cleanT).toBe(0); // giving one does too
  });

  test("player getting punched/kicked sees the toast", () => {
    const { state, rival } = makeDuel();
    primeSwing(rival, "right", "kick"); // rival sits 0.5 to the player's other side
    for (let i = 0; i < 60; i++) resolveCombat(state, DT);
    expect(state.player.hp).toBe(100 - COMBAT.kickDamage);
    expect(state.toasts.some((t) => t.text === "KICKED!")).toBe(true);
    expect(state.toasts.some((t) => t.text === "HIT!")).toBe(false);
  });

  test("hp <= 0 target is knocked down exactly once", () => {
    const { state, player, rival } = makeDuel();
    rival.hp = 20; // punch (22) and kick (34) both finish this
    primeSwing(player, "left", "punch");

    for (let i = 0; i < 60; i++) resolveCombat(state, DT);

    expect(rival.hp).toBeLessThanOrEqual(0);
    expect(rival.downT).toBe(COMBAT.downTime);
    expect(rival.speed).toBe(0);
    expect(rival.wobble).toBe(0);
    expect(state.events.filter((e) => e.type === "knockdown").length).toBe(1);
    expect(state.toasts.some((t) => t.text === "DOWN!")).toBe(true);
    expect(state.phase).toBe("racing"); // only the player going down ends things
  });

  test("wobble >= 1 at speed knocks the rider down and resets wobble", () => {
    const { state, rival } = makeDuel();
    rival.speed = raceMaxSpeed(state); // above knockdownSpeedFrac
    rival.wobble = 1.2; // clearly past 1 even after one tick of decay
    resolveCombat(state, DT);
    expect(rival.downT).toBe(COMBAT.downTime);
    expect(rival.wobble).toBe(0);
  });

  test("wobble alone below the speed threshold never knocks down", () => {
    const { state, rival } = makeDuel();
    rival.speed = COMBAT.knockdownSpeedFrac * raceMaxSpeed(state) * 0.5;
    rival.wobble = 1.5;
    resolveCombat(state, DT);
    expect(rival.downT).toBe(0);
  });
});

describe("resolveCombat: cop bust pressure", () => {
  function makeBustStop(): { state: RaceState; cop: Rider } {
    const state = makeState({ rivals: 1 });
    const cop = state.rivals[0]!;
    cop.kind = "cop";
    cop.z = state.player.z;
    cop.x = state.player.x + 0.2;
    state.player.speed = 0;
    return { state, cop };
  }

  test("slow player boxed by a cop accumulates pressure at 1/copBustTime per second", () => {
    const { state } = makeBustStop();
    for (let i = 0; i < 60; i++) resolveCombat(state, DT);
    expect(state.bustPressure).toBeCloseTo((60 * DT) / COMBAT.copBustTime, 5);
    expect(state.phase).toBe("racing");
  });

  test("1.5s of pressure busts the player", () => {
    const { state } = makeBustStop();
    for (let i = 0; i < 100; i++) resolveCombat(state, DT);
    expect(state.bustPressure).toBeGreaterThanOrEqual(1);
    expect(state.phase).toBe("busted");
    expect(state.events.filter((e) => e.type === "busted").length).toBe(1);
    expect(state.toasts.some((t) => t.text === "BUSTED!" && t.big)).toBe(true);
  });

  test("a fast player never accumulates", () => {
    const { state } = makeBustStop();
    state.player.speed = raceMaxSpeed(state);
    for (let i = 0; i < 120; i++) resolveCombat(state, DT);
    expect(state.bustPressure).toBe(0);
    expect(state.phase).toBe("racing");
  });

  test("pressure decays at 0.5/s once the cop backs off", () => {
    const state = makeState({ rivals: 0 });
    state.bustPressure = 0.6;
    for (let i = 0; i < 60; i++) resolveCombat(state, DT);
    expect(state.bustPressure).toBeCloseTo(0.1, 9);
  });

  test("cop-alert fires once per approach", () => {
    const { state } = makeBustStop();
    for (let i = 0; i < 90; i++) resolveCombat(state, DT);
    expect(state.events.filter((e) => e.type === "cop-alert").length).toBe(1);
  });
});

describe("player HP regen (stepPlayer)", () => {
  test("no regen before regenDelay seconds of clean riding", () => {
    const state = makeState();
    state.player.hp = 50;
    state.player.cleanT = 0;
    for (let i = 0; i < 180; i++) stepPlayer(state, input({ throttle: true }), DT);
    expect(state.player.cleanT).toBeCloseTo(3, 9);
    expect(state.player.hp).toBe(50);
  });

  test("regen ticks in at hpRegen/s once clean, capped at 100", () => {
    const state = makeState();
    state.player.hp = 50;
    state.player.cleanT = PLAYER.regenDelay - 1;
    for (let i = 0; i < 120; i++) stepPlayer(state, input({ throttle: true }), DT);
    expect(state.player.cleanT).toBeCloseTo(PLAYER.regenDelay + 1, 9);
    expect(state.player.hp).toBeCloseTo(52, 9);

    state.player.hp = 99.5;
    state.player.cleanT = 99;
    for (let i = 0; i < 30; i++) stepPlayer(state, input(), DT);
    expect(state.player.hp).toBe(100);
  });
});

describe("combat determinism", () => {
  test("same seed + same script => byte-identical state", () => {
    const mk = (): RaceState => {
      const s = makeState({ rivals: 2, seed: 2024 });
      const r = s.rivals[0]!;
      r.z = s.player.z;
      r.x = s.player.x + 0.5;
      return s;
    };
    const a = mk();
    const b = mk();
    for (let i = 0; i < 120; i++) {
      if (i === 5 || i === 70) {
        tryAttack(a, a.player, "left");
        tryAttack(b, b.player, "left");
      }
      resolveCombat(a, DT);
      resolveCombat(b, DT);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
