// src/render3d/viewTypes.ts — structural views of sim objects handed to the 3D layer.
// The 3D layer never imports sim classes directly except via these shapes.
import type { Vec2 } from "../core/types";

export interface ItemView {
  readonly type: string; // ItemType or "gun" | "jetpack" | "oneUp"
  pos: Vec2;
  collected: boolean;
}
export interface EnemyView {
  pos: Vec2;
  dead: boolean;
}
export interface BulletView {
  pos: Vec2;
  vel: Vec2;
  spent: boolean;
  readonly owner: "dave" | "enemy";
}
export interface DoorView {
  pos: Vec2;
  opened: boolean;
}
export interface DaveView {
  pos: Vec2;
  vel: Vec2;
  grounded: boolean;
  alive: boolean;
  jetpackFuel: number;
  hasGun: boolean;
}

export interface RenderUiState {
  flow: "menu" | "playing" | "paused" | "gameover" | "clear";
  score: number;
  lives: number;
  level: number;
  hasGun: boolean;
  fuel: number; // 0..fuelMax
  fuelMax: number;
  lowFuel: boolean;
}

export interface FxHooks {
  collect(kind: string, at: { x: number; y: number }): void;
  death(at: { x: number; y: number }): void;
  land(at: { x: number; y: number }): void;
  shoot(at: { x: number; y: number }): void;
  enemyDie(at: { x: number; y: number }): void;
  doorOpen(at: { x: number; y: number }): void;
  jetpack(on: boolean): void;
  warp(): void;
}
