import { describe, test, expect } from "bun:test";
import { botThink } from "../../src/sim/bot";
import { makeFighter } from "../fixtures/helpers";

describe("bot utility AI", () => {
  test("close enemy → attacks", () => {
    const self = makeFighter({});
    const foe = makeFighter({ id: 2, slot: 1, x: self.x + 40 });
    const w = { tick: 0, seed: 1, rngState: 1, over: false, nextEntityId: 3,
      stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 },
               drops: { firstDropTick: 999999, intervalTicks: 1, intervalJitterTicks: 0, table: {} } },
      fighters: [self, foe], projectiles: [], pickups: [] };
    const inp = botThink(w, self, { sheets: new Map(), weapons: {}, items: {} });
    expect(inp.a).toBe(true);
  });

  test("dodges incoming projectile above all else", () => {
    const self = makeFighter({});
    const foe = makeFighter({ id: 2, slot: 1, x: self.x - 300, facing: 1 });
    const proj = { id: 5, ownerId: 2, spriteKey: "fx", projectileId: "shot",
      x: self.x - 60, y: -30, z: self.z, vx: 7, vy: 0, ttl: 100, pierce: false,
      box: { damage: 15, knockback: { vx: 3, vy: -1 }, hitstunTicks: 18, type: "projectile" as const, priority: 15 },
      size: { w: 24, h: 14, d: 14 }, gravity: 0, hitIds: new Set<number>() };
    const w = { tick: 10, seed: 1, rngState: 1, over: false, nextEntityId: 6,
      stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 },
               drops: { firstDropTick: 999999, intervalTicks: 1, intervalJitterTicks: 0, table: {} } },
      fighters: [self, foe], projectiles: [proj], pickups: [] };
    const inp = botThink(w, self, { sheets: new Map(), weapons: {}, items: {} });
    expect(inp.j || inp.dHeld).toBe(true);
  });

  test("decision lock prevents jitter", () => {
    const self = makeFighter({ cooldownUntilTick: 50 });
    const foe = makeFighter({ id: 2, slot: 1, x: self.x + 400 });
    const w = { tick: 20, seed: 1, rngState: 1, over: false, nextEntityId: 3,
      stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 },
               drops: { firstDropTick: 999999, intervalTicks: 1, intervalJitterTicks: 0, table: {} } },
      fighters: [self, foe], projectiles: [], pickups: [] };
    const inp = botThink(w, self, { sheets: new Map(), weapons: {}, items: {} });
    expect(inp.dir.x).toBe(0);                      // locked → neutral drift
  });

  test("bot in grabbing throws immediately, ignoring the decision lock", () => {
    const self = makeFighter({ state: "grabbing", cooldownUntilTick: 50 });
    const foe = makeFighter({ id: 2, slot: 1, x: self.x + 40 });
    const w = { tick: 20, seed: 1, rngState: 1, over: false, nextEntityId: 3,
      stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 },
               drops: { firstDropTick: 999999, intervalTicks: 1, intervalJitterTicks: 0, table: {} } },
      fighters: [self, foe], projectiles: [], pickups: [] };
    const inp = botThink(w, self, { sheets: new Map(), weapons: {}, items: {} });
    expect(inp.a).toBe(true);                       // throw input despite cooldownUntilTick
  });

  // Soak regression (rooftop-night seed=9, no matchEnd in 9000 ticks): the
  // melee band used to require !lowHp, so an all-low-HP endgame froze with
  // both bots idle face-to-face and nobody could land the killing blow.
  // Spec §4: <48 px → attack chains; HP < 25% only raises retreat weight.
  test("low-HP bot still attacks at point-blank", () => {
    const self = makeFighter({ hp: 50 });           // ≤ 25% of brawler maxHp 240
    const foe = makeFighter({ id: 2, slot: 1, x: self.x + 40 });
    const w = { tick: 0, seed: 1, rngState: 1, over: false, nextEntityId: 3,
      stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 },
               drops: { firstDropTick: 999999, intervalTicks: 1, intervalJitterTicks: 0, table: {} } },
      fighters: [self, foe], projectiles: [], pickups: [] };
    const sheets = new Map([["brawler", { maxHp: 240 }]]);
    const inp = botThink(w, self, { sheets, weapons: {}, items: {} });
    expect(inp.a).toBe(true);                       // swing, not a face-to-face stall
  });

  test("low-HP bot retreats from a distant foe", () => {
    // Fleeing is centre-ward only: self in the right half, foe to the right
    // → flee left has room (1200 > centre 800) → the retreat fires.
    const self = makeFighter({ hp: 50, x: 1200 });
    const foe = makeFighter({ id: 2, slot: 1, x: self.x + 300 });
    const w = { tick: 0, seed: 1, rngState: 1, over: false, nextEntityId: 3,
      stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 },
               drops: { firstDropTick: 999999, intervalTicks: 1, intervalJitterTicks: 0, table: {} } },
      fighters: [self, foe], projectiles: [], pickups: [] };
    const sheets = new Map([["brawler", { maxHp: 240 }]]);
    const inp = botThink(w, self, { sheets, weapons: {}, items: {} });
    expect(inp.dir.x).toBe(-1);                     // retreat weight flips approach
  });

  // Soak regression (FFA fix round, 9000-tick timeouts): a cornered low-HP
  // bot used to flee INTO the wall and dash there forever while its (also
  // fleeing) foes hovered out of reach — matches never ended. Fleeing is
  // vetoed when the flee direction has no centre-ward room; the bot keeps
  // the approach vector and fights instead.
  test("cornered low-HP bot approaches instead of fleeing into the wall", () => {
    const self = makeFighter({ hp: 50, x: 100 });   // near the left wall
    const foe = makeFighter({ id: 2, slot: 1, x: self.x + 300 });
    const w = { tick: 0, seed: 1, rngState: 1, over: false, nextEntityId: 3,
      stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 },
               drops: { firstDropTick: 999999, intervalTicks: 1, intervalJitterTicks: 0, table: {} } },
      fighters: [self, foe], projectiles: [], pickups: [] };
    const sheets = new Map([["brawler", { maxHp: 240 }]]);
    const inp = botThink(w, self, { sheets, weapons: {}, items: {} });
    expect(inp.dir.x).toBe(1);                      // toward the foe, not the wall
    expect(inp.a).toBe(false);                      // still outside swing range
  });

  // Soak regression (FFA fix round, 9000-tick timeouts): the decision lock's
  // neutral gaps re-emit a same-token direction edge every 12 ticks — inside
  // the 14-tick double-tap window — so close-range movement dash-chained at
  // 5 px/tick and overshot the <48 in-band window between decisions (the
  // final duel crossed for 1800+ ticks without a swing). Inside the retreat
  // trigger a repeated same-token edge is suppressed: the close-in walks.
  function closeInWorld(self: ReturnType<typeof makeFighter>, foeX: number, tick: number) {
    const foe = makeFighter({ id: 2, slot: 1, x: foeX });
    return { tick, seed: 1, rngState: 1, over: false, nextEntityId: 3,
      stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 },
               drops: { firstDropTick: 999999, intervalTicks: 1, intervalJitterTicks: 0, table: {} } },
      fighters: [self, foe], projectiles: [], pickups: [] };
  }

  test("close-in with a recent same-direction edge suppresses the re-dash", () => {
    const self = makeFighter({ x: 800 });
    const w = closeInWorld(self, 880, 100);         // dist 80: < 96, approach branch
    self.buffer.push({ a: false, j: false, dHeld: false, dir: { x: 1, z: 0 } }, 96);
    const inp = botThink(w, self, { sheets: new Map(), weapons: {}, items: {} });
    expect(inp.dir.x).toBe(0);                      // second tap suppressed: walk
  });

  test("close-in with an old same-direction edge proceeds toward the foe", () => {
    const self = makeFighter({ x: 800 });
    const w = closeInWorld(self, 880, 100);         // dist 80: < 96, approach branch
    self.buffer.push({ a: false, j: false, dHeld: false, dir: { x: 1, z: 0 } }, 84);
    const inp = botThink(w, self, { sheets: new Map(), weapons: {}, items: {} });
    expect(inp.dir.x).toBe(1);                      // edge stale: keep closing
  });

  // Soak regression (FFA fix round, 9000-tick timeouts): inside the <48 band
  // but outside the swing envelope (dz 40 > z reach), the old code swung
  // forever — the attack input suppresses locomotion, so the gap never
  // closed. The bot must reposition on foot instead of whiffing.
  test("melee-band foe outside swing z-reach → repositions, no whiffing swing", () => {
    const self = makeFighter({});
    const foe = makeFighter({ id: 2, slot: 1, x: self.x + 6, z: self.z + 40 });
    const w = { tick: 0, seed: 1, rngState: 1, over: false, nextEntityId: 3,
      stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 },
               drops: { firstDropTick: 999999, intervalTicks: 1, intervalJitterTicks: 0, table: {} } },
      fighters: [self, foe], projectiles: [], pickups: [] };
    const inp = botThink(w, self, { sheets: new Map(), weapons: {}, items: {} });
    expect(inp.a).toBe(false);                      // no guaranteed-whiff swing
    expect(inp.dir.z).toBe(1);                      // closes the z gap
    expect(inp.dir.x).toBe(1);                      // closes x on foot too
  });

  test("melee-band foe behind the facing → turn/approach, not a whiffing swing", () => {
    const self = makeFighter({ facing: 1 });
    const foe = makeFighter({ id: 2, slot: 1, x: self.x - 30 });
    const w = { tick: 0, seed: 1, rngState: 1, over: false, nextEntityId: 3,
      stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 },
               drops: { firstDropTick: 999999, intervalTicks: 1, intervalJitterTicks: 0, table: {} } },
      fighters: [self, foe], projectiles: [], pickups: [] };
    const inp = botThink(w, self, { sheets: new Map(), weapons: {}, items: {} });
    expect(inp.a).toBe(false);
    expect(inp.dir.x).toBe(-1);                     // toward the foe; walk flips facing
  });
});
