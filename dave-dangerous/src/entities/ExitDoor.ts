// src/entities/ExitDoor.ts
import type { LevelData, Rect, Vec2 } from "../core/types";
import { emit } from "../core/Events";
import { Dave } from "./Dave";
import { GameState, EXIT_BONUS } from "../state/GameState";
import { allocId, type Entity } from "./Entity";

const HITBOX: Rect = { x: 0, y: 0, w: 16, h: 32 };

export class ExitDoor implements Entity {
  readonly id = allocId();
  pos: Vec2;
  opened = false;
  private done = false;

  constructor(spawn: { x: number; y: number }) {
    this.pos = { x: spawn.x * 16, y: spawn.y * 16 };
  }

  get hitbox(): Rect {
    return { x: this.pos.x + HITBOX.x, y: this.pos.y + HITBOX.y, w: HITBOX.w, h: HITBOX.h };
  }

  update(dave: Dave, state: GameState, level: LevelData): void {
    if (this.done) return;
    if (!this.opened) return;
    const hb = this.hitbox;
    const dhb = dave.hitbox;
    const overlap = hb.x < dhb.x + dhb.w && hb.x + hb.w > dhb.x && hb.y < dhb.y + dhb.h && hb.y + hb.h > dhb.y;
    if (overlap) {
      state.addScore(EXIT_BONUS);
      state.maybeEarnOneUp();
      this.done = true;
      emit({ type: "level:complete", level: level.id, score: state.score });
    }
  }
}
