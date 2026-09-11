// Per-fighter FSM tick + move interpreter. Pure: no clocks, no RNG, no DOM.
// World composes advanceFighter -> integrateFighter each tick (see src/sim/physics.ts).
import type { CharacterSheet, Fighter, InputFrame, MoveFrame, Projectile, ProjectileSpawn, SimEvent, WeaponLike } from "./types";
import {
  JUMP_IMPULSE, WALK_SPEED, BLOCKSTUN_TICKS, THAW_TICKS, BURN_TICKS, BURN_DPS_TICKS,
  RUN_DASH_SPEED, KNOCKDOWN_LAUNCH_VY,
  DOUBLE_TAP_WINDOW_TICKS, DASH_TICKS, GRAB_BREAK_TICKS, THROW_LAUNCH_VX, GRAB_RANGE,
} from "./constants";
import { matchSpecial } from "./specials";

/**
 * World slice the FSM reads. `fighters` is supplied by stepWorld so the
 * grabber can resolve its victim; bare `{ tick }` callers (unit tests,
 * move stepping) never need it, so it stays optional. `projectiles` +
 * `nextEntityId` let move frames and thrown weapons spawn projectiles
 * (spec §3.2); `weapons` carries the loader's weapon table for throws,
 * carrierSpeedMul and melee overrides (§3.3). Everything except `tick` is
 * optional-guarded.
 */
export interface TickWorld {
  tick: number;
  fighters?: Fighter[];
  projectiles?: Projectile[];
  nextEntityId?: number;
  weapons?: Record<string, WeaponLike>;
}

// State timers (design spec §2.2 / task constraints).
const HITSTUN_TICKS = 16;
const KNOCKDOWN_TICKS = 40;
const GETUP_TICKS = 18;
const GETUP_IFRAME_TICKS = 24;
const DRINKING_TICKS = 30;
const SPECIAL_WINDOW_TICKS = 30;

function toIdle(f: Fighter): void {
  f.state = "idle";
  f.stateTick = 0;
  delete f.moveId;
  delete f.frameIdx;
  delete f.frameTick;
}

/**
 * Start a move: charge the summed per-frame mpCost ONCE at move start
 * (spec §2.1); insufficient MP leaves the fighter untouched. Returns false
 * when the move is unknown or unaffordable.
 */
export function tryStartMove(
  f: Fighter, moveId: string, sheet: CharacterSheet, _world: TickWorld, events: SimEvent[],
): boolean {
  const def = sheet.moves[moveId];
  if (def === undefined) return false;
  let cost = 0;
  for (const fr of def.frames) cost += fr.mpCost ?? 0;
  if (cost > f.mp) return false;
  f.mp -= cost;
  f.state = "attack";
  f.moveId = moveId;
  f.frameIdx = 0;
  f.frameTick = 0;
  f.stateTick = 0;
  f.hitIds.clear();                         // new swing: fresh once-per-swing set
  // Consume the buffered sequence so residual tokens cannot re-trigger the
  // same special while its presses remain inside the specials match span.
  f.buffer.clear();
  if (def.sequence === "D>A") events.push({ type: "castFire", who: f.id });
  return true;
}

/**
 * Spec §3.2: spawn the frame's sheet projectile once, at the tick the move's
 * frame pointer advances onto its frame. Position mirrors the caster's facing
 * on x only; sheet shots launch flat (vy: 0). Guarded: bare `{ tick }` worlds
 * never spawn.
 */
function spawnFrameProjectile(f: Fighter, spawn: ProjectileSpawn, sheet: CharacterSheet, world: TickWorld): void {
  if (world.projectiles === undefined || world.nextEntityId === undefined) return;
  const entry = sheet.projectiles?.[spawn.projectileId];
  if (entry === undefined) return;
  world.projectiles.push({
    id: world.nextEntityId++,
    ownerId: f.id,
    spriteKey: entry.sprite,
    projectileId: spawn.projectileId,
    x: f.x + spawn.offsetX * f.facing,
    y: f.y + spawn.offsetY,
    z: f.z,
    vx: entry.velocityVx * f.facing,
    vy: 0,
    ttl: entry.ttlTicks,
    pierce: entry.pierce,
    box: {
      damage: entry.damage,
      knockback: entry.knockback,
      hitstunTicks: entry.hitstunTicks,
      type: entry.type,
      priority: entry.priority,
      status: entry.status,
      healsAllies: entry.healsAllies,
    },
    size: entry.size,
    gravity: entry.gravity,
    hitIds: new Set<number>(),
  });
}

