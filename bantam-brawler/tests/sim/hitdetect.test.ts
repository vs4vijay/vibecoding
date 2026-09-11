// Task 6 TDD — spec §2.4 ordered hit-resolution pipeline.
// Verbatim from task-6-brief.md except the final trade test, whose last two
// expectations are corrected per the binding semantics note: punches are
// sorted priority-desc, so punch3 (priority 12) resolves BEFORE punch1 (10).
// Its launch stuns fighter 1 mid-swing, and a swing only connects while its
// owner is still mid-move when the box's turn arrives — so punch1 never
// lands and the "victim clipped by punch1" line in the brief was the
// documented arithmetic slip.
import { describe, test, expect } from "bun:test";
import { resolveHits, resolveProjectiles } from "../../src/sim/hitdetect";
import { tryStartMove } from "../../src/sim/fighter";
import { makeFighter } from "../fixtures/helpers";
import sheet from "../fixtures/good-brawler.json";
import weaponsJson from "../../src/data/weapons.json";
import type {
  WorldState, CharacterSheet, SimEvent, Fighter, HitboxDef,
  Projectile, WeaponLike,
} from "../../src/sim/types";
import { THAW_TICKS, BURN_TICKS } from "../../src/sim/constants";

const S = sheet as unknown as CharacterSheet;
const WEAPONS = weaponsJson as unknown as Record<string, WeaponLike>;

function worldWith(a = makeFighter({ x: 800 }), b = makeFighter({ id: 2, x: 830, slot: 1 })): WorldState {
  return {
    tick: 100, seed: 1, rngState: 1,
    stage: { id: "t", walls: { left: 0, right: 1600, restitution: 0.4 }, bounds: { w: 1600, h: 480, d: 120 },
             drops: { firstDropTick: 600, intervalTicks: 900, intervalJitterTicks: 0, table: {} } },
    fighters: [a, b], projectiles: [], pickups: [], nextEntityId: 10, over: false,
  };
}

/** Force attacker into active punch1 frame facing victim. */
function attacking(attacker = makeFighter({ x: 800 }), victimX = 830) {
  attacker.state = "attack"; attacker.moveId = "punch1"; attacker.frameIdx = 1; attacker.frameTick = 1; attacker.facing = 1;
  const victim = makeFighter({ id: 2, slot: 1, x: victimX });
  const w = worldWith(attacker, victim);
  return w;
}

describe("hit resolution", () => {
  test("active hitbox damages, applies knockback and hitstun", () => {
    const w = attacking();
    const events: SimEvent[] = [];
    resolveHits(w, new Map([["brawler", S]]), events);
    const victim = w.fighters[1]!;
    expect(victim.hp).toBe(232);                       // 240 − 8
    expect(victim.state).toBe("hitstun");
    expect(victim.vx).toBeGreaterThan(0);              // knocked away
    expect(events.some((e) => e.type === "hit")).toBe(true);
  });

  test("each swing hits a victim once (hitIds)", () => {
    const w = attacking();
    const events: SimEvent[] = [];
    resolveHits(w, new Map([["brawler", S]]), events);
    resolveHits(w, new Map([["brawler", S]]), events);
    expect(w.fighters[1]!.hp).toBe(232);               // second call no-op same swing
  });

  test("a NEW swing hits again (hitIds clears at move start)", () => {
    const w = attacking();
    const events: SimEvent[] = [];
    resolveHits(w, new Map([["brawler", S]]), events);
    expect(w.fighters[1]!.hp).toBe(232);
    // Attacker recovers and throws a fresh punch: the once-per-swing set
    // must reset, or no fighter could ever land a second hit in a match.
    const attacker = w.fighters[0]!;
    tryStartMove(attacker, "punch1", S, { tick: w.tick }, events);
    attacker.frameIdx = 1;                             // wind-up → active frame
    attacker.frameTick = 1;
    resolveHits(w, new Map([["brawler", S]]), events);
    expect(w.fighters[1]!.hp).toBe(224);               // 232 − 8
  });

  test("i-frames reject hits", () => {
    const w = attacking(undefined, 830);
    w.fighters[1]!.invulnUntilTick = 150;
    const events: SimEvent[] = [];
    resolveHits(w, new Map([["brawler", S]]), events);
    expect(w.fighters[1]!.hp).toBe(240);
    expect(events.some((e) => e.type === "hit")).toBe(false);
  });

  test("launch knockback forces knockdown", () => {
    const w = attacking(undefined, 830);
    // craft a launch: use punch3's vy:-6 hitbox by switching move
    const a = w.fighters[0]!;
    a.moveId = "punch3"; a.frameIdx = 1; a.frameTick = 1;
    const events: SimEvent[] = [];
    resolveHits(w, new Map([["brawler", S]]), events);
    expect(w.fighters[1]!.state).toBe("knockdown");
  });

  test("priority tiebreak: higher priority wins mutual trades", () => {
    const w = attacking(makeFighter({ x: 800 }), 805);   // overlapping boxes both active
    const b = w.fighters[1]!;
    b.state = "attack"; b.moveId = "punch3"; b.frameIdx = 1; b.frameTick = 1; b.facing = -1;
    const events: SimEvent[] = [];
    resolveHits(w, new Map([["brawler", S]]), events);
    // punch3 (priority 12) sorts ahead of punch1 (10) and resolves first:
    // fighter 0 eats the launch; fighter 1 is stunned mid-swing so punch1
    // (its box's turn comes later) never lands.
    expect(w.fighters[0]!.state).toBe("knockdown");      // eaten the launch
    expect(w.fighters[1]!.hp).toBe(240);                 // punch1 cancelled before connecting
    expect(w.fighters[1]!.state).toBe("hitstun");        // stunned out of the swing
    const hits = events.filter((e) => e.type === "hit");
    expect(hits.length).toBe(1);                         // exactly one box connected
    expect(hits[0]).toMatchObject({ attacker: w.fighters[1]!.id, victim: w.fighters[0]!.id });
  });
});

