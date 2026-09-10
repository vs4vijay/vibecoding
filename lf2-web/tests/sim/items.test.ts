import { describe, test, expect } from "bun:test";
import { updateDrops, tryPickup, consume, startDrinking } from "../../src/sim/items";
import { advanceFighter } from "../../src/sim/fighter";
import sheet from "../fixtures/good-brawler.json";
import type { CharacterSheet, InputFrame, Pickup } from "../../src/sim/types";
import { makeFighter } from "../fixtures/helpers";

const S = sheet as unknown as CharacterSheet;
const NEUTRAL: InputFrame = { a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } };
const DROPS = { firstDropTick: 100, intervalTicks: 50, intervalJitterTicks: 0, table: { milk: 1 } };

function mkWorld(tick: number) {
  return { tick, pickups: [] as Pickup[], rngState: 42, seed: 42, nextEntityId: 100,
    fighters: [], projectiles: [], over: false,
    stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 }, drops: DROPS } };
}

describe("items", () => {
  test("no drops before firstDropTick", () => {
    const w = mkWorld(99);
    updateDrops(w);
    expect(w.pickups).toHaveLength(0);
  });

  test("drop lands after firstDropTick and uses ordered RNG draws", () => {
    const w = mkWorld(101);
    updateDrops(w);
    expect(w.pickups).toHaveLength(1);
    expect(w.pickups[0]!.kind).toBe("item");
  });
  test("pickup grants weapon with durability", () => {
    const f = makeFighter();
    const picked = tryPickup(f, { id: 9, kind: "weapon", defId: "knife", x: f.x, y: 0, z: f.z, vy: 0, spawnedTick: 0, shelfLifeTicks: 1200 },
      { knife: { kind: "thrown", meleeDamage: 12, throwDamage: 28, throwVy: -4.0, durability: 3, breakOnThrowImpact: true, carrierSpeedMul: 1.0, repickupDelayTicks: 20 } }, 0);
    expect(picked).toBe(true);
    expect(f.holdingWeapon).toBe("knife");
    expect(f.weaponDurability).toBe(3);
  });

  test("repickup delay blocks pickup until the tick passes (§3.3)", () => {
    const f = makeFighter();
    const W = { knife: { kind: "thrown", meleeDamage: 12, throwDamage: 28, throwVy: -4.0, durability: 3, breakOnThrowImpact: true, carrierSpeedMul: 1.0, repickupDelayTicks: 20 } };
    const dropped: Pickup = { id: 9, kind: "weapon", defId: "knife", x: f.x, y: 0, z: f.z, vy: 0, spawnedTick: 0, shelfLifeTicks: 1200, noPickupUntilTick: 20 };
    expect(tryPickup(f, dropped, W, 19)).toBe(false); // still locked
    expect(f.holdingWeapon).toBeUndefined();
    expect(tryPickup(f, dropped, W, 20)).toBe(true);  // lock lapses exactly on the tick
    expect(f.holdingWeapon).toBe("knife");
  });

  test("repickup delay does not gate drops without the field", () => {
    const f = makeFighter();
    const picked = tryPickup(f, { id: 9, kind: "weapon", defId: "knife", x: f.x, y: 0, z: f.z, vy: 0, spawnedTick: 0, shelfLifeTicks: 1200 },
      { knife: { kind: "thrown", meleeDamage: 12, throwDamage: 28, throwVy: -4.0, durability: 3, breakOnThrowImpact: true, carrierSpeedMul: 1.0, repickupDelayTicks: 20 } }, 5000);
    expect(picked).toBe(true);
  });

  test("consumption completes after consumeTicks and heals", () => {
    const f = makeFighter({ hp: 100 });
    const ITEMS = { milk: { effect: "healHp" as const, amount: 90, consumeTicks: 30, shelfLifeTicks: 1200 } };

    // Realistic path: startDrinking → advanceFighter ticks the state; heal
    // lands on completion via consume() before the FSM would idle it out.
    startDrinking(f, "milk");
    for (let t = 0; t < 29; t++) advanceFighter(f, NEUTRAL, S, { tick: t }, []);
    expect(f.state).toBe("drinking");
    expect(consume(f, ITEMS, "milk", [])).toBe(false);   // one more tick needed
    f.stateTick = 30;
    consume(f, ITEMS, "milk", []);
    expect(f.hp).toBe(190);
  });
});