/**
 * Advance the active move one tick. frameTick counts ticks since move start
 * (spec §2.1: absolute per-move frame indexing); the frame owning the current
 * tick is located from cumulative durationTicks. `aPressed` is the rising
 * edge of the attack button — cancels key off presses, not held buttons.
 */
function stepMove(f: Fighter, sheet: CharacterSheet, world: TickWorld, events: SimEvent[], aPressed: boolean): void {
  const def = f.moveId !== undefined ? sheet.moves[f.moveId] : undefined;
  if (def === undefined || f.frameTick === undefined) { toIdle(f); return; }

  // §3.2 spawn bookkeeping: the pointer "advances onto" a frame when its
  // index changes — including the first step of a move (prev = start-up
  // boundary −1) and terminal nextFrameLink hops (handled below).
  const prevIdx = f.frameTick === 0 ? -1 : f.frameIdx ?? -1;
  f.frameTick += 1;

  // Locate the frame owning this move-tick (frameTick = ticks since move start).
  let idx = 0;
  let remaining = f.frameTick;
  let fr: MoveFrame | undefined;
  for (; idx < def.frames.length; idx++) {
    const cand = def.frames[idx];
    if (cand === undefined) break;
    if (remaining <= cand.durationTicks) { fr = cand; break; }
    remaining -= cand.durationTicks;
  }
  if (fr === undefined) {
    // Move exhausted: honour a terminal auto-chain, else return to idle.
    const link = def.frames.length > 0 ? def.frames[def.frames.length - 1]?.nextFrameLink : undefined;
    if (link !== undefined && tryStartMove(f, link.moveId, sheet, world, events)) {
      let acc = 0;
      const target = sheet.moves[link.moveId];
      for (let i = 0; i < link.frameIndex && target !== undefined && i < target.frames.length; i++) {
        acc += target.frames[i]!.durationTicks;
      }
      f.frameTick = acc;
      f.frameIdx = link.frameIndex;
      // The pointer advanced onto the linked frame this tick (§3.2).
      const linked = target?.frames[link.frameIndex];
      if (linked?.spawnProjectile !== undefined) {
        spawnFrameProjectile(f, linked.spawnProjectile, sheet, world);
      }
      return;
    }
    toIdle(f);
    f.vx = 0;
    return;
  }

  f.frameIdx = idx;

  // Frame velocity is applied during this frame (spec §2.1); physics integrates it.
  f.vx = fr.vx;
  f.vy = fr.vy;
  f.vz = fr.vz;

  // §3.2: first tick on a spawn-carrying frame launches its projectile once.
  if (fr.spawnProjectile !== undefined && idx !== prevIdx) {
    spawnFrameProjectile(f, fr.spawnProjectile, sheet, world);
  }

  // Cancel window: A pressed during a frame carrying cancelInto[0] reroutes there.
  const cancelTarget = fr.cancelInto?.[0];
  if (aPressed && cancelTarget !== undefined) {
    tryStartMove(f, cancelTarget, sheet, world, events);
  }
}

/**
 * Spec §2.2 "Idle --> GrabAttempt : A near foe": a grab opens only on a
 * valid foe standing in front within GRAB_RANGE. Validity mirrors
 * hitdetect's alive/team filters; the x reach adds the foe's body
 * half-width (+14) exactly like hitdetect's overlap margin. No fighters
 * slice (bare `{ tick }` callers) simply skips the grab.
 */
function grabTargetInRange(f: Fighter, world: TickWorld): boolean {
  for (const foe of world.fighters ?? []) {
    if (foe.id === f.id) continue;
    if (foe.state === "dead") continue;
    // Initiation targets standing foes only (FSM: Idle --> GrabAttempt).
    // Grabbing a just-thrown victim the tick its landing i-frames lapse
    // re-launched it before it ever rose: a damage-free throw loop that
    // never ends duels (soak: rooftop seed 9). The
    // Knockdown --> Thrown edge stays reachable via grab-box connection
    // (hitdetect), per spec.
    if (foe.state === "knockdown") continue;
    if (f.team !== "independent" && foe.team === f.team) continue;  // same as hitdetect
    if ((foe.x - f.x) * f.facing <= 0) continue;                    // must be in front
    if (Math.abs(foe.x - f.x) > GRAB_RANGE + 14) continue;
    if (Math.abs(foe.z - f.z) > 16) continue;
    return true;
  }
  return false;
}

/**
 * Bot override for the grab preemption: nearest valid foe inside the neutral
 * band (point-blank). Throws carry no HP damage, so two adjacent bots that
 * always grab exchanged zero-damage throws forever — the swing must win at
 * point-blank and the grab stay an arm's-length option.
 */
