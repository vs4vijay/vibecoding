// Content-schema validators (spec §3.7): hand-rolled, zero dependencies,
// closed objects (undeclared keys rejected), exact field pointers.
import type { Layer } from "../sim/types";
import type { ItemDef, WeaponDef } from "../sim/world";

export interface FieldError { file: string; pointer: string; message: string }

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function push(errors: FieldError[], file: string, pointer: string, message: string): void {
  errors.push({ file, pointer, message });
}

function describeValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function expectNumber(errors: FieldError[], file: string, pointer: string, v: unknown): void {
  if (typeof v !== "number") {
    push(errors, file, pointer, `expected number, got ${describeValue(v)}`);
  } else if (!Number.isFinite(v)) {
    push(errors, file, pointer, "value must be finite");
  }
}

function expectInt(errors: FieldError[], file: string, pointer: string, v: unknown, min?: number): void {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    push(errors, file, pointer, `expected integer, got ${describeValue(v)}`);
  } else if (min !== undefined && v < min) {
    push(errors, file, pointer, `expected >= ${min}, got ${v}`);
  }
}

function expectString(errors: FieldError[], file: string, pointer: string, v: unknown): void {
  if (typeof v !== "string") push(errors, file, pointer, `expected string, got ${describeValue(v)}`);
}

function expectBool(errors: FieldError[], file: string, pointer: string, v: unknown): void {
  if (typeof v !== "boolean") push(errors, file, pointer, `expected boolean, got ${describeValue(v)}`);
}

/** Closed-object key check: every key must be declared. */
function closeObject(
  errors: FieldError[], file: string, pointer: string, value: Obj, allowed: readonly string[],
): void {
  for (const k of Object.keys(value)) {
    if (!allowed.includes(k)) push(errors, file, join(pointer, k), `undeclared key "${k}"`);
  }
}

function join(pointer: string, key: string | number): string {
  return pointer === "" ? String(key) : `${pointer}.${key}`;
}

function child(pointer: string, key: string | number): string {
  return `${pointer}.${key}`;
}

function enumCheck(
  errors: FieldError[], file: string, pointer: string, v: unknown, allowed: readonly string[],
): void {
  if (typeof v !== "string" || !allowed.includes(v)) {
    push(errors, file, pointer, `expected one of ${allowed.map((a) => `"${a}"`).join("|")}, got ${describeValue(v)}`);
  }
}

// ---------------------------------------------------------------- hitboxes --

const HITBOX_KEYS = ["x", "y", "z", "w", "h", "d", "damage", "knockback", "hitstunTicks", "type", "priority", "status"] as const;
const HITBOX_TYPES = ["light", "heavy", "projectile", "grab"] as const;
const STATUSES = ["freeze", "burn"] as const;

function validateHitbox(errors: FieldError[], file: string, pointer: string, hb: Obj): void {
  closeObject(errors, file, pointer, hb, HITBOX_KEYS);
  for (const k of ["x", "y", "z", "w", "h", "d"] as const) expectNumber(errors, file, child(pointer, k), hb[k]);
  expectInt(errors, file, child(pointer, "damage"), hb.damage, 0);
  expectInt(errors, file, child(pointer, "hitstunTicks"), hb.hitstunTicks, 0);
  expectInt(errors, file, child(pointer, "priority"), hb.priority);
  enumCheck(errors, file, child(pointer, "type"), hb.type, HITBOX_TYPES);
  const kb = hb.knockback;
  if (isObj(kb)) validateKnockback(errors, file, child(pointer, "knockback"), kb);
  else push(errors, file, child(pointer, "knockback"), "expected object");
  if (hb.status !== undefined) enumCheck(errors, file, child(pointer, "status"), hb.status, STATUSES);
}

