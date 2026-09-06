// src/entities/Item.ts
import { ITEM_VALUES } from "../state/GameState";
import type { EntitySpawn, EntityType, ItemType, Rect, Vec2 } from "../core/types";
import { emit } from "../core/Events";
import { allocId, type Entity } from "./Entity";
import { Dave } from "./Dave";
import { GameState } from "../state/GameState";

const HITBOX: Rect = { x: 0, y: 0, w: 16, h: 16 };

export class Item implements Entity {
  readonly id = allocId();
  readonly type: EntityType;
  pos: Vec2;
  collected = false;
  readonly value: number;

  constructor(spawn: EntitySpawn) {
    this.type = spawn.type;
    this.pos = { x: spawn.x * 16, y: spawn.y * 16 };
    this.value = ITEM_VALUES[spawn.type as ItemType] ?? 0;
  }

  get hitbox(): Rect {
    return { x: this.pos.x + HITBOX.x, y: this.pos.y + HITBOX.y, w: HITBOX.w, h: HITBOX.h };
  }

  tryCollect(dave: Dave, state: GameState): boolean {
    if (this.collected) return false;
    const hb = this.hitbox;
    const dhb = dave.hitbox;
    const overlap = hb.x < dhb.x + dhb.w && hb.x + hb.w > dhb.x && hb.y < dhb.y + dhb.h && hb.y + hb.h > dhb.y;
    if (!overlap) return false;

    switch (this.type) {
      case "gun": state.hasGun = true; emit({ type: "gun:pickup" }); break;
      case "jetpack": state.jetpackFuel = 60; emit({ type: "jetpack:pickup", fuel: 60 }); break;
      case "oneUp": state.addOneUp(); emit({ type: "oneup:pickup" }); break;
      default: {
        state.addScore(this.value);
        emit({ type: "dave:collect", item: this.type as ItemType, value: this.value });
        if (this.type === "trophy") { /* door handled in Task 12 */ }
      }
    }
    this.collected = true;
    return true;
  }
}