function pointBlankFoeInFront(f: Fighter, world: TickWorld): boolean {
  for (const foe of world.fighters ?? []) {
    if (foe.id === f.id) continue;
    if (foe.state === "dead" || foe.state === "knockdown") continue;
    if (f.team !== "independent" && foe.team === f.team) continue;
    if ((foe.x - f.x) * f.facing <= 0) continue;
    if (Math.abs(foe.x - f.x) <= GRAB_RANGE) return true;
  }
  return false;
}

/**
 * §3.3: the held weapon's def when the attack press should THROW it —
 * thrown-kind only (knife), and only when a projectiles slice exists to
 * receive the spawned projectile. Bare `{ tick }` callers swing instead.
 */
function heldThrowDef(f: Fighter, world: TickWorld): { defId: string; def: WeaponLike } | undefined {
  if (f.holdingWeapon === undefined) return undefined;
  const def = world.weapons?.[f.holdingWeapon];
  if (def === undefined || def.kind !== "thrown") return undefined;
  if (world.projectiles === undefined || world.nextEntityId === undefined) return undefined;
  return { defId: f.holdingWeapon, def };
}

/**
 * §3.3 throw: expends the held instance into a projectile — fixed launch
 * speed × facing, the weapon's throwVy, light gravity so the arc returns to
 * the floor. Sim-internal `thrownWeapon` metadata drives its fate in
 * stepWorld (destroy on fighter contact; wall/floor fate per breakOnThrowImpact).
 */
function throwHeldWeapon(f: Fighter, defId: string, def: WeaponLike, world: TickWorld): void {
  world.projectiles!.push({
    id: world.nextEntityId!++,
    ownerId: f.id,
    spriteKey: "prop_" + defId,
    projectileId: defId,
    x: f.x + 20 * f.facing,
    y: f.y - 34,
    z: f.z,
    vx: 8.0 * f.facing,
    vy: def.throwVy,
    ttl: 300,
    pierce: false,
    box: {
      damage: def.throwDamage,
      knockback: { vx: 3.0, vy: -1.0 },
      hitstunTicks: 18,
      type: "projectile",
      priority: 15,
    },
    size: { w: 16, h: 16, d: 16 },
    gravity: 0.2,
    hitIds: new Set<number>(),
    thrownWeapon: { defId, breakOnThrowImpact: def.breakOnThrowImpact },
  });
  delete f.holdingWeapon;
  delete f.weaponDurability;
}

/** §3.3: held weapon's carrier speed multiplier (1 when unarmed/unknown). */
function carrierMul(f: Fighter, world: TickWorld): number {
  if (f.holdingWeapon === undefined) return 1;
  return world.weapons?.[f.holdingWeapon]?.carrierSpeedMul ?? 1;
}

