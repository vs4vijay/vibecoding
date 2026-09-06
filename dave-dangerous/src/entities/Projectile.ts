// src/entities/Projectile.ts
import { PHYSICS, type Rect, type Vec2 } from "../core/types";
import { TileMap } from "../world/TileMap";
import { allocId, type Entity } from "./Entity";

export class Projectile implements Entity {
  readonly id = allocId();
  pos: Vec2;
  vel: Vec2;
  readonly owner: "dave" | "enemy";
  spent = false;

  constructor(pos: Vec2, vel: Vec2, owner: "dave" | "enemy") {
    this.pos = { ...pos };
    this.vel = { ...vel };
    this.owner = owner;
  }

  get hitbox(): Rect {
    return { x: this.pos.x, y: this.pos.y, w: 4, h: 4 };
  }

  update(map: TileMap): boolean {
    if (this.spent) return false;
    this.pos.x += this.vel.x;
    this.pos.y += this.vel.y;
    if (map.solidCollides(this.hitbox)) { this.spent = true; return false; }
    const out = this.pos.x < 0 || this.pos.x > PHYSICS.LOGICAL_W || this.pos.y < 0 || this.pos.y > PHYSICS.LOGICAL_H;
    if (out) { this.spent = true; return false; }
    return true;
  }
}