function validateKnockback(errors: FieldError[], file: string, pointer: string, kb: Obj): void {
  closeObject(errors, file, pointer, kb, ["vx", "vy", "vz"]);
  expectNumber(errors, file, child(pointer, "vx"), kb.vx);
  expectNumber(errors, file, child(pointer, "vy"), kb.vy);
  if (kb.vz !== undefined) expectNumber(errors, file, child(pointer, "vz"), kb.vz);
}

// ------------------------------------------------------------------- moves --

const FRAME_KEYS = [
  "sprite", "durationTicks", "vx", "vy", "vz",
  "hitbox", "hurtbox", "mpCost", "cancelInto", "nextFrameLink", "spawnProjectile",
] as const;

function validateFrame(errors: FieldError[], file: string, pointer: string, fr: Obj): void {
  closeObject(errors, file, pointer, fr, FRAME_KEYS);
  expectString(errors, file, child(pointer, "sprite"), fr.sprite);
  expectInt(errors, file, child(pointer, "durationTicks"), fr.durationTicks, 1);
  for (const k of ["vx", "vy", "vz"] as const) expectNumber(errors, file, child(pointer, k), fr[k]);
  if (fr.hitbox !== undefined) {
    if (isObj(fr.hitbox)) validateHitbox(errors, file, child(pointer, "hitbox"), fr.hitbox);
    else push(errors, file, child(pointer, "hitbox"), "expected object");
  }
  if (fr.hurtbox !== undefined) {
    if (isObj(fr.hurtbox)) validateHitbox(errors, file, child(pointer, "hurtbox"), fr.hurtbox);
    else push(errors, file, child(pointer, "hurtbox"), "expected object");
  }
  if (fr.mpCost !== undefined) expectInt(errors, file, child(pointer, "mpCost"), fr.mpCost, 0);
  if (fr.cancelInto !== undefined) {
    if (Array.isArray(fr.cancelInto) && fr.cancelInto.every((t) => typeof t === "string")) {
      if (fr.cancelInto.length === 0) {
        push(errors, file, child(pointer, "cancelInto"), "expected non-empty array of move ids");
      }
    } else {
      push(errors, file, child(pointer, "cancelInto"), "expected array of move-id strings");
    }
  }
  if (fr.nextFrameLink !== undefined) {
    const nfl = fr.nextFrameLink;
    if (isObj(nfl)) {
      closeObject(errors, file, child(pointer, "nextFrameLink"), nfl, ["moveId", "frameIndex"]);
      expectString(errors, file, child(pointer, "nextFrameLink.moveId"), nfl.moveId);
      expectInt(errors, file, child(pointer, "nextFrameLink.frameIndex"), nfl.frameIndex, 0);
    } else {
      push(errors, file, child(pointer, "nextFrameLink"), "expected object");
    }
  }
  if (fr.spawnProjectile !== undefined) {
    const sp = fr.spawnProjectile;
    if (isObj(sp)) {
      closeObject(errors, file, child(pointer, "spawnProjectile"), sp, ["projectileId", "offsetX", "offsetY"]);
      expectString(errors, file, child(pointer, "spawnProjectile.projectileId"), sp.projectileId);
      expectNumber(errors, file, child(pointer, "spawnProjectile.offsetX"), sp.offsetX);
      expectNumber(errors, file, child(pointer, "spawnProjectile.offsetY"), sp.offsetY);
    } else {
      push(errors, file, child(pointer, "spawnProjectile"), "expected object");
    }
  }
}

function validateMoveDef(errors: FieldError[], file: string, pointer: string, mv: Obj): void {
  closeObject(errors, file, pointer, mv, ["frames", "sequence"]);
  if (Array.isArray(mv.frames)) {
    if (mv.frames.length === 0) {
      push(errors, file, child(pointer, "frames"), "expected at least one frame");
    }
    mv.frames.forEach((fr, i) => {
      if (isObj(fr)) validateFrame(errors, file, `${child(pointer, "frames")}[${i}]`, fr);
      else push(errors, file, `${child(pointer, "frames")}[${i}]`, "expected frame object");
    });
  } else {
    push(errors, file, child(pointer, "frames"), "expected array");
  }
  if (mv.sequence !== undefined) expectString(errors, file, child(pointer, "sequence"), mv.sequence);
}

