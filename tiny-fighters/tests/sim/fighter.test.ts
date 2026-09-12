import { describe, test, expect } from "bun:test";
import { advanceFighter, tryStartMove } from "../../src/sim/fighter";
import { integrateFighter } from "../../src/sim/physics";
import { spawnMatch, stepWorld } from "../../src/sim/world";
import {
  RUN_DASH_SPEED, THROW_LAUNCH_VX, KNOCKDOWN_LAUNCH_VY,
  DASH_TICKS, GRAB_BREAK_TICKS, DOUBLE_TAP_WINDOW_TICKS, GRAB_RANGE,
  BURN_TICKS, BURN_DPS_TICKS,
} from "../../src/sim/constants";
import { makeFighter } from "../fixtures/helpers";
import sheet from "../fixtures/good-brawler.json";
import weaponsJson from "../../src/data/weapons.json";
import type { InputFrame, CharacterSheet, SimEvent, Projectile, WeaponLike } from "../../src/sim/types";

const WEAPONS = weaponsJson as unknown as Record<string, WeaponLike>;

const S = sheet as unknown as CharacterSheet;
const NEUTRAL: InputFrame = { a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } };

function run(fighterInput: Partial<InputFrame>, ticks: number) {
  const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
  const events: SimEvent[] = [];
  const inp = { ...NEUTRAL, ...fighterInput };
  for (let t = 0; t < ticks; t++) {
    f.buffer.push(inp, t);
    advanceFighter(f, inp, S, { tick: t }, events);
  }
  return { f, events };
}

function feedSeq(f: ReturnType<typeof makeFighter>, events: SimEvent[]): void {
  // D (t0) … D+> (t2) … D+>+A (t4) — the D>A chord pattern from the matcher tests.
  const seq: Array<[number, InputFrame]> = [
    [0, { ...NEUTRAL, dHeld: true }],
    [2, { ...NEUTRAL, dHeld: true, dir: { x: 1, z: 0 } }],
    [4, { ...NEUTRAL, dHeld: true, dir: { x: 1, z: 0 }, a: true }],
  ];
  let last = 0;
  for (const [t, inp] of seq) {
    for (; last < t; last++) { f.buffer.push(NEUTRAL, last); advanceFighter(f, NEUTRAL, S, { tick: last }, events); }
    f.buffer.push(inp, t); advanceFighter(f, inp, S, { tick: t }, events);
    last = t + 1;
  }
  for (; last < 35; last++) { f.buffer.push(NEUTRAL, last); advanceFighter(f, NEUTRAL, S, { tick: last }, events); }
}

