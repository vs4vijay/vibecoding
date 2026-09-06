// src/world/World.ts
import type { InputState, ItemType, LevelData, ScreenMap } from "../core/types";
import { TileMap } from "./TileMap";
import { Dave } from "../entities/Dave";
import { Item } from "../entities/Item";
import { Enemy } from "../entities/Enemy";
import { ExitDoor } from "../entities/ExitDoor";
import { Projectile } from "../entities/Projectile";
import { GameState, ITEM_VALUES } from "../state/GameState";
import { RNG } from "../core/RNG";
import { on, emit } from "../core/Events";

export class World {
  readonly state: GameState;
  dave!: Dave;
  map: TileMap;
  items: Item[] = [];
  enemies: Enemy[] = [];
  door: ExitDoor;
  projectiles: Projectile[] = [];
  private level: LevelData;
  private unsubs: Array<() => void> = [];

  constructor(level: LevelData, state: GameState) {
    this.level = level;
    this.state = state;
    const screen = level.screens[level.startScreen]!;
    this.map = new TileMap(screen);
    this.door = new ExitDoor({ x: 0, y: 0 });
    for (const ent of screen.entities) {
      switch (ent.type) {
        case "dave": this.dave = new Dave(ent.x * 16, ent.y * 16); break;
        case "exitDoor": this.door = new ExitDoor({ x: ent.x, y: ent.y }); break;
        case "spider": case "blade": case "sun": case "baton": case "cloud": case "ufo": case "blobby": case "disc":
          break; // enemies instantiated in spawnEnemies (needs RNG) — call spawnEnemies(...) after construction
        default: this.items.push(new Item(ent));
      }
    }
    if (!this.dave) throw new Error("level missing dave");
    this.unsubs.push(on("dave:collect", e => {
      if (e.item === "trophy") this.door.opened = true;
    }));
  }

  /** T16: Enemy implements spider only — other enemy spawn types are tolerated (skipped) until their tasks land. */
  spawnEnemies(rng: RNG): void {
    const screen = this.level.screens[this.level.startScreen]!;
    this.enemies = screen.entities
      .filter(e => e.type === "spider")
      .map(e => new Enemy(e, rng));
  }

  getScreen(): ScreenMap {
    return this.level.screens[this.level.startScreen]!;
  }

  update(input: InputState, rng: RNG): void {
    this.dave.update(input, this.map, this.state);
    for (const e of this.enemies) e.update(this.map, rng);
    for (const p of this.projectiles) p.update(this.map);
    this.projectiles = this.projectiles.filter(p => !p.spent);

    // items
    let collected = false;
    for (const it of this.items) {
      if (it.tryCollect(this.dave, this.state)) collected = true;
    }
    if (collected) {
      // T11 seam: pickups write state.hasGun/state.jetpackFuel, Dave physics reads its own fields — sync state→dave
      this.dave.hasGun = this.state.hasGun;
      this.dave.jetpackFuel = this.state.jetpackFuel;
    }

    // dave vs enemies
    const dhb = this.dave.hitbox;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ehb = e.hitbox;
      const overlap = dhb.x < ehb.x + ehb.w && dhb.x + dhb.w > ehb.x && dhb.y < ehb.y + ehb.h && dhb.y + dhb.h > ehb.y;
      if (overlap) {
        this.dave.alive = false;
        emit({ type: "dave:hurt", source: "enemy" });
        emit({ type: "dave:die" });
        e.takeHit();
      }
    }
    // dave bullets vs enemies
    for (const p of this.projectiles) {
      if (p.owner !== "dave" || p.spent) continue;
      const phb = p.hitbox;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const ehb = e.hitbox;
        if (phb.x < ehb.x + ehb.w && phb.x + phb.w > ehb.x && phb.y < ehb.y + ehb.h && phb.y + phb.h > ehb.y) {
          e.takeHit();
          p.spent = true;
        }
      }
    }

    this.door.update(this.dave, this.state, this.level);
    this.state.maybeEarnOneUp();
  }

  fire(): void {
    if (!this.state.hasGun) return;
    const dir = this.dave.vel.x >= 0 ? 1 : -1;
    const origin = { x: this.dave.pos.x + (dir === 1 ? 24 : -4), y: this.dave.pos.y + 14 };
    this.projectiles.push(new Projectile(origin, { x: dir * 6, y: 0 }, "dave"));
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}
