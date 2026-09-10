// Items: sky-drop cadence (§3.5), pickup, consumption (§2.4 step 8).
import { mulberry32, stepMulberry32 } from "./rng";
import { SHELF_LIFE_DEFAULT_TICKS } from "./constants";
import type { Fighter, Pickup, SimEvent, WorldState } from "./types";
import type { ItemDef, WeaponDef } from "./world";

/**
 * One draw from the world's stored mulberry32 stream: value plus advanced
 * state, so replay state stays serialized inside WorldState.
 */
export function drawRng(w: WorldState): number {
  const v = mulberry32(w.rngState)();
  w.rngState = stepMulberry32(w.rngState);
  return v;
}

/**
 * §2.5: per-bot temperament — one draw from a stream seeded by fighter id,
 * constant for that bot across the whole match (deterministic personality,
 * never touches world RNG).
 */
export function botTemperament(f: Fighter): number {
  return mulberry32((f.id * 2654435761) ^ 0x9E3779B9)();
}

/**
 * Per-decision jitter for bots: deterministic given (fighter id, tick) —
 * varies over time like a dice roll, yet replays identically. Never touches
 * world RNG.
 */
export function botRoll(f: Fighter, tick: number): number {
  return mulberry32(((f.id * 2654435761) ^ Math.imul(tick + 1, 668265263)) | 0)();
}

/** Begin drinking a consumable; the effect lands when consume() sees completion. */
export function startDrinking(f: Fighter, defId: string): void {
  f.state = "drinking";
  f.stateTick = 0;
  f.holdingWeapon = defId;
}

/** Item ids that are consumables rather than wieldable weapons. */
function isConsumable(defId: string): boolean {
  return defId.startsWith("milk") || defId === "beer" || defId === "cider" ||
    defId.startsWith("heal") || defId.startsWith("potion");
}

/**
 * Pickup on overlap: grants a weapon with table durability, or begins
 * drinking a consumable. Returns true when the pickup was taken. World's
 * per-tick loop (stepWorld → pickupAt) calls this against nearby pickups;
 * `nowTick` is the caller's world tick, gating §3.3 repickup delays on
 * dropped weapons.
 */
export function tryPickup(f: Fighter, p: Pickup, weapons: Record<string, WeaponDef>, nowTick: number): boolean {
  if (p.noPickupUntilTick !== undefined && nowTick < p.noPickupUntilTick) return false;
  if (Math.abs(p.x - f.x) > 24 || Math.abs(p.z - f.z) > 16 || f.y < -20) return false;
  if (f.holdingWeapon !== undefined) return false;
  if (p.kind === "weapon") {
    const def = weapons[p.defId];
    if (def === undefined) return false;
    f.holdingWeapon = p.defId;
    f.weaponDurability = def.durability;
  } else {
    if (f.state !== "idle" && f.state !== "walk" && f.state !== "dash") return false;
    startDrinking(f, p.defId);
  }
  return true;
}

/**
 * Sky-drop cadence (§3.5): first drop at firstDropTick, then one every
 * intervalTicks ± intervalJitterTicks, with the jitter drawn from the seeded
 * RNG at schedule time. The next-drop tick rides on the world as a lazy
 * schedule; a world stepping past its due tick fires once immediately and
 * never back-fills missed intervals.
 *
 * Exactly three ordered RNG draws per drop (spec §3.5): weighted table pick,
 * x ∈ [80, w−80], z ∈ depth band.
 */
export function updateDrops(w: WorldState, events?: SimEvent[]): void {
  const cfg = w.stage.drops;
  const due = w.tick >= cfg.firstDropTick &&
    (w.nextDropTick === undefined || w.tick >= w.nextDropTick);
  if (!w.over && due) {
    spawnPickup(w, events);
    const jit = cfg.intervalJitterTicks > 0
      ? Math.floor(drawRng(w) * (cfg.intervalJitterTicks + 1))
      : 0;
    w.nextDropTick = w.tick + cfg.intervalTicks - cfg.intervalJitterTicks + jit;
  }
  // Shelf life: despawn stale pickups.
  for (let i = w.pickups.length - 1; i >= 0; i--) {
    if (w.tick - w.pickups[i]!.spawnedTick >= w.pickups[i]!.shelfLifeTicks) w.pickups.splice(i, 1);
  }
}

function spawnPickup(w: WorldState, events?: SimEvent[]): void {
  const entries = Object.entries(w.stage.drops.table);
  const totalW = entries.reduce((a, [, wt]) => a + wt, 0);

  let roll = drawRng(w) * totalW;                     // draw 1: weighted pick
  let defId = entries[entries.length - 1]![0];
  for (const [id, wt] of entries) {
    roll -= wt;
    if (roll <= 0) { defId = id; break; }
  }

  const x = 80 + drawRng(w) * (w.stage.bounds.w - 160); // draw 2: x ∈ [80, w−80]
  const z = drawRng(w) * w.stage.bounds.d;              // draw 3: z depth band

  const kind: Pickup["kind"] = isConsumable(defId) ? "item" : "weapon";
  w.pickups.push({
    id: w.nextEntityId++, kind, defId,
    x, y: -300, z, vy: 0,
    spawnedTick: w.tick, shelfLifeTicks: SHELF_LIFE_DEFAULT_TICKS,
  });
  events?.push({ type: "itemDrop", defId, x });
}

/**
 * Consumption settlement. `complete` is the caller's verdict that the drink
 * reached consumeTicks (stepWorld predicts this pre-advance, because the FSM
 * auto-idles and resets stateTick on the drink's final tick); omitted, the
 * verdict falls out of stateTick directly. On completion: effect applies,
 * held slot clears, fighter idles. Returns whether the drink completed.
 */
export function consume(
  f: Fighter,
  items: Record<string, ItemDef>,
  defId: string,
  events: SimEvent[],
  complete?: boolean,
): boolean {
  const it = items[defId];
  if (it === undefined || f.state !== "drinking" || f.holdingWeapon !== defId) return false;
  if (!complete && f.stateTick < it.consumeTicks) return false;
  if (it.effect === "healHp") f.hp += it.amount;
  else f.mp += it.amount;
  delete f.holdingWeapon;
  delete f.weaponDurability;
  f.state = "idle";
  f.stateTick = 0;
  events.push({ type: "itemConsumed", who: f.id, defId });
  return true;
}
