// src/entities/Enemy.ts
import { PHYSICS, type EntitySpawn, type Rect, type Vec2 } from "../core/types";
import { TileMap } from "../world/TileMap";
import { RNG } from "../core/RNG";
import { emit } from "../core/Events";
import { allocId, type Entity } from "./Entity";

export class Enemy implements Entity {
  readonly id = allocId();
  readonly type: "spider" | "blade" | "sun" | "baton" | "cloud" | "ufo" | "blobby" | "disc";
  pos: Vec2;
  vel: Vec2 = { x: 0, y: 0 };
  dead = false;
  health = 1;
  private patrol: [number, number];
  private speed: number;
  private dir: 1 | -1 = 1;
  private frame = 0;

  constructor(spawn: EntitySpawn, rng: RNG) {
    this.type = spawn.type as Enemy["type"];
    this.pos = { x: spawn.x * PHYSICS.TILE, y: spawn.y * PHYSICS.TILE };
    const p = spawn.props as { patrol?: [number, number]; speed?: number } | undefined;
    this.patrol = p?.patrol ?? [spawn.x, spawn.x + 5];
    this.speed = p?.speed ?? 0.5;
    if (rng.next() < 0.5) this.dir = -1;
  }

  get hitbox(): Rect {
    return { x: this.pos.x + 2, y: this.pos.y + 2, w: 12, h: 12 };
  }

  update(map: TileMap, rng: RNG): void {
    if (this.dead) return;
    this.frame++;
    const minX = this.patrol[0] * PHYSICS.TILE;
    const maxX = this.patrol[1] * PHYSICS.TILE + PHYSICS.TILE - 1;
    this.pos.x += this.dir * this.speed;
    if (this.pos.x <= minX) { this.pos.x = minX; this.dir = 1; }
    if (this.pos.x >= maxX) { this.pos.x = maxX; this.dir = -1; }
    // every 60 frames maybe reverse direction (deterministic)
    if (this.frame % 60 === 0 && rng.next() < 0.3) this.dir = this.dir === 1 ? -1 : 1;
  }

  takeHit(): void {
    if (this.dead) return;
    this.health--;
    if (this.health <= 0) {
      this.dead = true;
      emit({ type: "enemy:die" });
    }
  }
}
