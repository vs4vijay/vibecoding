// World orchestration: deterministic match spawn + per-tick step order (§2.4).
import { mulberry32 } from "./rng";
import { createBuffer, type BufferSnapshot, type FighterBuffer } from "./inputBuffer";
import { advanceFighter, type TickWorld } from "./fighter";
import { integrateFighter, integrateProjectile } from "./physics";
import { resolveHits, resolveProjectiles } from "./hitdetect";
import { consume, tryPickup, updateDrops } from "./items";
import { botThink } from "./bot";
import { SHELF_LIFE_DEFAULT_TICKS } from "./constants";
import type {
  CharacterSheet, Fighter, InputFrame, Projectile, SimEvent,
  SlotConfig, StageRuntime, Team, WorldState,
} from "./types";

export interface WeaponDef {
  kind: string;
  meleeDamage: number;
  throwDamage: number;
  throwVy: number;
  durability: number;
  breakOnThrowImpact: boolean;
  carrierSpeedMul: number;
  repickupDelayTicks: number;
}

export interface ItemDef {
  effect: "healHp" | "restoreMp";
  amount: number;
  consumeTicks: number;
  shelfLifeTicks: number;
}

/** Frozen load-time content handed to every sim entry point (Refinement 2). */
export interface SimContext {
  sheets: Map<string, CharacterSheet>;
  weapons: Record<string, WeaponDef>;
  items: Record<string, ItemDef>;
}

export interface StepResult { state: WorldState; events: SimEvent[] }

const NEUTRAL: InputFrame = { a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } };

/**
 * Deterministic spawn: mulberry32(seed) draws per slot in slot order —
 * x jitter then z — so identical seeds reproduce identical placements.
 * Even slots anchor left of centre facing right; odd slots mirror.
 */
export function spawnMatch(cfg: {
  seed: number;
  stage: StageRuntime;
  slots: SlotConfig[];
  sheets: Map<string, CharacterSheet>;
}): WorldState {
  const rng = mulberry32(cfg.seed);
  const fighters = cfg.slots.map((slot, i): Fighter => {
    const s = cfg.sheets.get(slot.charId);
    if (s === undefined) throw new Error(`spawnMatch: unknown charId "${slot.charId}"`);
    const side = i % 2 === 0 ? -1 : 1;
    return {
      id: i, slot: i, team: slot.team, isBot: !slot.isHuman, charId: slot.charId,
      x: cfg.stage.walls.right / 2 + side * (80 + Math.floor(rng() * 40)),
      y: 0, z: 20 + Math.floor(rng() * (cfg.stage.bounds.d - 40)),
      vx: 0, vy: 0, vz: 0, facing: i % 2 === 0 ? 1 : -1,
      state: "idle", stateTick: 0,
      hp: s.maxHp, mp: s.maxMp, invulnUntilTick: 0,
      hitIds: new Set<number>(), comboCount: 0, comboLastTick: -999,
      buffer: createBuffer(),
    };
  });
  return {
    tick: 0, seed: cfg.seed, rngState: cfg.seed, stage: cfg.stage,
    fighters, projectiles: [], pickups: [], nextEntityId: cfg.slots.length, over: false,
  };
}

/**
 * One simulation tick. Value semantics: `prev` is untouched; the returned
 * state is fresh and callers must thread it forward. Order per §2.4:
 * feed input → advance → integrate, per fighter; THEN hit resolution,
 * projectile integration, drops/pickup/consume, match end.
 */
export function stepWorld(prev: WorldState, inputs: InputFrame[], ctx: SimContext): StepResult {
  const w = cloneWorld(prev);
  w.tick += 1;
  const events: SimEvent[] = [];
  const overAtEntry = w.over;

  // FSM slice: the world's live arrays plus the weapon table (§3.3 throws,
  // carrierSpeedMul). A fresh object per tick keeps `weapons` OFF WorldState,
  // so the canonical state hash stays content-free.
  const tickWorld: TickWorld = {
    tick: w.tick, fighters: w.fighters, projectiles: w.projectiles,
    nextEntityId: w.nextEntityId, weapons: ctx.weapons,
  };

  const drinking = new Map<number, string>();         // fighters mid-drink this tick
  for (let i = 0; i < w.fighters.length; i++) {
    const f = w.fighters[i]!;
    const sheet = ctx.sheets.get(f.charId);
    if (sheet === undefined) throw new Error(`stepWorld: unknown charId "${f.charId}"`);
    const input = f.isBot ? botThink(w, f, ctx) : inputs[i] ?? NEUTRAL;
    // Every controller frame — human or bot — feeds its buffer: bot casts
    // ride the same D>A token stream through matchSpecial (T5 ruling:
    // the caller/world feeds; the FSM reads and consumes).
    f.buffer.push(input, w.tick);
    // Completion check BEFORE the advance: advanceFighter consumes the
    // drink's final tick and auto-idles, resetting stateTick — afterwards
    // the elapsed count is unrecoverable. Predict it here.
    if (f.state === "drinking" && f.holdingWeapon !== undefined) {
      drinking.set(f.id, f.holdingWeapon);
      const def = ctx.items[f.holdingWeapon];
      if (def !== undefined) consume(f, ctx.items, f.holdingWeapon, events, f.stateTick + 1 >= def.consumeTicks);
    }
    advanceFighter(f, input, sheet, tickWorld, events);
    integrateFighter(f, w.tick);
  }
  // FSM-spawned projectiles (special shots, throws) increment the slice's id
  // counter — write it back or ids repeat and collide with the pickup ids
  // drawn later in this tick (dropWeaponPickup / spawnPickup).
  w.nextEntityId = tickWorld.nextEntityId;

  resolveHits(w, ctx.sheets, events, ctx.weapons);
  resolveProjectiles(w, ctx.sheets, events);

  // Projectile integration + §3.3 thrown-weapon fate. integrateProjectile
  // only answers alive/dead, so the reason is derived by mirroring its check
  // order (ttl → wall → floor) from the pre-integration snapshot.
  const kept: Projectile[] = [];
  const dropped: Array<{ defId: string; x: number; z: number }> = [];
  for (const p of w.projectiles) {
    const ttlBefore = p.ttl;
    const nextX = p.x + p.vx;
    if (integrateProjectile(p, w.stage)) {
      kept.push(p);
      continue;
    }
    if (p.thrownWeapon !== undefined) {
      const expired = ttlBefore - 1 <= 0;
      const hitWall = nextX < 0 || nextX > w.stage.walls.right;   // mirrors physics
      // Mid-air expiry → gone; a wall impact shatters breakOnThrowImpact
      // weapons; everything else (floor landing, soft wall touch) drops.
      if (!expired && !(hitWall && p.thrownWeapon.breakOnThrowImpact)) {
        dropped.push({ defId: p.thrownWeapon.defId, x: p.x, z: p.z });
      }
    }
  }
  w.projectiles = kept;
  for (const d of dropped) dropWeaponPickup(w, ctx, d.defId, d.x, d.z);

  cancelInterruptedDrinks(w, drinking);
  updateDrops(w, events);
  for (const f of w.fighters) pickupAt(f, w, ctx, events);

  emitMatchEndIfNeeded(overAtEntry, w, events);
  return { state: w, events };
}