describe("fighter FSM", () => {
  test("A starts punch1 and walks its frames", () => {
    const { f } = run({ a: true }, 4);
    expect(f.state).toBe("attack");
    expect(f.moveId).toBe("punch1");
    expect(f.frameTick).toBeGreaterThan(0);
  });

  test("A pressed during punch1 cancel window reroutes into punch2", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
    const events: SimEvent[] = [];
    const start = { ...NEUTRAL, a: true };
    f.buffer.push(start, 0);
    advanceFighter(f, start, S, { tick: 0 }, events);   // punch1 starts at t=0
    expect(f.moveId).toBe("punch1");
    expect(f.state).toBe("attack");
    for (let t = 1; t <= 3; t++) {
      f.buffer.push(NEUTRAL, t);
      advanceFighter(f, NEUTRAL, S, { tick: t }, events);
    }
    const inp = { ...NEUTRAL, a: true };                // A during window (move-ticks 3..10)
    f.buffer.push(inp, 4);
    advanceFighter(f, inp, S, { tick: 4 }, events);
    expect(f.moveId).toBe("punch2");
  });

  test("mashing A chains the full punch1→punch2→punch3 chain", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
    const events: SimEvent[] = [];
    // Presses at t=0,4,8 — each lands inside its move's cancel window
    const isPress = (t: number): boolean => t === 0 || t === 4 || t === 8;
    for (let t = 0; t <= 8; t++) {
      const inp = { ...NEUTRAL, a: isPress(t) };
      f.buffer.push(inp, t);
      advanceFighter(f, inp, S, { tick: t }, events);
    }
    expect(f.moveId).toBe("punch3");
  });

  test("D>A fires energyBlast, charges 25 MP once, emits castFire, ends idle", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
    const events: SimEvent[] = [];
    feedSeq(f, events);
    expect(f.state).toBe("idle");                   // blast fully recovered (18 ticks)
    expect(f.moveId).toBeUndefined();
    expect(f.mp).toBeCloseTo(100 - 25 + 31 * S.mpRegenPerTick);   // charged once @t4; below-cap regen t4..34
  });

  test("insufficient MP leaves the special unmatched", () => {
    const f = makeFighter({ hp: S.maxHp, mp: 10 });
    const events: SimEvent[] = [];
    feedSeq(f, events);
    expect(f.state).toBe("idle");
    expect(f.moveId).toBeUndefined();
    expect(f.mp).toBeCloseTo(10 + 35 * S.mpRegenPerTick);          // regen only from t0, never charged
  });

  test("J jumps with sheet impulse, arcs, and lands back to idle", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
    const inp = { ...NEUTRAL, j: true };
    f.buffer.push(inp, 0);
    advanceFighter(f, inp, S, { tick: 0 }, []);
    expect(f.state).toBe("jump");
    expect(f.vy).toBeLessThanOrEqual(-8.5);
    integrateFighter(f, 0);
    let landed = false;
    for (let t = 1; t < 120; t++) {
      f.buffer.push(NEUTRAL, t);
      advanceFighter(f, NEUTRAL, S, { tick: t }, []);
      if (f.state === "idle") { landed = true; break; }
    }
    expect(landed).toBe(true);
    expect(f.y).toBe(0);
  });

  test("hitstun expires back to idle after 16 ticks", () => {
    const f = makeFighter({ state: "hitstun", stateTick: 14 });
    advanceFighter(f, NEUTRAL, S, { tick: 50 }, []);
    expect(f.state).toBe("hitstun");                // 15 < 16
    advanceFighter(f, NEUTRAL, S, { tick: 51 }, []);
    expect(f.state).toBe("idle");
  });

  test("blockstun holds 10 ticks then idles", () => {
    const f = makeFighter({ state: "blockstun", stateTick: 8 });   // uniform increment-then-compare timers
    advanceFighter(f, NEUTRAL, S, { tick: 0 }, []);
    expect(f.state).toBe("blockstun");              // 9 < 10
    advanceFighter(f, NEUTRAL, S, { tick: 1 }, []);
    expect(f.state).toBe("idle");
  });

  test("knockdown rises to getup at 40 with i-frames, then idles at 18", () => {
    const f = makeFighter({ state: "knockdown" });
    for (let t = 0; t < 39; t++) advanceFighter(f, NEUTRAL, S, { tick: t }, []);
    expect(f.state).toBe("knockdown");
    advanceFighter(f, NEUTRAL, S, { tick: 39 }, []);
    expect(f.state).toBe("getup");
    expect(f.invulnUntilTick).toBe(39 + 24);
    for (let t = 40; t < 57; t++) advanceFighter(f, NEUTRAL, S, { tick: t }, []);
    expect(f.state).toBe("getup");
    advanceFighter(f, NEUTRAL, S, { tick: 57 }, []);
    expect(f.state).toBe("idle");
  });

  test("drinking locks for 30 ticks then idles", () => {
    const f = makeFighter({ state: "drinking" });
    for (let t = 0; t < 29; t++) advanceFighter(f, NEUTRAL, S, { tick: t }, []);
    expect(f.state).toBe("drinking");
    advanceFighter(f, NEUTRAL, S, { tick: 29 }, []);
    expect(f.state).toBe("idle");
  });

  test("A from dash starts roles.dashAttack (flyingKnee), not punch1", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp, state: "dash" });
    const inp = { ...NEUTRAL, a: true };
    f.buffer.push(inp, 0);
    advanceFighter(f, inp, S, { tick: 0 }, []);
    expect(f.state).toBe("attack");
    expect(f.moveId).toBe("flyingKnee");
  });

  test("double-tap > within the window enters dash at RUN_DASH_SPEED", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
    const events: SimEvent[] = [];
    const right: InputFrame = { ...NEUTRAL, dir: { x: 1, z: 0 } };
    for (let t = 0; t <= DOUBLE_TAP_WINDOW_TICKS - 9; t++) {     // taps at t0 and t5
      const inp = t === 0 || t === 5 ? right : NEUTRAL;
      f.buffer.push(inp, t);
      advanceFighter(f, inp, S, { tick: t }, events);
    }
    expect(f.state).toBe("dash");
    expect(f.vx).toBe(RUN_DASH_SPEED);
    expect(f.facing).toBe(1);
    expect(events.filter((e) => e.type === "dash")).toHaveLength(1);
  });

  test("double-tap < dashes the other way", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
    const events: SimEvent[] = [];
    const left: InputFrame = { ...NEUTRAL, dir: { x: -1, z: 0 } };
    for (let t = 0; t <= 4; t++) {
      const inp = t === 0 || t === 4 ? left : NEUTRAL;
      f.buffer.push(inp, t);
      advanceFighter(f, inp, S, { tick: t }, events);
    }
    expect(f.state).toBe("dash");
    expect(f.vx).toBe(-RUN_DASH_SPEED);
    expect(f.facing).toBe(-1);
  });

  test("two taps 30 ticks apart do not dash", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
    const events: SimEvent[] = [];
    const right: InputFrame = { ...NEUTRAL, dir: { x: 1, z: 0 } };
    for (let t = 0; t <= 30; t++) {
      const inp = t === 0 || t === 30 ? right : NEUTRAL;
      f.buffer.push(inp, t);
      advanceFighter(f, inp, S, { tick: t }, events);
    }
    expect(f.state).toBe("walk");                   // second tap is just a step
    expect(events.filter((e) => e.type === "dash")).toHaveLength(0);
  });

  test("dash holds its course then expires to idle after DASH_TICKS", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
    const events: SimEvent[] = [];
    const right: InputFrame = { ...NEUTRAL, dir: { x: 1, z: 0 } };
    for (let t = 0; t <= 5; t++) {                  // enter dash at t5
      const inp = t === 0 || t === 5 ? right : NEUTRAL;
      f.buffer.push(inp, t);
      advanceFighter(f, inp, S, { tick: t }, events);
    }
    expect(f.state).toBe("dash");
    for (let t = 6; t < 5 + DASH_TICKS; t++) {      // neutral: burst keeps running
      f.buffer.push(NEUTRAL, t);
      advanceFighter(f, NEUTRAL, S, { tick: t }, events);
      expect(f.state).toBe("dash");
      expect(f.vx).toBe(RUN_DASH_SPEED);
    }
    f.buffer.push(NEUTRAL, 5 + DASH_TICKS);          // stateTick reaches DASH_TICKS
    advanceFighter(f, NEUTRAL, S, { tick: 5 + DASH_TICKS }, events);
    expect(f.state).toBe("idle");
    expect(f.vx).toBe(0);
  });

  test("double-tap then A starts roles.dashAttack (flyingKnee)", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
    const events: SimEvent[] = [];
    const right: InputFrame = { ...NEUTRAL, dir: { x: 1, z: 0 } };
    for (let t = 0; t <= 5; t++) {
      const inp = t === 0 || t === 5 ? right : NEUTRAL;
      f.buffer.push(inp, t);
      advanceFighter(f, inp, S, { tick: t }, events);
    }
    const inp = { ...NEUTRAL, a: true };
    f.buffer.push(inp, 6);
    advanceFighter(f, inp, S, { tick: 6 }, events);
    expect(f.state).toBe("attack");
    expect(f.moveId).toBe("flyingKnee");
  });

  test("grab exchange: attack throws — victim arcs out and lands in a knockdown", () => {
    const atk = makeFighter({ id: 1, hp: S.maxHp, mp: S.maxMp, state: "grabbing", stateTick: 0, facing: 1 });
    const vic = makeFighter({ id: 2, slot: 1, hp: S.maxHp, mp: S.maxMp, state: "grabbed", stateTick: 0 });
    const events: SimEvent[] = [];
    const world = { tick: 100, fighters: [atk, vic] };
    const inp = { ...NEUTRAL, a: true };
    atk.buffer.push(inp, 100);
    advanceFighter(atk, inp, S, world, events);
    expect(vic.state).toBe("thrown");
    expect(vic.stateTick).toBe(0);
    expect(vic.vx).toBe(THROW_LAUNCH_VX * 1);
    expect(vic.vy).toBe(KNOCKDOWN_LAUNCH_VY);
    expect(atk.state).toBe("attack");
    expect(atk.moveId).toBe(S.grabMoveId);
    expect(events.find((e) => e.type === "thrown")).toMatchObject({ victim: vic.id });

    // World order per tick: advance each fighter, then integrate.
    advanceFighter(vic, NEUTRAL, S, { tick: 100, fighters: [atk, vic] }, events);
    integrateFighter(atk, 100);
    integrateFighter(vic, 100);
    let landed = -1;
    for (let t = 101; t < 140 && landed < 0; t++) {
      atk.buffer.push(NEUTRAL, t);
      vic.buffer.push(NEUTRAL, t);
      advanceFighter(atk, NEUTRAL, S, { tick: t, fighters: [atk, vic] }, events);
      advanceFighter(vic, NEUTRAL, S, { tick: t, fighters: [atk, vic] }, events);
      integrateFighter(atk, t);
      integrateFighter(vic, t);
      if (vic.state === "knockdown") landed = t;
    }
    expect(landed).toBeGreaterThan(0);
    expect(vic.invulnUntilTick).toBe(landed + 24);   // get-up i-frames on impact
  });

  test("grab timeout releases both fighters; victim gets i-frames", () => {
    const atk = makeFighter({ id: 1, hp: S.maxHp, mp: S.maxMp, state: "grabbing", stateTick: 0, facing: 1 });
    const vic = makeFighter({ id: 2, slot: 1, hp: S.maxHp, mp: S.maxMp, state: "grabbed", stateTick: 0 });
    const events: SimEvent[] = [];
    for (let t = 0; t <= GRAB_BREAK_TICKS; t++) {
      atk.buffer.push(NEUTRAL, t);
      vic.buffer.push(NEUTRAL, t);
      advanceFighter(atk, NEUTRAL, S, { tick: t, fighters: [atk, vic] }, events);
      advanceFighter(vic, NEUTRAL, S, { tick: t, fighters: [atk, vic] }, events);
    }
    expect(atk.state).toBe("idle");
    expect(vic.state).toBe("idle");
    // Release fires when the grabber's stateTick reaches GRAB_BREAK_TICKS,
    // i.e. after 60 advances starting at tick 0 → at world tick 59.
    expect(vic.invulnUntilTick).toBe(GRAB_BREAK_TICKS - 1 + 24);
  });

  test("A with a foe just inside GRAB_RANGE ahead opens the grab (grabMoveId)", () => {
    const atk = makeFighter({ id: 1, hp: S.maxHp, mp: S.maxMp, facing: 1 });
    const foe = makeFighter({ id: 2, slot: 1, hp: S.maxHp, mp: S.maxMp, x: 800 + GRAB_RANGE, facing: -1 });
    const world = { tick: 0, fighters: [atk, foe] };
    const inp = { ...NEUTRAL, a: true };
    atk.buffer.push(inp, 0);
    advanceFighter(atk, inp, S, world, []);
    expect(atk.state).toBe("attack");
    expect(atk.moveId).toBe(S.grabMoveId);
  });

  test("A with the foe beyond grab range starts the neutral attack instead", () => {
    const atk = makeFighter({ id: 1, hp: S.maxHp, mp: S.maxMp, facing: 1 });
    const foe = makeFighter({ id: 2, slot: 1, hp: S.maxHp, mp: S.maxMp, x: 800 + 200, facing: -1 });
    const world = { tick: 0, fighters: [atk, foe] };
    const inp = { ...NEUTRAL, a: true };
    atk.buffer.push(inp, 0);
    advanceFighter(atk, inp, S, world, []);
    expect(atk.state).toBe("attack");
    expect(atk.moveId).toBe("punch1");
  });

  // Soak regression (FFA fix round, 9000-tick timeouts): bots at point-blank
  // always grabbed (grab reach 62 > neutral band 48), and since throws carry
  // no HP damage two adjacent bots exchanged zero-damage throws forever —
  // final-duel hp frozen for 2000+ ticks. A bot inside the neutral band
  // swings the neutral attack; the grab stays an arm's-length option.
  test("bot A at point-blank swings the neutral attack, not the grab", () => {
    const atk = makeFighter({ id: 1, hp: S.maxHp, mp: S.maxMp, facing: 1, isBot: true });
    const foe = makeFighter({ id: 2, slot: 1, hp: S.maxHp, mp: S.maxMp, x: 800 + GRAB_RANGE, facing: -1 });
    const world = { tick: 0, fighters: [atk, foe] };
    const inp = { ...NEUTRAL, a: true };
    atk.buffer.push(inp, 0);
    advanceFighter(atk, inp, S, world, []);
    expect(atk.state).toBe("attack");
    expect(atk.moveId).toBe("punch1");
  });

  test("bot A at arm's length still opens the grab", () => {
    const atk = makeFighter({ id: 1, hp: S.maxHp, mp: S.maxMp, facing: 1, isBot: true });
    const foe = makeFighter({ id: 2, slot: 1, hp: S.maxHp, mp: S.maxMp, x: 800 + GRAB_RANGE + 14, facing: -1 });
    const world = { tick: 0, fighters: [atk, foe] };
    const inp = { ...NEUTRAL, a: true };
    atk.buffer.push(inp, 0);
    advanceFighter(atk, inp, S, world, []);
    expect(atk.state).toBe("attack");
    expect(atk.moveId).toBe(S.grabMoveId);
  });

  // Soak regression (FFA fix round, 9000-tick timeouts): a bot re-grabbed its
  // just-thrown victim the tick the landing i-frames lapsed — still mid
  // knockdown — re-launching it forever. Throws carry no damage, so the duel
  // dealt 0 hp per cycle and matches never ended. Grab initiation targets
  // standing foes only; the downed victim eats the neutral swing instead.
  test("A does not initiate a grab on a downed (knockdown) foe", () => {
    const atk = makeFighter({ id: 1, hp: S.maxHp, mp: S.maxMp, facing: 1 });
    const foe = makeFighter({ id: 2, slot: 1, hp: S.maxHp, mp: S.maxMp, state: "knockdown", stateTick: 30, x: 800 + GRAB_RANGE, facing: -1 });
    const world = { tick: 0, fighters: [atk, foe] };
    const inp = { ...NEUTRAL, a: true };
    atk.buffer.push(inp, 0);
    advanceFighter(atk, inp, S, world, []);
    expect(atk.state).toBe("attack");
    expect(atk.moveId).toBe("punch1");
  });

  test("A with the foe behind (facing away) starts the neutral attack instead", () => {
    const atk = makeFighter({ id: 1, hp: S.maxHp, mp: S.maxMp, facing: 1 });
    const foe = makeFighter({ id: 2, slot: 1, hp: S.maxHp, mp: S.maxMp, x: 800 - GRAB_RANGE, facing: 1 });
    const world = { tick: 0, fighters: [atk, foe] };
    const inp = { ...NEUTRAL, a: true };
    atk.buffer.push(inp, 0);
    advanceFighter(atk, inp, S, world, []);
    expect(atk.state).toBe("attack");
    expect(atk.moveId).toBe("punch1");
  });

  test("walking follows direction and stops back to idle", () => {
    const { f } = run({ dir: { x: 1, z: 0 } }, 3);
    expect(f.state).toBe("walk");
    expect(f.facing).toBe(1);
    f.buffer.push(NEUTRAL, 3);
    advanceFighter(f, NEUTRAL, S, { tick: 3 }, []);
    expect(f.state).toBe("idle");
  });

  test("frozen thaws and burned burns out per constants", () => {
    const frozen = makeFighter({ state: "frozen" });
    for (let t = 0; t < 119; t++) advanceFighter(frozen, NEUTRAL, S, { tick: t }, []);
    expect(frozen.state).toBe("frozen");
    advanceFighter(frozen, NEUTRAL, S, { tick: 119 }, []);
    expect(frozen.state).toBe("idle");

    const burned = makeFighter({ state: "burned" });
    for (let t = 0; t < 44; t++) advanceFighter(burned, NEUTRAL, S, { tick: t }, []);
    expect(burned.state).toBe("burned");
    advanceFighter(burned, NEUTRAL, S, { tick: 44 }, []);
    expect(burned.state).toBe("idle");
  });

  test("mp regenerates every tick up to the cap", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp - 0.1 });
    advanceFighter(f, NEUTRAL, S, { tick: 0 }, []);
    expect(f.mp).toBeCloseTo(S.maxMp - 0.05);
    for (let t = 1; t < 20; t++) advanceFighter(f, NEUTRAL, S, { tick: t }, []);
    expect(f.mp).toBe(S.maxMp);
  });
});