// ------------------------------------------------------------- projectiles --

const PROJECTILE_KEYS = [
  "sprite", "size", "velocityVx", "gravity", "ttlTicks", "pierce", "damage",
  "knockback", "hitstunTicks", "type", "priority", "status", "healsAllies",
] as const;

function validateProjectileEntry(errors: FieldError[], file: string, pointer: string, p: Obj): void {
  closeObject(errors, file, pointer, p, PROJECTILE_KEYS);
  expectString(errors, file, child(pointer, "sprite"), p.sprite);
  if (isObj(p.size)) {
    closeObject(errors, file, child(pointer, "size"), p.size, ["w", "h", "d"]);
    for (const k of ["w", "h", "d"] as const) expectNumber(errors, file, child(child(pointer, "size"), k), p.size[k]);
  } else {
    push(errors, file, child(pointer, "size"), "expected object");
  }
  expectNumber(errors, file, child(pointer, "velocityVx"), p.velocityVx);
  expectNumber(errors, file, child(pointer, "gravity"), p.gravity);
  expectInt(errors, file, child(pointer, "ttlTicks"), p.ttlTicks, 1);
  expectBool(errors, file, child(pointer, "pierce"), p.pierce);
  expectInt(errors, file, child(pointer, "damage"), p.damage, 0);
  if (isObj(p.knockback)) validateKnockback(errors, file, child(pointer, "knockback"), p.knockback);
  else push(errors, file, child(pointer, "knockback"), "expected object");
  expectInt(errors, file, child(pointer, "hitstunTicks"), p.hitstunTicks, 0);
  enumCheck(errors, file, child(pointer, "type"), p.type, ["projectile", "light", "heavy"]);
  expectInt(errors, file, child(pointer, "priority"), p.priority);
  if (p.status !== undefined) enumCheck(errors, file, child(pointer, "status"), p.status, STATUSES);
  if (p.healsAllies !== undefined) {
    expectBool(errors, file, child(pointer, "healsAllies"), p.healsAllies);
    // Task 12.5 (spec §3.2): the heal magnitude rides the damage field — the
    // sim routes healsAllies projectiles exclusively to the heal path, so
    // enemies never take this damage. No damage-0 constraint anymore.
  }
}

// ----------------------------------------------------------------- sheets --

const SHEET_KEYS = [
  "id", "maxHp", "maxMp", "mpRegenPerTick", "walkSpeed", "runSpeed", "jumpImpulse",
  "moves", "grabMoveId", "roles", "projectiles",
] as const;

function validateCharacterSheetShape(raw: unknown, file: string): FieldError[] {
  const errors: FieldError[] = [];
  if (!isObj(raw)) {
    push(errors, file, "", `expected object, got ${describeValue(raw)}`);
    return errors;
  }
  closeObject(errors, file, "", raw, SHEET_KEYS);
  expectString(errors, file, "id", raw.id);
  expectInt(errors, file, "maxHp", raw.maxHp, 1);
  expectInt(errors, file, "maxMp", raw.maxMp, 1);
  expectNumber(errors, file, "mpRegenPerTick", raw.mpRegenPerTick);
  expectNumber(errors, file, "walkSpeed", raw.walkSpeed);
  expectNumber(errors, file, "runSpeed", raw.runSpeed);
  expectNumber(errors, file, "jumpImpulse", raw.jumpImpulse);

  if (isObj(raw.moves)) {
    const moveIds = Object.keys(raw.moves);
    if (moveIds.length === 0) push(errors, file, "moves", "expected at least one move");
    for (const [moveId, mv] of Object.entries(raw.moves)) {
      if (isObj(mv)) validateMoveDef(errors, file, child("moves", moveId), mv);
      else push(errors, file, child("moves", moveId), "expected move object");
    }
  } else {
    push(errors, file, "moves", "expected object");
  }

  if (raw.grabMoveId !== undefined) expectString(errors, file, "grabMoveId", raw.grabMoveId);

  if (raw.roles !== undefined) {
    if (isObj(raw.roles)) {
      for (const [role, target] of Object.entries(raw.roles)) {
        expectString(errors, file, child("roles", role), target);
      }
    } else {
      push(errors, file, "roles", "expected object");
    }
  }

  if (raw.projectiles !== undefined) {
    if (isObj(raw.projectiles)) {
      for (const [pid, p] of Object.entries(raw.projectiles)) {
        if (isObj(p)) validateProjectileEntry(errors, file, child("projectiles", pid), p);
        else push(errors, file, child("projectiles", pid), "expected projectile object");
      }
    } else {
      push(errors, file, "projectiles", "expected object");
    }
  }

  return errors;
}