/** §3.3: a thrown weapon surviving as a pickup re-arms after repickupDelayTicks. */
function dropWeaponPickup(w: WorldState, ctx: SimContext, defId: string, x: number, z: number): void {
  w.pickups.push({
    id: w.nextEntityId++, kind: "weapon", defId,
    x, y: 0, z, vy: 0,
    spawnedTick: w.tick, shelfLifeTicks: SHELF_LIFE_DEFAULT_TICKS,
    noPickupUntilTick: w.tick + (ctx.weapons[defId]?.repickupDelayTicks ?? 0),
  });
}

/**
 * Deep-copy the world with live buffers swapped out: closures cannot survive
 * structuredClone. Each buffer is serialized to plain data, the field is
 * nulled for the clone, then the original buffer is put back on `prev` and a
 * fresh buffer restored from the snapshot onto the copy.
 */
function cloneWorld(prev: WorldState): WorldState {
  const saved: FighterBuffer[] = [];
  const snaps: Array<BufferSnapshot | undefined> = [];
  for (const f of prev.fighters) {
    saved.push(f.buffer);
    snaps.push(f.buffer.serialize());
    f.buffer = null as unknown as FighterBuffer;      // placeholder survives cloning
  }
  const copy = structuredClone(prev);
  for (let i = 0; i < prev.fighters.length; i++) {
    prev.fighters[i]!.buffer = saved[i]!;
    const buf = createBuffer();
    const snap = snaps[i];
    if (snap !== undefined) buf.restore(snap);
    copy.fighters[i]!.buffer = buf;
  }
  return copy;
}

/** Grounded fighter steps onto an overlapping pickup; consumables start drinking. */
function pickupAt(f: Fighter, w: WorldState, ctx: SimContext, events: SimEvent[]): void {
  if (f.state === "dead" || f.y < -20) return;
  for (let i = 0; i < w.pickups.length; i++) {
    const p = w.pickups[i]!;
    if (tryPickup(f, p, ctx.weapons, w.tick)) {
      w.pickups.splice(i, 1);
      events.push({ type: "weaponPickup", who: f.id, defId: p.defId });
      return;
    }
  }
}

/**
 * Cancels drinks interrupted this tick (hit, grab, launch knocked the
 * fighter out of "drinking"): no effect lands, the item is lost. Completed
 * drinks were settled pre-advance and are already gone from `drinking`.
 */
function cancelInterruptedDrinks(w: WorldState, drinking: Map<number, string>): void {
  for (const f of w.fighters) {
    if (!drinking.has(f.id) || f.state === "drinking") continue;
    delete f.holdingWeapon;
    delete f.weaponDurability;
  }
}
/**
 * Match end: emit exactly once, on the tick `over` flips. hitdetect's
 * checkMatchEnd may already have set it during resolveHits; this pass covers
 * every other route (draws via simultaneous KO, team wipes, FFA attrition).
 * Two end rules:
 * - All-independent FFA (VS mode): last fighter standing — at most one
 *   fighter alive AND someone dead. Winner is the lone survivor's team
 *   ("independent"); a draw when nobody survives.
 * - Team rosters: the lone surviving distinct team after a wipe; a draw
 *   when nobody survives.
 */
function emitMatchEndIfNeeded(overBeforeTick: boolean, w: WorldState, events: SimEvent[]): void {
  const alive = w.fighters.filter((f) => f.state !== "dead");
  const someoneDead = alive.length < w.fighters.length;
  const ffa = w.fighters.every((f) => f.team === "independent");
  let ended: boolean;
  let winnerTeam: Team | "draw";
  if (ffa) {
    ended = alive.length === 0 || (alive.length === 1 && someoneDead);
    winnerTeam = alive.length === 1 ? "independent" : "draw";
  } else {
    const aliveTeams = new Set<Team>();
    for (const f of alive) aliveTeams.add(f.team);
    ended = aliveTeams.size === 0 || (aliveTeams.size === 1 && someoneDead);
    winnerTeam = aliveTeams.size === 1 ? [...aliveTeams][0]! : "draw";
  }
  if (!ended || overBeforeTick) return;
  w.over = true;
  events.push({ type: "matchEnd", winnerTeam });
}