/** Locomotion/attack/special/jump decisions from idle, walk, or dash. */
function act(f: Fighter, input: InputFrame, sheet: CharacterSheet, world: TickWorld, events: SimEvent[]): void {
  // 1. Buffered directional specials (window-aware, longest pattern first).
  const patterns: Record<string, string> = {};
  for (const [moveId, mv] of Object.entries(sheet.moves)) {
    if (mv.sequence !== undefined) patterns[moveId] = mv.sequence;
  }
  const special = matchSpecial(f.buffer.pressLog(), world.tick, SPECIAL_WINDOW_TICKS, patterns);
  if (special !== null) {
    // The sequence input is consumed whether or not the charge succeeds;
    // a refused special must not leak the same press into a free jab.
    tryStartMove(f, special, sheet, world, events);
    return;
  }

  // 1.5. Double-tap dash entry (spec §2.2): the newest direction edge is the
  // second tap — it must carry this tick's stamp so a logged pair cannot
  // re-fire on later ticks — and the prior edge of the same token within
  // DOUBLE_TAP_WINDOW_TICKS is the first. pressLog is newest-first and holds
  // edges only, so a held direction or a same-tick chord never double-taps.
  const log = f.buffer.pressLog();
  let secondTap: (typeof log)[number] | undefined;
  for (const rec of log) {
    if (rec.token === ">" || rec.token === "<") { secondTap = rec; break; }
  }
  if (secondTap !== undefined && secondTap.tick === world.tick) {
    for (let i = log.indexOf(secondTap) + 1; i < log.length; i++) {
      const first = log[i]!;
      if (first.token !== secondTap.token) continue;
      if (secondTap.tick - first.tick <= DOUBLE_TAP_WINDOW_TICKS) {
        const dir = secondTap.token === ">" ? 1 : -1;
        f.state = "dash";
        f.stateTick = 0;
        f.vx = RUN_DASH_SPEED * dir * carrierMul(f, world);   // §3.3 run scaling
        f.facing = dir as 1 | -1;
        events.push({ type: "dash", who: f.id });
      }
      break;              // only the previous same-direction tap counts
    }
  }

  // 2. Attack: a thrown-kind weapon turns the press into a throw (§3.3);
  //    otherwise the dash role wins over the neutral attack.
  if (input.a) {
    const held = heldThrowDef(f, world);
    if (held !== undefined) {
      throwHeldWeapon(f, held.defId, held.def, world);
      return;
    }
    const dashAttackId = f.state === "dash" ? sheet.roles?.["dashAttack"] : undefined;
    if (dashAttackId !== undefined && tryStartMove(f, dashAttackId, sheet, world, events)) return;
    // Grab initiation (spec §2.2): attack pressed with a valid foe in reach
    // opens the grab chain instead of the neutral swing — at arm's length.
    // A bot at point-blank swings the neutral attack instead: with throws
    // carrying no HP damage, adjacent bots that always grab exchange
    // zero-damage throws forever (soak: final duels, hp frozen for 2000
    // ticks). Humans keep the spec'd A-near-foe grab at any reach.
    if (sheet.grabMoveId !== undefined && grabTargetInRange(f, world) &&
        !(f.isBot && pointBlankFoeInFront(f, world))) {
      if (tryStartMove(f, sheet.grabMoveId, sheet, world, events)) return;
    }
    const neutralId = sheet.roles?.["neutralAttack"] ?? "punch1";
    if (tryStartMove(f, neutralId, sheet, world, events)) return;
  }

  // 3. Jump.
  if (input.j) {
    f.state = "jump";
    f.stateTick = 0;
    f.vy = sheet.jumpImpulse ?? JUMP_IMPULSE;
    f.vx = input.dir.x * (sheet.walkSpeed ?? WALK_SPEED);
    f.vz = input.dir.z * (sheet.walkSpeed ?? WALK_SPEED);
    events.push({ type: "jump", who: f.id });
    return;
  }

  // 4. Locomotion. Mid-dash the burst owns velocity — direction input is
  // suppressed until the dash expires or is interrupted above. §3.3: the
  // held weapon's carrierSpeedMul scales the walk.
  if (f.state !== "dash" && (input.dir.x !== 0 || input.dir.z !== 0)) {
    if (input.dir.x !== 0) f.facing = input.dir.x > 0 ? 1 : -1;
    const mul = carrierMul(f, world);
    f.vx = input.dir.x * sheet.walkSpeed * mul;
    f.vz = input.dir.z * sheet.walkSpeed * mul;
    f.state = "walk";
  } else if (f.state === "walk") {
    f.vx = 0;
    f.vz = 0;
    f.state = "idle";
  }
}

/**
 * Advance one fighter one tick. Mutates `f` in place; appends SimEvents.
 * Timers are uniform increment-then-compare: a state with duration N
 * occupies exactly N calls before transitioning.
 */
