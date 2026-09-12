// src/render/types.ts — renderer-owned asset contracts (sim stays canvas-free).
import type { CharacterSheet, Layer, StageRuntime } from "../sim/types";

export interface AtlasFrame {
  name: string;
  x: number; y: number;
  w: number; h: number;
  pivotX?: number;
  pivotY?: number;
}

export interface Atlas {
  /** Any drawImage-capable bitmap with intrinsic pixel dimensions. */
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;
  frame(spriteKey: string): AtlasFrame;
}

/** Per-category atlas set + frozen sheets, loaded once at boot (§3.6). */
export interface Assets {
  fighters: Atlas;
  props: Atlas;
  fx: Atlas;
  bg: Atlas;
  /** Frozen CharacterSheets from the content cache; sprite-key resolution + HUD maxima. */
  sheets: ReadonlyMap<string, CharacterSheet>;
  /** Stages carry parallax layer lists (T8 loader type); renderer composites them. */
  stages: ReadonlyMap<string, StageRuntime & { layers: Layer[] }>;
}

export type { Layer };