// Synthetic sheet: good-brawler.json has no status boxes, so build tiny moves
// whose single active frame (index 0) carries grab / freeze / burn / lethal boxes.
function box(over: Partial<HitboxDef> = {}): HitboxDef {
  return { x: 20, y: -34, z: 0, w: 10, h: 40, d: 44, damage: 6,
           knockback: { vx: 1, vy: 0 }, hitstunTicks: 10, type: "light", priority: 10, ...over };
}
const SYNTH = {
  id: "synth", maxHp: 240, maxMp: 100, mpRegenPerTick: 0,
  walkSpeed: 2, runSpeed: 5, jumpImpulse: -8,
  moves: {
    grab: { frames: [{ sprite: "g", durationTicks: 4, vx: 0, vy: 0, vz: 0,
      hitbox: box({ damage: 0, type: "grab", priority: 25 }) }] },
    freeze: { frames: [{ sprite: "f", durationTicks: 4, vx: 0, vy: 0, vz: 0,
      hitbox: box({ status: "freeze" }) }] },
    burn: { frames: [{ sprite: "b", durationTicks: 4, vx: 0, vy: 0, vz: 0,
      hitbox: box({ damage: 10, status: "burn" }) }] },
    lethal: { frames: [{ sprite: "l", durationTicks: 4, vx: 0, vy: 0, vz: 0,
      hitbox: box({ damage: 999, type: "heavy" }) }] },
  },
} as unknown as CharacterSheet;
const SM = new Map([["synth", SYNTH]]);

function synthAttacker(moveId: string, over: Partial<Fighter> = {}): Fighter {
  const f = makeFighter({ charId: "synth", x: 795, facing: 1, ...over });
  f.state = "attack"; f.moveId = moveId; f.frameIdx = 0; f.frameTick = 0;
  return f;
}

