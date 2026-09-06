// src/entities/Entity.ts
import type { Rect, Vec2 } from "../core/types";

export interface Entity {
  readonly id: number;
  pos: Vec2;
  get hitbox(): Rect;
}

let nextId = 1;
export function allocId(): number { return nextId++; }
