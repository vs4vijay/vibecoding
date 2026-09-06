// src/entities/Dave.ts
import { PHYSICS, type InputState, type Rect, type Vec2 } from "../core/types";
import { TileMap } from "../world/TileMap";
import { GameState } from "../state/GameState";
import { emit } from "../core/Events";
import { allocId, type Entity } from "./Entity";

export class Dave implements Entity {
  readonly id = allocId();
  pos: Vec2;
  vel: Vec2 = { x: 0, y: 0 };
  grounded = false;
  climbing = false;
  jetpackFuel = 0;
  hasGun = false;
  alive = true;
  private facing: 1 | -1 = 1;
  private jumpHeld = false;

  constructor(x: number, y: number) {
    this.pos = { x, y };
  }

  get hitbox(): Rect {
    const hb = PHYSICS.HITBOX;
    return { x: this.pos.x + hb.x, y: this.pos.y + hb.y, w: hb.w, h: hb.h };
  }

  update(input: InputState, map: TileMap, state: GameState): void {
    if (!this.alive) return;

    // horizontal
    if (input.left && !input.right) { this.facing = -1; this.vel.x = Math.max(this.vel.x - PHYSICS.WALK_ACCEL, -PHYSICS.WALK_MAX); }
    else if (input.right && !input.left) { this.facing = 1; this.vel.x = Math.min(this.vel.x + PHYSICS.WALK_ACCEL, PHYSICS.WALK_MAX); }
    else this.vel.x *= PHYSICS.WALK_DECEL;

    // jetpack
    const jetting = input.jetpack && this.jetpackFuel > 0;
    if (jetting) {
      this.vel.y += (input.jump ? -1 : 1) * 0; // direction handled below by up thrust
      this.vel.y += PHYSICS.JETPACK_THRUST;
      this.jetpackFuel = Math.max(0, this.jetpackFuel - PHYSICS.JETPACK_FUEL_PER_FRAME);
      this.grounded = false;
      this.climbing = false;
    } else {
      // jump
      if (input.jump && this.grounded) { this.vel.y = PHYSICS.JUMP_VELOCITY; this.grounded = false; this.jumpHeld = true; }
      else if (!input.jump && this.jumpHeld && this.vel.y < 0) { this.vel.y *= PHYSICS.JUMP_CUTOFF; this.jumpHeld = false; }
      // gravity
      this.vel.y = Math.min(this.vel.y + PHYSICS.GRAVITY, PHYSICS.MAX_FALL);
    }

    // climb check
    if (!jetting && input.jump && this.isTouchingClimbable(map)) {
      this.climbing = true;
      this.vel.x = 0; this.vel.y = -PHYSICS.WALK_MAX * 0.6;
    } else if (this.climbing) {
      this.climbing = false;
    }

    this.moveAndCollide(map);
    this.checkLethal(map);
    this.jetpackFuel = Math.min(this.jetpackFuel, PHYSICS.JETPACK_FUEL_MAX);
  }

  private isTouchingClimbable(map: TileMap): boolean {
    const hb = this.hitbox;
    return map.isClimbableAt(hb.x + hb.w / 2, hb.y) || map.isClimbableAt(hb.x + hb.w / 2, hb.y + hb.h);
  }

  private moveAndCollide(map: TileMap): void {
    // X axis
    this.pos.x += this.vel.x;
    let hb = this.hitbox;
    let hit = map.solidCollides(hb);
    if (hit) {
      if (this.vel.x > 0) this.pos.x = Math.floor((hb.x + hb.w) / PHYSICS.TILE) * PHYSICS.TILE - PHYSICS.HITBOX.x - PHYSICS.HITBOX.w - 0.01;
      else if (this.vel.x < 0) this.pos.x = (Math.floor(hb.x / PHYSICS.TILE) + 1) * PHYSICS.TILE - PHYSICS.HITBOX.x + 0.01;
      this.vel.x = 0;
    }
    // Y axis
    this.pos.y += this.vel.y;
    hb = this.hitbox;
    hit = map.solidCollides(hb);
    if (hit) {
      if (this.vel.y > 0) { this.pos.y = Math.floor((hb.y + hb.h) / PHYSICS.TILE) * PHYSICS.TILE - PHYSICS.HITBOX.y - PHYSICS.HITBOX.h - 0.01; this.grounded = true; }
      else if (this.vel.y < 0) { this.pos.y = (Math.floor(hb.y / PHYSICS.TILE) + 1) * PHYSICS.TILE - PHYSICS.HITBOX.y + 0.01; }
      this.vel.y = 0;
    }

    // illusory: fall through if moving down (only when not standing)
    if (!this.grounded && this.vel.y > 0 && map.isIllusoryAt(hb.x + hb.w / 2, hb.y + hb.h + 1)) {
      // do nothing: illusory is not solid (solidCollides skips it)
    }
  }

  private checkLethal(map: TileMap): void {
    const hb = this.hitbox;
    if (map.lethalCollides(hb) || map.isLethalAt(hb.x + hb.w / 2, hb.y + hb.h + 1)) {
      this.alive = false;
      emit({ type: "dave:hurt", source: "lethal" });
      emit({ type: "dave:die" });
    }
  }
}