describe("hit resolution — grabs & status", () => {
  test("grab box routes to applyGrab: states set, event emitted, no damage", () => {
    const a = synthAttacker("grab");
    const v = makeFighter({ id: 2, slot: 1, charId: "synth", x: 815 });
    const w = worldWith(a, v);
    const events: SimEvent[] = [];
    resolveHits(w, SM, events);
    expect(v.state).toBe("grabbed");
    expect(a.state).toBe("grabbing");
    expect(v.hp).toBe(240);
    expect(events.filter((e) => e.type === "grab")).toHaveLength(1);
    expect(events.find((e) => e.type === "grab")).toMatchObject({ who: a.id, victim: v.id });
  });

  test("second grabber cannot steal an already-engaged victim", () => {
    const a1 = synthAttacker("grab", { id: 1, x: 795, facing: 1 });   // box centre 815
    const a2 = synthAttacker("grab", { id: 2, slot: 1, x: 835, facing: -1 }); // box centre 815
    const v = makeFighter({ id: 3, slot: 2, charId: "synth", x: 815 });
    const w = worldWith(a1, a2);
    w.fighters.push(v);
    const events: SimEvent[] = [];
    resolveHits(w, SM, events);
    expect(v.state).toBe("grabbed");
    expect(a1.state).toBe("grabbing");                                // first (id asc) grabs
    expect(a2.state).toBe("attack");                                  // second unaffected, not stuck
    expect(events.filter((e) => e.type === "grab")).toHaveLength(1);
    expect(events.find((e) => e.type === "grab")).toMatchObject({ who: a1.id, victim: v.id });
  });

  test("freeze-status box freezes victim with THAW timer", () => {
    const a = synthAttacker("freeze");
    const v = makeFighter({ id: 2, slot: 1, charId: "synth", x: 815 });
    const w = worldWith(a, v);
    const events: SimEvent[] = [];
    resolveHits(w, SM, events);
    expect(v.state).toBe("frozen");
    expect(v.hp).toBe(234);                                           // 240 − 6
    expect(v.frozenUntilTick).toBe(w.tick + THAW_TICKS);
  });

  test("burn hit on a frozen victim shatters: double damage + knockdown", () => {
    const a = synthAttacker("burn");
    const v = makeFighter({ id: 2, slot: 1, charId: "synth", x: 815 });
    v.state = "frozen";
    const w = worldWith(a, v);
    const events: SimEvent[] = [];
    resolveHits(w, SM, events);
    expect(w.fighters[1]!.hp).toBe(220);                              // 240 − (10 × 2)
    expect(w.fighters[1]!.state).toBe("knockdown");
    expect(events.find((e) => e.type === "hit")).toMatchObject({ damage: 20 });
  });

  test("lethal hit emits ko and ends the match when alive ≤ 1", () => {
    const a = synthAttacker("lethal");
    const v = makeFighter({ id: 2, slot: 1, charId: "synth", x: 815 });
    const w: WorldState = worldWith(a, v);
    const events: SimEvent[] = [];
    resolveHits(w, SM, events);
    expect(v.state).toBe("dead");
    expect(v.hp).toBe(0);
    expect(events.some((e) => e.type === "ko" && e.victim === v.id)).toBe(true);
    expect(w.over).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 12.5 — projectile hit resolution (spec §3.2). Projectiles are pushed
// into the world pre-materialized (box already copied from the sheet entry),
// so the tests craft them directly against the worldWith() arena.
function projAt(w: WorldState, owner: Fighter, over: Partial<Projectile> = {}): Projectile {
  const victim = w.fighters[1]!;
  const p: Projectile = {
    id: 99, ownerId: owner.id, spriteKey: "fx_test", projectileId: "test",
    x: victim.x, y: -28, z: victim.z, vx: 5, vy: 0,
    ttl: 100, pierce: false,
    box: { damage: 15, knockback: { vx: 3, vy: -1 }, hitstunTicks: 18, type: "projectile", priority: 15 },
    size: { w: 24, h: 14, d: 14 }, gravity: 0, hitIds: new Set<number>(),
    ...over,
  };
  w.projectiles.push(p);
  return p;
}

describe("projectile hit resolution", () => {
  test("projectile damages, knocks back (vx sign) and stuns the victim", () => {
    const a = makeFighter({ x: 700 });
    const v = makeFighter({ id: 2, x: 830, slot: 1 });
    const w = worldWith(a, v);
    projAt(w, a);                                     // sits on the victim
    const events: SimEvent[] = [];
    resolveProjectiles(w, new Map([["brawler", S]]), events);
    expect(v.hp).toBe(240 - 15);
    expect(v.state).toBe("hitstun");
    expect(v.vx).toBeGreaterThan(0);                  // knocked along +vx
    const hit = events.find((e) => e.type === "hit");
    expect(hit).toMatchObject({ attacker: a.id, victim: v.id, damage: 15, blocked: false });
  });

  test("left-flying projectile knocks the victim backwards", () => {
    const a = makeFighter({ x: 960 });
    const v = makeFighter({ id: 2, x: 830, slot: 1 });
    const w = worldWith(a, v);
    projAt(w, a, { vx: -5 });
    resolveProjectiles(w, new Map([["brawler", S]]), []);
    expect(w.fighters[1]!.vx).toBeLessThan(0);
  });

  test("own shot never hits the owner; i-frames reject projectile hits", () => {
    const a = makeFighter({ x: 700 });
    const v = makeFighter({ id: 2, x: 830, slot: 1 });
    const w = worldWith(a, v);
    const p = projAt(w, a);
    p.ownerId = v.id;                                 // own shot: immune
    resolveProjectiles(w, new Map([["brawler", S]]), []);
    expect(v.hp).toBe(240);

    const w2 = worldWith(makeFighter({ x: 700 }), makeFighter({ id: 2, x: 830, slot: 1, invulnUntilTick: 150 }));
    projAt(w2, w2.fighters[0]!);
    resolveProjectiles(w2, new Map([["brawler", S]]), []);
    expect(w2.fighters[1]!.hp).toBe(240);
  });

  test("freeze projectile freezes the victim with the THAW timer", () => {
    const a = makeFighter({ x: 700 });
    const v = makeFighter({ id: 2, x: 830, slot: 1 });
    const w = worldWith(a, v);
    projAt(w, a, { projectileId: "boltShard", box: { damage: 12, knockback: { vx: 2.5, vy: -1 }, hitstunTicks: 18, type: "projectile", priority: 15, status: "freeze" } });
    const events: SimEvent[] = [];
    resolveProjectiles(w, new Map([["brawler", S]]), events);
    expect(v.state).toBe("frozen");
    expect(v.frozenUntilTick).toBe(w.tick + THAW_TICKS);
    expect(v.hp).toBe(240 - 12);
  });

  test("burn projectile burns the victim with the BURN timer", () => {
    const a = makeFighter({ x: 700 });
    const v = makeFighter({ id: 2, x: 830, slot: 1 });
    const w = worldWith(a, v);
    projAt(w, a, { projectileId: "flameBall", box: { damage: 14, knockback: { vx: 3, vy: -1 }, hitstunTicks: 18, type: "projectile", priority: 15, status: "burn" } });
    resolveProjectiles(w, new Map([["brawler", S]]), []);
    expect(v.state).toBe("burned");
    expect(v.burnUntilTick).toBe(w.tick + BURN_TICKS);
  });

  test("burn hit on a frozen victim shatters: double damage + knockdown (§2.2)", () => {
    const a = makeFighter({ x: 700 });
    const v = makeFighter({ id: 2, x: 830, slot: 1, state: "frozen" });
    const w = worldWith(a, v);
    projAt(w, a, { projectileId: "flameBall", box: { damage: 14, knockback: { vx: 3, vy: -1 }, hitstunTicks: 18, type: "projectile", priority: 15, status: "burn" } });
    const events: SimEvent[] = [];
    resolveProjectiles(w, new Map([["brawler", S]]), events);
    expect(v.hp).toBe(240 - 28);
    expect(v.state).toBe("knockdown");
    expect(events.find((e) => e.type === "hit")).toMatchObject({ damage: 28 });
  });

  test("healsAllies orb heals wounded same-team fighters: silent, not self, not enemies", () => {
    const owner = makeFighter({ id: 1, x: 820, team: "blue", hp: 50 });   // overlapped + wounded: still skipped (self)
    const ally = makeFighter({ id: 2, x: 830, slot: 1, team: "blue", hp: 100 });
    const enemy = makeFighter({ id: 3, x: 830, slot: 2, team: "red", hp: 100 });
    const w = worldWith(owner, ally);
    w.fighters.push(enemy);
    projAt(w, owner, {
      projectileId: "healOrb", spriteKey: "fx_heal_orb", pierce: true,
      box: { damage: 20, knockback: { vx: 0, vy: 0 }, hitstunTicks: 0, type: "light", priority: 5, healsAllies: true },
    });
    const events: SimEvent[] = [];
    resolveProjectiles(w, new Map([["brawler", S]]), events);
    expect(ally.hp).toBe(120);                        // +20 heal
    expect(owner.hp).toBe(50);                        // never heals self
    expect(enemy.hp).toBe(100);                       // never touches enemies
    expect(events.some((e) => e.type === "hit")).toBe(false);   // silent heal
    expect(w.projectiles).toHaveLength(1);            // keeps flying (pierce)
    expect(ally.state).toBe("idle");                  // no stun/state churn
  });

  test("independent owner's orb heals any wounded non-self fighter", () => {
    const owner = makeFighter({ id: 1, x: 990, team: "independent" });
    const other = makeFighter({ id: 2, x: 830, slot: 1, team: "independent", hp: 100 });
    const w = worldWith(owner, other);
    projAt(w, owner, {
      projectileId: "healOrb", pierce: true,
      box: { damage: 20, knockback: { vx: 0, vy: 0 }, hitstunTicks: 0, type: "light", priority: 5, healsAllies: true },
    });
    resolveProjectiles(w, new Map([["brawler", S]]), []);
    expect(other.hp).toBe(120);
  });

  test("full-hp allies are not healed and don't burn the orb's once-per-fighter hit", () => {
    const owner = makeFighter({ id: 1, x: 990 });
    const ally = makeFighter({ id: 2, x: 830, slot: 1, team: "blue", hp: 240 });
    const w = worldWith(owner, ally);
    const orb = projAt(w, owner, {
      projectileId: "healOrb", pierce: true,
      box: { damage: 20, knockback: { vx: 0, vy: 0 }, hitstunTicks: 0, type: "light", priority: 5, healsAllies: true },
    });
    resolveProjectiles(w, new Map([["brawler", S]]), []);
    expect(ally.hp).toBe(240);
    expect(orb.hitIds.has(ally.id)).toBe(false);      // full hp: no heal, no hit consumed
  });

  test("non-pierce projectile that damaged someone is removed after the pass", () => {
    const a = makeFighter({ x: 700 });
    const v = makeFighter({ id: 2, x: 830, slot: 1 });
    const w = worldWith(a, v);
    projAt(w, a, { pierce: false });
    resolveProjectiles(w, new Map([["brawler", S]]), []);
    expect(w.projectiles).toHaveLength(0);
  });

  test("pierce projectile continues and hitIds prevents re-hits", () => {
    const a = makeFighter({ x: 700 });
    const v = makeFighter({ id: 2, x: 830, slot: 1 });
    const w = worldWith(a, v);
    const p = projAt(w, a, { pierce: true });
    resolveProjectiles(w, new Map([["brawler", S]]), []);
    resolveProjectiles(w, new Map([["brawler", S]]), []);
    expect(w.projectiles).toHaveLength(1);            // continues after the pass
    expect(w.projectiles[0]!).toBe(p);
    expect(v.hp).toBe(240 - 15);                      // damaged once only
    expect(v.comboCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Task 12.5 — weapon swings (spec §3.3): meleeDamage override, durability,
// weaponBreak. resolveHits takes the weapons table as an optional 4th arg.
function armedWorld(defId: string, durability: number): { w: WorldState; events: SimEvent[]; weapons: Record<string, WeaponLike> } {
  const w = attacking(makeFighter({ x: 800, holdingWeapon: defId, weaponDurability: durability }));
  return { w, events: [], weapons: WEAPONS };
}

describe("weapon swings", () => {
  test("baseball-bat swing overrides damage to 26 and decrements durability", () => {
    const { w, weapons } = armedWorld("baseball-bat", 8);
    const events: SimEvent[] = [];
    resolveHits(w, new Map([["brawler", S]]), events, weapons);
    expect(w.fighters[1]!.hp).toBe(240 - 26);
    expect(w.fighters[0]!.weaponDurability).toBe(7);
    expect(w.fighters[0]!.holdingWeapon).toBe("baseball-bat");
    expect(events.some((e) => e.type === "weaponBreak")).toBe(false);
  });

  test("8th landed swing emits weaponBreak and clears the held weapon", () => {
    const { w, weapons } = armedWorld("baseball-bat", 8);
    const events: SimEvent[] = [];
    const a = w.fighters[0]!;
    const v = w.fighters[1]!;
    for (let i = 0; i < 8; i++) {
      a.hitIds.clear();                               // fresh swing
      v.state = "idle";
      v.invulnUntilTick = 0;
      v.x = a.x + 30;                                 // re-place: knockback slides the victim
      resolveHits(w, new Map([["brawler", S]]), events, weapons);
    }
    expect(v.hp).toBe(240 - 8 * 26);
    expect(a.holdingWeapon).toBeUndefined();
    expect(a.weaponDurability).toBeUndefined();
    expect(events.filter((e) => e.type === "weaponBreak")).toHaveLength(1);
    expect(events.find((e) => e.type === "weaponBreak")).toMatchObject({ defId: "baseball-bat" });
  });

  test("thrown-kind weapon neither overrides swing damage nor loses durability", () => {
    const { w, weapons } = armedWorld("knife", 3);
    const events: SimEvent[] = [];
    resolveHits(w, new Map([["brawler", S]]), events, weapons);
    expect(w.fighters[1]!.hp).toBe(240 - 8);          // plain punch1 damage
    expect(w.fighters[0]!.weaponDurability).toBe(3);
    expect(w.fighters[0]!.holdingWeapon).toBe("knife");
  });

  test("swings without a weapons slice keep vanilla damage (optional param)", () => {
    const w = attacking(makeFighter({ x: 800, holdingWeapon: "baseball-bat", weaponDurability: 8 }));
    const events: SimEvent[] = [];
    resolveHits(w, new Map([["brawler", S]]), events);
    expect(w.fighters[1]!.hp).toBe(240 - 8);
    expect(w.fighters[0]!.weaponDurability).toBe(8);
  });
});