// ---------------------------------------------------------------------------
// Task 12.5 — projectile spawning (spec §3.2) + weapon mechanics (§3.3).
// The brawler fixture carries energyBlast (spawnProjectile on frame 1) but no
// projectiles record, so the tests mount one at runtime, mirroring
// src/data/characters/brawler.json's energyShot entry.
const ENERGY_SHOT = {
  sprite: "fx_energy_shot", size: { w: 24, h: 14, d: 14 },
  velocityVx: 7.0, gravity: 0, ttlTicks: 130, pierce: false,
  damage: 15, knockback: { vx: 3.0, vy: -1.0 }, hitstunTicks: 18,
  type: "projectile" as const, priority: 15,
};
const SP = { ...S, projectiles: { energyShot: ENERGY_SHOT } } as unknown as CharacterSheet;

/** D>A feed like feedSeq above, but stepping a caller-owned TickWorld slice. */
function feedSeqWorld(
  f: ReturnType<typeof makeFighter>, sh: CharacterSheet,
  world: { tick: number; projectiles?: Projectile[]; nextEntityId?: number; weapons?: Record<string, WeaponLike> },
  events: SimEvent[],
): void {
  const seq: Array<[number, InputFrame]> = [
    [0, { ...NEUTRAL, dHeld: true }],
    [2, { ...NEUTRAL, dHeld: true, dir: { x: 1, z: 0 } }],
    [4, { ...NEUTRAL, dHeld: true, dir: { x: 1, z: 0 }, a: true }],
  ];
  let last = 0;
  for (const [t, inp] of seq) {
    for (; last < t; last++) { f.buffer.push(NEUTRAL, last); world.tick = last; advanceFighter(f, NEUTRAL, sh, world, events); }
    f.buffer.push(inp, t); world.tick = t; advanceFighter(f, inp, sh, world, events);
    last = t + 1;
  }
  for (; last < 35; last++) { f.buffer.push(NEUTRAL, last); world.tick = last; advanceFighter(f, NEUTRAL, sh, world, events); }
}