/**
 * Cross-link pass (runs after shape validation): every referenced move /
 * projectile must be declared inside this sheet.
 */
export function crossLinkCharacterSheet(raw: unknown, file: string): FieldError[] {
  const errors: FieldError[] = [];
  if (!isObj(raw) || !isObj(raw.moves)) return errors;
  const moves = raw.moves;
  const moveIds = new Set(Object.keys(moves));

  for (const [moveId, mv] of Object.entries(moves)) {
    if (!isObj(mv) || !Array.isArray(mv.frames)) continue;
    mv.frames.forEach((fr, fi) => {
      if (!isObj(fr)) return;
      const framePtr = `moves.${moveId}.frames[${fi}]`;
      if (Array.isArray(fr.cancelInto)) {
        for (const t of fr.cancelInto) {
          if (typeof t === "string" && !moveIds.has(t)) {
            push(errors, file, `${framePtr}.cancelInto`, `cancelInto target "${t}" is not a declared move`);
          }
        }
      }
      const nfl = fr.nextFrameLink;
      if (isObj(nfl) && typeof nfl.moveId === "string") {
        if (!moveIds.has(nfl.moveId)) {
          push(errors, file, `${framePtr}.nextFrameLink.moveId`, `nextFrameLink target "${nfl.moveId}" is not a declared move`);
        } else {
          const target = moves[nfl.moveId];
          const targetLen = isObj(target) && Array.isArray(target.frames) ? target.frames.length : 0;
          if (typeof nfl.frameIndex === "number" && nfl.frameIndex >= targetLen) {
            push(errors, file, `${framePtr}.nextFrameLink.frameIndex`, `frameIndex ${nfl.frameIndex} out of range (${targetLen} frames in "${nfl.moveId}")`);
          }
        }
      }
      const sp = fr.spawnProjectile;
      if (isObj(sp) && typeof sp.projectileId === "string") {
        const projs = isObj(raw.projectiles) ? raw.projectiles : undefined;
        if (projs === undefined || !(sp.projectileId in projs)) {
          push(errors, file, `${framePtr}.spawnProjectile.projectileId`, `projectile "${sp.projectileId}" is not declared in sheet.projectiles`);
        }
      }
    });
  }

  if (typeof raw.grabMoveId === "string" && !moveIds.has(raw.grabMoveId)) {
    push(errors, file, "grabMoveId", `grabMoveId "${raw.grabMoveId}" is not a declared move`);
  }
  if (isObj(raw.roles)) {
    for (const [role, target] of Object.entries(raw.roles)) {
      if (typeof target === "string" && !moveIds.has(target)) {
        push(errors, file, `roles.${role}`, `role target "${target}" is not a declared move`);
      }
    }
  }
  return errors;
}

/**
 * Full sheet validation: closed-object shape checks plus cross-link pass
 * (cancelInto / nextFrameLink / roles / grabMoveId → declared moves;
 * spawnProjectile.projectileId → sheet.projectiles).
 */
