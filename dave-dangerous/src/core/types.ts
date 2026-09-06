// src/core/types.ts
export type Action = "left" | "right" | "jump" | "jetpack" | "fire";
export type InputState = Record<Action, boolean>;
export type InputBuffer = Record<Action, number>;

export interface Vec2 { x: number; y: number; }
export interface Rect { x: number; y: number; w: number; h: number; }

export type TileId = number;
export interface TileFlags {
  solid: boolean;
  climbable: boolean;
  lethal: boolean;
  warp: boolean;
  illusory: boolean;
  collectible?: ItemType;
}
export interface TileDef { id: TileId; flags: TileFlags; src: Rect; }

export type ItemType =
  | "orb" | "blueDiamond" | "redDiamond" | "ring" | "crown" | "scepter" | "trophy";

export type EntityType =
  | "dave" | "spider" | "blade" | "sun" | "baton" | "cloud" | "ufo" | "blobby" | "disc"
  | "bullet" | "enemyBullet"
  | ItemType | "gun" | "jetpack" | "oneUp"
  | "exitDoor";

export interface EntitySpawn {
  type: EntityType;
  x: number;
  y: number;
  props?: Record<string, unknown>;
}

export interface WarpDef {
  edge: "left" | "right" | "top" | "bottom";
  toScreen: number;
  toX: number;
  toY: number;
}

export interface ScreenMap {
  width: number;
  height: number;
  tiles: TileId[];
  entities: EntitySpawn[];
  warps?: WarpDef[];
}

export interface LevelData {
  id: number;
  name: string;
  screens: ScreenMap[];
  startScreen: number;
  musicTrack?: string;
}

export const PHYSICS = {
  WALK_ACCEL: 0.35,
  WALK_DECEL: 0.85,
  WALK_MAX: 2.5,
  GRAVITY: 0.45,
  MAX_FALL: 8,
  JUMP_VELOCITY: -7.2,
  JUMP_CUTOFF: 0.5,
  JETPACK_THRUST: -0.38,
  JETPACK_FUEL_PER_FRAME: 1 / 15,
  JETPACK_FUEL_MAX: 60,
  BULLET_SPEED: 6,
  HITBOX: { x: 4, y: 2, w: 16, h: 30 } as Rect,
  PUSHBACK: 2,
  TILE: 16,
  SCREEN_W: 20,
  SCREEN_H: 13,
  LOGICAL_W: 320,
  LOGICAL_H: 200,
} as const;

export type GameEvent =
  | { type: "dave:collect"; item: ItemType; value: number }
  | { type: "dave:hurt"; source: "enemy" | "lethal" | "fall" }
  | { type: "dave:die" }
  | { type: "enemy:die" }
  | { type: "level:complete"; level: number; score: number }
  | { type: "level:warp"; fromScreen: number; toScreen: number }
  | { type: "gun:pickup" }
  | { type: "jetpack:pickup"; fuel: number }
  | { type: "oneup:pickup" };