describe("projectile spawning (spec §3.2)", () => {
  test("D>A energyBlast spawns energyShot on the cast frame with sheet fields", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
    const events: SimEvent[] = [];
    const projectiles: Projectile[] = [];
    const world = { tick: 0, projectiles, nextEntityId: 100 };
    feedSeqWorld(f, SP, world, events);
    expect(projectiles).toHaveLength(1);              // cast frame lasts 4 ticks: fired ONCE
    const p = projectiles[0]!;
    expect(p.id).toBe(100);                           // nextEntityId consumed
    expect(world.nextEntityId).toBe(101);
    expect(p.ownerId).toBe(f.id);
    expect(p.spriteKey).toBe("fx_energy_shot");
    expect(p.projectileId).toBe("energyShot");
    expect(p.vx).toBe(7.0);                           // velocityVx × facing(1)
    expect(p.x).toBe(f.x + 28);                       // offsetX × facing
    expect(p.y).toBe(f.y - 36);                       // offsetY, unmirrored
    expect(p.z).toBe(f.z);
    expect(p.vy).toBe(0);                             // sheet shots start flat
    expect(p.ttl).toBe(130);
    expect(p.gravity).toBe(0);
    expect(p.pierce).toBe(false);
    expect(p.box.damage).toBe(15);
    expect(p.box.type).toBe("projectile");
    expect(p.box.priority).toBe(15);
    expect(events.some((e) => e.type === "castFire")).toBe(true);
  });

  test("spawn mirrors a left-facing caster (vx and offsetX flip)", () => {
    // Drive the cast via tryStartMove: the D>A chord's own locomotion turns a
    // caster toward ">", which would mask the facing mirror under test.
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp, facing: -1 });
    const events: SimEvent[] = [];
    const projectiles: Projectile[] = [];
    const world = { tick: 0, projectiles, nextEntityId: 100 };
    tryStartMove(f, "energyBlast", SP, world, events);
    for (let t = 0; t < 12; t++) {
      world.tick = t;
      f.buffer.push(NEUTRAL, t);
      advanceFighter(f, NEUTRAL, SP, world, events);
    }
    expect(projectiles).toHaveLength(1);
    expect(projectiles[0]!.vx).toBe(-7.0);
    expect(projectiles[0]!.x).toBe(f.x - 28);
  });

  test("bare { tick } worlds (no projectiles slice) never spawn", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp });
    const events: SimEvent[] = [];
    feedSeq(f, events);                               // legacy helper: world = { tick }
    expect(f.state).toBe("idle");
    expect(f.moveId).toBeUndefined();
  });
});