export function validateCharacterSheet(raw: unknown, file: string): FieldError[] {
  return [...validateCharacterSheetShape(raw, file), ...crossLinkCharacterSheet(raw, file)];
}


// ------------------------------------------------------------------ stages --

const STAGE_KEYS = ["id", "walls", "bounds", "layers", "drops"] as const;

function validateLayer(errors: FieldError[], file: string, pointer: string, layer: Obj): void {
  closeObject(errors, file, pointer, layer, ["atlasKey", "parallax", "baselineY"]);
  expectString(errors, file, child(pointer, "atlasKey"), layer.atlasKey);
  expectNumber(errors, file, child(pointer, "parallax"), layer.parallax);
  expectNumber(errors, file, child(pointer, "baselineY"), layer.baselineY);
}

export function validateStage(raw: unknown, file: string): FieldError[] {
  const errors: FieldError[] = [];
  if (!isObj(raw)) {
    push(errors, file, "", `expected object, got ${describeValue(raw)}`);
    return errors;
  }
  closeObject(errors, file, "", raw, STAGE_KEYS);
  expectString(errors, file, "id", raw.id);

  if (isObj(raw.walls)) {
    closeObject(errors, file, "walls", raw.walls, ["left", "right", "restitution"]);
    expectNumber(errors, file, "walls.left", raw.walls.left);
    expectNumber(errors, file, "walls.right", raw.walls.right);
    expectNumber(errors, file, "walls.restitution", raw.walls.restitution);
    if (typeof raw.walls.left === "number" && typeof raw.walls.right === "number"
      && Number.isFinite(raw.walls.left) && Number.isFinite(raw.walls.right)
      && raw.walls.right <= raw.walls.left) {
      push(errors, file, "walls.right", "right wall must exceed left wall");
    }
  } else {
    push(errors, file, "walls", "expected object");
  }

  if (isObj(raw.bounds)) {
    closeObject(errors, file, "bounds", raw.bounds, ["w", "h", "d"]);
    const limits: Record<"w" | "h" | "d", number> = { w: 1600, h: 480, d: 120 };
    for (const k of ["w", "h", "d"] as const) {
      const v = raw.bounds[k];
      expectNumber(errors, file, child("bounds", k), v);
      if (typeof v === "number" && Number.isFinite(v) && v > limits[k]) {
        push(errors, file, child("bounds", k), `exceeds nominal arena limit ${limits[k]} (§2.3)`);
      }
    }
  } else {
    push(errors, file, "bounds", "expected object");
  }

  if (raw.layers !== undefined) {
    if (Array.isArray(raw.layers)) {
      raw.layers.forEach((layer, i) => {
        if (isObj(layer)) validateLayer(errors, file, `layers[${i}]`, layer);
        else push(errors, file, `layers[${i}]`, "expected layer object");
      });
    } else {
      push(errors, file, "layers", "expected array");
    }
  }

  if (isObj(raw.drops)) {
    closeObject(errors, file, "drops", raw.drops, ["firstDropTick", "intervalTicks", "intervalJitterTicks", "table"]);
    expectInt(errors, file, "drops.firstDropTick", raw.drops.firstDropTick, 0);
    expectInt(errors, file, "drops.intervalTicks", raw.drops.intervalTicks, 0);
    expectInt(errors, file, "drops.intervalJitterTicks", raw.drops.intervalJitterTicks, 0);
    if (isObj(raw.drops.table)) {
      for (const [id, weight] of Object.entries(raw.drops.table)) {
        expectInt(errors, file, child("drops.table", id), weight, 1);
      }
    } else {
      push(errors, file, "drops.table", "expected object");
    }
  } else {
    push(errors, file, "drops", "expected object");
  }
  return errors;
}

/**
 * Cross-stage link: drop-table ids must exist in weapons ∪ items.
 */
