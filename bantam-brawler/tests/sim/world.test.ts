import { describe, test, expect } from "bun:test";
import { spawnMatch, stepWorld } from "../../src/sim/world";
import type { WeaponDef } from "../../src/sim/world";
import sheet from "../fixtures/good-brawler.json";
import weaponsJson from "../../src/data/weapons.json";
import type { CharacterSheet, InputFrame } from "../../src/sim/types";

const S = sheet as unknown as CharacterSheet;
const NEUTRAL: InputFrame = { a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } };

function mkCtx() {
  return {
    sheets: new Map([["brawler", S]]),
    weapons: {}, items: {},
    stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 },
             bounds: { w: 1600, h: 480, d: 120 },
             drops: { firstDropTick: 600, intervalTicks: 900, intervalJitterTicks: 180,
                      table: { milk: 3, knife: 2 } } },
  };
}

describe("world", () => {
  test("spawnMatch fills slots deterministically", () => {
    const w = spawnMatch({ seed: 7, stage: mkCtx().stage,
      slots: [
        { isHuman: true, charId: "brawler", team: "red" },
        { isHuman: false, charId: "brawler", team: "blue" },
      ], sheets: new Map([["brawler", S]]), weapons: {}, items: {} } as never);
    expect(w.fighters).toHaveLength(2);
    expect(w.fighters[0]!.x).toBeGreaterThan(0);
    expect(w.tick).toBe(0);
    const w2 = spawnMatch({ seed: 7, stage: mkCtx().stage,
      slots: [
        { isHuman: true, charId: "brawler", team: "red" },
        { isHuman: false, charId: "brawler", team: "blue" },
      ], sheets: new Map([["brawler", S]]), weapons: {}, items: {} } as never);
    expect(w2.fighters.map((f) => [f.x, f.z])).toEqual(w.fighters.map((f) => [f.x, f.z]));
  });

  test("stepWorld advances tick and returns events", () => {
    const w = spawnMatch({ seed: 7, stage: mkCtx().stage,
      slots: [{ isHuman: true, charId: "brawler", team: "independent" }],
      sheets: new Map([["brawler", S]]), weapons: {}, items: {} } as never);
    const r = stepWorld(w, [NEUTRAL], mkCtx());
    expect(r.state.tick).toBe(1);
    expect(Array.isArray(r.events)).toBe(true);
  });

  test("two humans fighting to KO ends match with winner event", () => {
    const w = spawnMatch({ seed: 3, stage: mkCtx().stage,
      slots: [
        { isHuman: true, charId: "brawler", team: "red" },
        { isHuman: true, charId: "brawler", team: "blue" },
      ], sheets: new Map([["brawler", S]]), weapons: {}, items: {} } as never);
    w.fighters[1]!.hp = 5;
    // place attacker adjacent facing victim mid punch1 active frame
    Object.assign(w.fighters[0]!, { state: "attack", moveId: "punch1", frameIdx: 1, frameTick: 1, facing: 1 });
    w.fighters[1]!.x = w.fighters[0]!.x + 30;
    const ctx = mkCtx();
    let last;
    // stepWorld is value-semantics: thread the returned state forward.
    let cur = w;
    for (let i = 0; i < 10 && !cur.over; i++) {
      last = stepWorld(cur, [NEUTRAL, NEUTRAL], ctx);
      cur = last.state;
    }
    expect(cur.over).toBe(true);
    expect(last!.events.some((e) => e.type === "matchEnd")).toBe(true);
  });

  // Arm killer to land a lethal punch1 on the victim on the next step.
  function armKill(w: ReturnType<typeof spawnMatch>, killer: number, victim: number): void {
    w.fighters[victim]!.hp = 5;
    w.fighters[victim]!.x = w.fighters[killer]!.x + 30;
    w.fighters[victim]!.z = w.fighters[killer]!.z;
    Object.assign(w.fighters[killer]!, { state: "attack", moveId: "punch1", frameIdx: 1, frameTick: 1, facing: 1 });
    w.fighters[killer]!.hitIds.clear();        // fresh swing: clear once-per-swing set
  }

  // Arm killer to land a lethal punch1 on the victim; the active frame
  // arrives a couple of ticks into the swing, so — like the test above —
  // step a bounded loop, threading stepWorld's returned state, stopping at
  // the tick the match flips (or 10 ticks when it must not flip).
  function stepKills(
    w: ReturnType<typeof spawnMatch>, inputs: InputFrame[],
    ctx: ReturnType<typeof mkCtx>,
  ): ReturnType<typeof stepWorld> {
    let last = stepWorld(w, inputs, ctx);
    for (let i = 0; i < 9 && !last.state.over; i++) {
      last = stepWorld(last.state, inputs, ctx);
    }
    return last;
  }

  // Regression (fix round 1): FFA used to end at the FIRST kill because the
  // emit pass treated all independents as one alive "team". VS mode is last
  // fighter standing: the first KO must not end the match; only when at most
  // one fighter remains alive does matchEnd fire, winner "independent".
  test("FFA (all independent) continues past the first KO, ends with one left", () => {
    const ctx = mkCtx();
    let cur = spawnMatch({ seed: 5, stage: ctx.stage,
      slots: [
        { isHuman: true, charId: "brawler", team: "independent" },
        { isHuman: true, charId: "brawler", team: "independent" },
        { isHuman: true, charId: "brawler", team: "independent" },
      ], sheets: ctx.sheets, weapons: {}, items: {} } as never);

    // First KO: two fighters still alive → match must keep going.
    armKill(cur, 0, 1);
    let last = stepKills(cur, [NEUTRAL, NEUTRAL, NEUTRAL], ctx);
    cur = last.state;
    expect(cur.fighters[1]!.state).toBe("dead");
    expect(cur.over).toBe(false);
    for (let i = 0; i < 30; i++) {             // settle: still no end in sight
      last = stepWorld(cur, [NEUTRAL, NEUTRAL, NEUTRAL], ctx);
      cur = last.state;
    }
    expect(cur.over).toBe(false);
    expect(last!.events.some((e) => e.type === "matchEnd")).toBe(false);

    // Second KO: lone survivor → over, winner is the survivor's team.
    armKill(cur, 0, 2);
    last = stepKills(cur, [NEUTRAL, NEUTRAL, NEUTRAL], ctx);
    cur = last.state;
    expect(cur.fighters[2]!.state).toBe("dead");
    expect(cur.over).toBe(true);
    expect(last!.events.some((e) => e.type === "matchEnd" && e.winnerTeam === "independent")).toBe(true);
  });

  // Guards the unchanged team path: the match only ends when a whole team is
  // wiped, and the winner is that lone surviving team.
  test("2-team roster ends when one team is wiped, winner is surviving team", () => {
    const ctx = mkCtx();
    let cur = spawnMatch({ seed: 5, stage: ctx.stage,
      slots: [
        { isHuman: true, charId: "brawler", team: "red" },
        { isHuman: true, charId: "brawler", team: "red" },
        { isHuman: true, charId: "brawler", team: "blue" },
        { isHuman: true, charId: "brawler", team: "blue" },
      ], sheets: ctx.sheets, weapons: {}, items: {} } as never);

    // First blue dies: red and blue both still alive → not over.
    armKill(cur, 0, 2);
    let last = stepKills(cur, [NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL], ctx);
    cur = last.state;
    expect(cur.fighters[2]!.state).toBe("dead");
    expect(cur.over).toBe(false);

    // Second blue dies: red is the lone surviving team → over, winner red.
    armKill(cur, 0, 3);
    last = stepKills(cur, [NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL], ctx);
    cur = last.state;
    expect(cur.fighters[3]!.state).toBe("dead");
    expect(cur.over).toBe(true);
    expect(last!.events.some((e) => e.type === "matchEnd" && e.winnerTeam === "red")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Final review — nextEntityId write-back. stepWorld builds a TickWorld slice
// for advanceFighter; FSM-spawned projectiles increment the slice's id counter
// but the world's was never advanced, so ids repeated and could collide with
// pickup ids (dropWeaponPickup/spawnPickup draw from w.nextEntityId).
describe("entity id uniqueness", () => {
  // good-brawler energyBlast is D>A (25 MP, projectile on move frame 1).
  const D: InputFrame = { a: false, j: false, dHeld: true, dir: { x: 0, z: 0 } };
  const D_RIGHT: InputFrame = { a: false, j: false, dHeld: true, dir: { x: 1, z: 0 } };
  const D_RIGHT_A: InputFrame = { a: true, j: false, dHeld: true, dir: { x: 1, z: 0 } };
  const CAST: InputFrame[] = [D, D_RIGHT, D_RIGHT_A];

  function castCtx() {
    const base = mkCtx();
    // Early first drop so a pickup id lands inside the observed window,
    // between the first and second cast.
    return {
      ...base,
      stage: { ...base.stage, drops: { ...base.stage.drops, firstDropTick: 40 } },
    };
  }

  test("two sequential special casts spawn distinct projectile ids; no pickup id ever collides", () => {
    const ctx = castCtx();
    let cur = spawnMatch({ seed: 9, stage: ctx.stage,
      slots: [{ isHuman: true, charId: "brawler", team: "independent" }],
      sheets: ctx.sheets, weapons: {}, items: {} } as never);

    const projIds: number[] = [];
    const pickupIds: number[] = [];
    const observe = (w: ReturnType<typeof spawnMatch>): void => {
      for (const p of w.projectiles) if (!projIds.includes(p.id)) projIds.push(p.id);
      for (const p of w.pickups) if (!pickupIds.includes(p.id)) pickupIds.push(p.id);
    };
    const run = (frames: InputFrame[]): void => {
      for (const f of frames) {
        cur = stepWorld(cur, [f], ctx).state;
        observe(cur);
      }
    };

    run([...CAST, ...Array(10).fill(NEUTRAL)]);              // cast 1 (projectile spawns ~7 ticks in)
    run([...Array(30).fill(NEUTRAL)]);                       // move ends, MP regen
    run([...CAST, ...Array(10).fill(NEUTRAL)]);              // cast 2
    run(Array(40).fill(NEUTRAL));                            // run past firstDropTick (drop observed)

    expect(projIds).toHaveLength(2);                         // exactly the two casts' shots
    expect(projIds[0]).not.toBe(projIds[1]);                 // second id differs from the first
    expect(pickupIds.length).toBeGreaterThan(0);             // a drop really happened in-window
    for (const id of pickupIds) expect(projIds).not.toContain(id); // no pickup/projectile collision
  });
});
// Throwing always expends the held instance; floor landing drops a pickup
// with the repickup delay; wall contact destroys breakOnThrowImpact weapons
// and drops the rest at the last position.
describe("thrown weapons", () => {
  function thrownCtx() {
    const base = mkCtx();
    return { ...base, weapons: weaponsJson as Record<string, WeaponDef> };
  }

  const PRESS: InputFrame = { a: true, j: false, dHeld: false, dir: { x: 0, z: 0 } };

  function thrower(defId: string, durability: number, x: number, seed = 11) {
    const ctx = thrownCtx();
    const w = spawnMatch({ seed, stage: ctx.stage,
      slots: [
        { isHuman: true, charId: "brawler", team: "red" },
        { isHuman: true, charId: "brawler", team: "blue" },
      ], sheets: ctx.sheets, weapons: {}, items: {} } as never);
    Object.assign(w.fighters[0]!, { holdingWeapon: defId, weaponDurability: durability, facing: 1, x });
    return { ctx, w };
  }

  test("attack throws the knife; floor landing drops a pickup with noPickupUntilTick", () => {
    const { ctx, w } = thrower("knife", 3, 700);
    const r = stepWorld(w, [PRESS, NEUTRAL], ctx);
    expect(r.state.fighters[0]!.holdingWeapon).toBeUndefined();   // instance expended
    expect(r.state.projectiles.some((p) => p.projectileId === "knife")).toBe(true);

    let cur = r.state;
    for (let i = 0; i < 120 && cur.pickups.length === 0; i++) {
      cur = stepWorld(cur, [NEUTRAL, NEUTRAL], ctx).state;
    }
    expect(cur.projectiles.some((p) => p.projectileId === "knife")).toBe(false);
    expect(cur.pickups).toHaveLength(1);
    const pk = cur.pickups[0]!;
    expect(pk.defId).toBe("knife");
    expect(pk.kind).toBe("weapon");
    expect(pk.noPickupUntilTick).toBe(cur.tick + 20);             // repickupDelayTicks
  });

  test("breakOnThrowImpact weapon is destroyed outright on wall contact", () => {
    const { ctx, w } = thrower("knife", 3, 1560);                 // 20px from the right wall
    let cur = stepWorld(w, [PRESS, NEUTRAL], ctx).state;
    expect(cur.projectiles.some((p) => p.projectileId === "knife")).toBe(true);
    for (let i = 0; i < 60 && cur.projectiles.length > 0; i++) {
      cur = stepWorld(cur, [NEUTRAL, NEUTRAL], ctx).state;
    }
    expect(cur.projectiles).toHaveLength(0);
    expect(cur.pickups).toHaveLength(0);                          // destroyed, not dropped
  });

  test("non-break thrown weapon hitting a wall drops as a pickup", () => {
    // No authored weapon is both thrown-kind and non-break, so the soft-wall
    // branch is exercised with a synthetic in-flight throw (same metadata the
    // FSM attaches when expending a held instance).
    const { ctx, w } = thrower("knife", 3, 700);
    w.projectiles.push({
      id: 500, ownerId: w.fighters[0]!.id, spriteKey: "prop_baseball-bat",
      projectileId: "baseball-bat",
      x: 1596, y: -30, z: w.fighters[0]!.z, vx: 8, vy: 0, ttl: 300, pierce: false,
      box: { damage: 14, knockback: { vx: 3, vy: -1 }, hitstunTicks: 18, type: "projectile", priority: 15 },
      size: { w: 16, h: 16, d: 16 }, gravity: 0.2, hitIds: new Set<number>(),
      thrownWeapon: { defId: "baseball-bat", breakOnThrowImpact: false },
    });
    const cur = stepWorld(w, [NEUTRAL, NEUTRAL], ctx).state;
    expect(cur.projectiles.some((p) => p.projectileId === "baseball-bat")).toBe(false);
    expect(cur.pickups).toHaveLength(1);
    expect(cur.pickups[0]!.defId).toBe("baseball-bat");
    expect(cur.pickups[0]!.noPickupUntilTick).toBe(cur.tick + 20);
  });
});