describe("weapon mechanics (spec §3.3)", () => {
  test("carrierSpeedMul scales walk speed while held (boulder crawl)", () => {
    const holder = makeFighter({ hp: S.maxHp, mp: S.maxMp, holdingWeapon: "boulder", weaponDurability: 1 });
    const inp: InputFrame = { ...NEUTRAL, dir: { x: 1, z: 0 } };
    holder.buffer.push(inp, 0);
    advanceFighter(holder, inp, S, { tick: 0, weapons: WEAPONS }, []);
    expect(holder.state).toBe("walk");
    expect(holder.vx).toBeCloseTo(S.walkSpeed * 0.55);

    // Without a weapons slice (bare { tick } callers) the walk is unscaled.
    const bare = makeFighter({ hp: S.maxHp, mp: S.maxMp, holdingWeapon: "boulder", weaponDurability: 1 });
    bare.buffer.push(inp, 0);
    advanceFighter(bare, inp, S, { tick: 0 }, []);
    expect(bare.vx).toBe(S.walkSpeed);
  });

  test("carrierSpeedMul scales the dash burst too (run is scaled per §3.3)", () => {
    const holder = makeFighter({ hp: S.maxHp, mp: S.maxMp, holdingWeapon: "boulder", weaponDurability: 1 });
    const right: InputFrame = { ...NEUTRAL, dir: { x: 1, z: 0 } };
    for (let t = 0; t <= 5; t++) {                     // double-tap at t0/t5
      const inp = t === 0 || t === 5 ? right : NEUTRAL;
      holder.buffer.push(inp, t);
      advanceFighter(holder, inp, S, { tick: t, weapons: WEAPONS }, []);
    }
    expect(holder.state).toBe("dash");
    expect(holder.vx).toBeCloseTo(RUN_DASH_SPEED * 0.55);
  });

  test("attack with a thrown-kind weapon throws it: projectile + consumed, no move", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp, holdingWeapon: "knife", weaponDurability: 3 });
    const projectiles: Projectile[] = [];
    const events: SimEvent[] = [];
    const inp = { ...NEUTRAL, a: true };
    f.buffer.push(inp, 0);
    advanceFighter(f, inp, S, { tick: 0, projectiles, nextEntityId: 7, weapons: WEAPONS }, events);
    expect(f.state).toBe("idle");                     // NO attack move starts
    expect(f.moveId).toBeUndefined();
    expect(f.holdingWeapon).toBeUndefined();          // held instance expended
    expect(f.weaponDurability).toBeUndefined();
    expect(events.some((e) => e.type === "hit")).toBe(false);
    expect(projectiles).toHaveLength(1);
    const p = projectiles[0]!;
    expect(p.id).toBe(7);
    expect(p.ownerId).toBe(f.id);
    expect(p.projectileId).toBe("knife");
    expect(p.spriteKey).toBe("prop_knife");
    expect(p.vx).toBe(8.0);                           // fixed throw speed × facing
    expect(p.vy).toBe(-4.0);                          // throwVy
    expect(p.gravity).toBe(0.2);
    expect(p.pierce).toBe(false);
    expect(p.box.damage).toBe(28);                    // throwDamage
    expect(p.box.type).toBe("projectile");
    expect(p.box.priority).toBe(15);
    expect(p.hitIds.has(f.id)).toBe(false);
    expect(p.thrownWeapon).toEqual({ defId: "knife", breakOnThrowImpact: true });
  });

  test("without a projectiles slice the thrown-kind attack falls back to the swing", () => {
    const f = makeFighter({ hp: S.maxHp, mp: S.maxMp, holdingWeapon: "knife", weaponDurability: 3 });
    const inp = { ...NEUTRAL, a: true };
    f.buffer.push(inp, 0);
    advanceFighter(f, inp, S, { tick: 0, weapons: WEAPONS }, []);
    expect(f.state).toBe("attack");                   // normal punch, knife kept
    expect(f.holdingWeapon).toBe("knife");
  });
});