export function crossLinkDrops(stage: unknown, weapons: Obj, items: Obj, file: string): FieldError[] {
  const errors: FieldError[] = [];
  if (!isObj(stage) || !isObj(stage.drops) || !isObj(stage.drops.table)) return errors;
  for (const id of Object.keys(stage.drops.table)) {
    if (!(id in weapons) && !(id in items)) {
      push(errors, file, `drops.table.${id}`, `drop id "${id}" is neither a weapon nor an item`);
    }
  }
  return errors;
}

// ----------------------------------------------------------- weapons/items --

const WEAPON_KEYS = [
  "kind", "meleeDamage", "throwDamage", "throwVy", "durability",
  "breakOnThrowImpact", "carrierSpeedMul", "repickupDelayTicks",
] as const;

function validateWeaponDef(errors: FieldError[], file: string, pointer: string, def: Obj): void {
  closeObject(errors, file, pointer, def, WEAPON_KEYS);
  expectString(errors, file, child(pointer, "kind"), def.kind);
  expectInt(errors, file, child(pointer, "meleeDamage"), def.meleeDamage, 0);
  expectInt(errors, file, child(pointer, "throwDamage"), def.throwDamage, 0);
  expectNumber(errors, file, child(pointer, "throwVy"), def.throwVy);
  // Every weapon must survive at least one use (spec §3.7 durability check).
  if (typeof def.durability === "number" && Number.isInteger(def.durability) && def.durability < 1) {
    push(errors, file, child(pointer, "durability"), `weapon durability must be >= 1, got ${String(def.durability)}`);
  } else {
    expectInt(errors, file, child(pointer, "durability"), def.durability, 0);
  }
  expectBool(errors, file, child(pointer, "breakOnThrowImpact"), def.breakOnThrowImpact);
  if (typeof def.carrierSpeedMul === "number" && Number.isFinite(def.carrierSpeedMul) && def.carrierSpeedMul <= 0) {
    push(errors, file, child(pointer, "carrierSpeedMul"), "must be positive");
  } else {
    expectNumber(errors, file, child(pointer, "carrierSpeedMul"), def.carrierSpeedMul);
  }
  expectInt(errors, file, child(pointer, "repickupDelayTicks"), def.repickupDelayTicks, 0);
}

export function validateWeapons(raw: unknown, file: string): FieldError[] {
  const errors: FieldError[] = [];
  if (!isObj(raw)) {
    push(errors, file, "", `expected object, got ${describeValue(raw)}`);
    return errors;
  }
  const ids = Object.keys(raw);
  if (ids.length === 0) push(errors, file, "", "expected at least one weapon");
  for (const id of ids) {
    const def = raw[id];
    if (isObj(def)) validateWeaponDef(errors, file, id, def);
    else push(errors, file, id, "expected weapon object");
  }
  return errors;
}

const ITEM_KEYS = ["effect", "amount", "consumeTicks", "shelfLifeTicks"] as const;

function validateItemDef(errors: FieldError[], file: string, pointer: string, def: Obj): void {
  closeObject(errors, file, pointer, def, ITEM_KEYS);
  enumCheck(errors, file, child(pointer, "effect"), def.effect, ["healHp", "restoreMp"]);
  expectInt(errors, file, child(pointer, "amount"), def.amount, 1);
  expectInt(errors, file, child(pointer, "consumeTicks"), def.consumeTicks, 1);
  expectInt(errors, file, child(pointer, "shelfLifeTicks"), def.shelfLifeTicks, 0);
}

export function validateItems(raw: unknown, file: string): FieldError[] {
  const errors: FieldError[] = [];
  if (!isObj(raw)) {
    push(errors, file, "", `expected object, got ${describeValue(raw)}`);
    return errors;
  }
  const ids = Object.keys(raw);
  if (ids.length === 0) push(errors, file, "", "expected at least one item");
  for (const id of ids) {
    const def = raw[id];
    if (isObj(def)) validateItemDef(errors, file, id, def);
    else push(errors, file, id, "expected item object");
  }
  return errors;
}