export function advanceFighter(
  f: Fighter,
  input: InputFrame,
  sheet: CharacterSheet,
  world: TickWorld,
  events: SimEvent[],
): void {
  // Rising edge of the attack button: the buffer logs an "A" token exactly
  // when `a` transitions low→high, so scanning this tick's tokens is robust
  // to duplicate pushes of the same frame. The caller feeds the buffer; this
  // function only reads and consumes it.
  f.stateTick += 1;
  const pressedThisTick = (token: string): boolean => {
    for (const rec of f.buffer.pressLog()) {
      if (rec.tick < world.tick) break;
      if (rec.tick === world.tick && rec.token === token) return true;
    }
    return false;
  };
  const aPressed = pressedThisTick("A");

  switch (f.state) {
    case "dead":
      return;                                   // corpses neither act nor regenerate

    case "attack":
      stepMove(f, sheet, world, events, aPressed);
      break;

    case "hitstun":
      if (f.stateTick >= HITSTUN_TICKS) toIdle(f);
      break;

    case "blockstun":
      if (f.stateTick >= BLOCKSTUN_TICKS) toIdle(f);
      break;

    case "knockdown":
      if (f.stateTick >= KNOCKDOWN_TICKS) {
        f.state = "getup";
        f.stateTick = 0;
        f.invulnUntilTick = world.tick + GETUP_IFRAME_TICKS;
      }
      break;

    case "getup":
      if (f.stateTick >= GETUP_TICKS) toIdle(f);
      break;

    case "drinking":
      if (f.stateTick >= DRINKING_TICKS) toIdle(f);
      break;

    case "frozen":
      if ((f.frozenUntilTick !== undefined && world.tick >= f.frozenUntilTick)
        || (f.frozenUntilTick === undefined && f.stateTick >= THAW_TICKS)) toIdle(f);
      break;

    case "burned": {
      // Spec §2.2 burn DOT: BURN_DPS_TICKS (0.5) damage per burned tick,
      // applied BEFORE the expiry check — a burn that ends this tick still
      // dealt its tick of damage. No attacker, so no hit event; a burn KO
      // is settled by the world's end-of-tick match sweep (the alive-set
      // pass in world.ts), not hitdetect's damage-path checkMatchEnd.
      f.hp -= BURN_DPS_TICKS;
      if (f.hp <= 0) {
        f.hp = 0;
        f.state = "dead";
        f.stateTick = 0;
        events.push({ type: "ko", victim: f.id });
        break;
      }
      if ((f.burnUntilTick !== undefined && world.tick >= f.burnUntilTick)
        || (f.burnUntilTick === undefined && f.stateTick >= BURN_TICKS)) toIdle(f);
      break;
    }

    // Spec §2.2 dash: a fixed-duration burst at RUN_DASH_SPEED. The dash
    // holds its course (act suppresses locomotion) but specials, the
    // dashAttack role and jumping stay available through act().
    case "dash":
      if (f.stateTick >= DASH_TICKS) {
        toIdle(f);
        f.vx = 0;
        break;
      }
      f.vx = RUN_DASH_SPEED * f.facing * carrierMul(f, world);   // §3.3: re-assert, drag must not bleed the burst
      act(f, input, sheet, world, events);
      break;

    // Grab exchange (spec §2.2): attack executes the throw — the slam runs
    // via sheet.grabMoveId, whose grab-type hitbox cannot re-apply because
    // applyGrab skips victims already in grabbed/grabbing/thrown. Without a
    // throw input the hold breaks after GRAB_BREAK_TICKS and both fighters
    // release; the victim gets get-up i-frames against an instant re-grab.
    case "grabbing": {
      const victim = world.fighters?.find((v) => v.state === "grabbed");
      if (input.a && victim !== undefined && sheet.grabMoveId !== undefined) {
        victim.state = "thrown";
        victim.stateTick = 0;
        victim.vx = THROW_LAUNCH_VX * f.facing;
        victim.vy = KNOCKDOWN_LAUNCH_VY;
        victim.hitIds.clear();
        tryStartMove(f, sheet.grabMoveId, sheet, world, events);
        events.push({ type: "thrown", victim: victim.id });
        break;
      }
      if (f.stateTick >= GRAB_BREAK_TICKS) {
        toIdle(f);
        if (victim !== undefined) {
          victim.state = "idle";
          victim.stateTick = 0;
          victim.invulnUntilTick = world.tick + GETUP_IFRAME_TICKS;
        }
      }
      break;
    }

    // Grabber died or bugged out: self-release with the same protection.
    case "grabbed":
      if (f.stateTick >= GRAB_BREAK_TICKS) {
        f.state = "idle";
        f.stateTick = 0;
        f.invulnUntilTick = world.tick + GETUP_IFRAME_TICKS;
      }
      break;

    // Physics integrates the arc; landing mirrors the jump case and downs
    // the fighter with i-frames.
    case "thrown":
      if (f.y >= 0 && f.vy >= 0 && f.stateTick > 1) {
        f.state = "knockdown";
        f.stateTick = 0;
        f.invulnUntilTick = world.tick + GETUP_IFRAME_TICKS;
        f.vx = 0;
      }
      break;

    // No producer yet — grab boxes route straight to applyGrab (hitdetect).
    case "grabAttempt":
      break;

    // Landing: grounded again after the launch tick resolves the arc.
    case "jump":
      if (f.y >= 0 && f.vy >= 0 && f.stateTick > 1) {
        toIdle(f);
        f.vx = 0;
        f.vz = 0;
        events.push({ type: "landed", who: f.id });
      }
      break;

    default:
      // "dash" owns its case above; idle/walk share the act() decision set.
      if (f.state === "idle" || f.state === "walk") {
        act(f, input, sheet, world, events);
      }
      break;
  }

  // MP regen every tick (all states except dead), capped at maxMp.
  if (f.mp < sheet.maxMp) f.mp = Math.min(sheet.maxMp, f.mp + sheet.mpRegenPerTick);
}