// ---------------------------------------------------------------------------
// Task 12.6 — burn DOT (spec §2.2): burned fighters take BURN_DPS_TICKS per
// tick, damage BEFORE the state's expiry check. No attacker → no hit event;
// a burn KO is settled by the world's end-of-tick match sweep.

describe("burn DOT (spec §2.2)", () => {
  test("burned fighters drain 0.5 hp/tick; the ending tick still deals damage, then the drain stops", () => {
    expect(BURN_DPS_TICKS).toBe(0.5);                 // pin the per-tick rate
    const f = makeFighter({ state: "burned", hp: 100, burnUntilTick: BURN_TICKS });
    const events: SimEvent[] = [];
    for (let t = 0; t < BURN_TICKS; t++) {
      advanceFighter(f, NEUTRAL, S, { tick: t }, events);
      expect(f.hp).toBeCloseTo(100 - (t + 1) * BURN_DPS_TICKS);
      expect(f.state).toBe("burned");
    }
    // Expiry tick: damage lands FIRST, then the state clears.
    advanceFighter(f, NEUTRAL, S, { tick: BURN_TICKS }, events);
    expect(f.state).toBe("idle");
    expect(f.hp).toBeCloseTo(100 - (BURN_TICKS + 1) * BURN_DPS_TICKS);
    // Burned out: no further drain.
    const hpAfter = f.hp;
    for (let t = BURN_TICKS + 1; t < BURN_TICKS + 40; t++) {
      advanceFighter(f, NEUTRAL, S, { tick: t }, events);
    }
    expect(f.hp).toBe(hpAfter);
  });

  test("a burn that outlasts hp kills: hp clamps to 0, state dead, ko exactly once, no hit event", () => {
    const f = makeFighter({ state: "burned", hp: 1.2, burnUntilTick: BURN_TICKS });
    const events: SimEvent[] = [];
    for (let t = 0; t < 5; t++) advanceFighter(f, NEUTRAL, S, { tick: t }, events);
    expect(f.state).toBe("dead");
    expect(f.hp).toBe(0);
    expect(events.filter((e) => e.type === "ko")).toHaveLength(1);
    expect(events.some((e) => e.type === "hit")).toBe(false);
    // Corpses neither act nor re-emit: further ticks add no events.
    for (let t = 5; t < 10; t++) advanceFighter(f, NEUTRAL, S, { tick: t }, events);
    expect(events).toHaveLength(1);
  });

  test("a burn KO ends the match through the world-level sweep (hitdetect untouched)", () => {
    // hitdetect's checkMatchEnd only runs on its damage path; the end-of-tick
    // emitMatchEndIfNeeded keys off the alive sets, so a DOT kill must still
    // flip `over` and emit matchEnd with the survivor's team.
    const stage = { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 },
      bounds: { w: 1600, h: 480, d: 120 },
      drops: { firstDropTick: 600, intervalTicks: 900, intervalJitterTicks: 180,
               table: { milk: 3, knife: 2 } } };
    const sheets = new Map([["brawler", S]]);
    const ctx = { sheets, weapons: {}, items: {} };
    const w = spawnMatch({ seed: 3, stage,
      slots: [
        { isHuman: true, charId: "brawler", team: "red" },
        { isHuman: true, charId: "brawler", team: "blue" },
      ], sheets, weapons: {}, items: {} } as never);
    Object.assign(w.fighters[1]!, { state: "burned", stateTick: 0, hp: 0.5, burnUntilTick: 45 });
    const r = stepWorld(w, [NEUTRAL, NEUTRAL], ctx as never);
    expect(r.state.fighters[1]!.state).toBe("dead");
    expect(r.state.fighters[1]!.hp).toBe(0);
    expect(r.events.filter((e) => e.type === "ko")).toEqual([{ type: "ko", victim: 1 }]);
    expect(r.state.over).toBe(true);
    expect(r.events.some((e) => e.type === "matchEnd" && e.winnerTeam === "red")).toBe(true);
  });
});
