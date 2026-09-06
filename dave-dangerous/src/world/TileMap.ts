// src/world/TileMap.ts
import { PHYSICS, type Rect, type ScreenMap, type TileDef } from "../core/types";

export const TILE_DEFS: Record<number, TileDef> = {
  0: { id: 0, flags: { solid: false, climbable: false, lethal: false, warp: false, illusory: false }, src: { x: 0, y: 0, w: 16, h: 16 } },
  1: { id: 1, flags: { solid: true, climbable: false, lethal: false, warp: false, illusory: false }, src: { x: 16, y: 0, w: 16, h: 16 } },
  2: { id: 2, flags: { solid: true, climbable: false, lethal: false, warp: false, illusory: false }, src: { x: 32, y: 0, w: 16, h: 16 } },
  3: { id: 3, flags: { solid: false, climbable: false, lethal: true, warp: false, illusory: false }, src: { x: 48, y: 0, w: 16, h: 16 } },
  4: { id: 4, flags: { solid: false, climbable: true, lethal: false, warp: false, illusory: false }, src: { x: 64, y: 0, w: 16, h: 16 } },
  5: { id: 5, flags: { solid: false, climbable: false, lethal: false, warp: false, illusory: true }, src: { x: 80, y: 0, w: 16, h: 16 } },
  6: { id: 6, flags: { solid: true, climbable: false, lethal: true, warp: false, illusory: false }, src: { x: 96, y: 0, w: 16, h: 16 } },
};

export class TileMap {
  readonly width: number;
  readonly height: number;
  private readonly tiles: Uint8Array;
  private readonly defs: Record<number, TileDef>;

  constructor(screen: ScreenMap, defs: Record<number, TileDef> = TILE_DEFS) {
    this.width = screen.width;
    this.height = screen.height;
    this.tiles = Uint8Array.from(screen.tiles);
    this.defs = defs;
  }

  tileIndexAt(px: number, py: number): number {
    const tx = Math.floor(px / PHYSICS.TILE);
    const ty = Math.floor(py / PHYSICS.TILE);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return -1;
    return ty * this.width + tx;
  }

  at(tx: number, ty: number): TileDef | null {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return null;
    const id = this.tiles[ty * this.width + tx]!;
    return this.defs[id] ?? null;
  }

  tileAtPixel(px: number, py: number): TileDef | null {
    const idx = this.tileIndexAt(px, py);
    if (idx < 0) return null;
    return this.defs[this.tiles[idx]!] ?? null;
  }

  private screenRect(): Rect {
    return { x: 0, y: 0, w: this.width * PHYSICS.TILE, h: this.height * PHYSICS.TILE };
  }

  private rectTiles(rect: Rect): Array<{ tx: number; ty: number; def: TileDef }> {
    const out: Array<{ tx: number; ty: number; def: TileDef }> = [];
    const x0 = Math.floor(rect.x / PHYSICS.TILE);
    const y0 = Math.floor(rect.y / PHYSICS.TILE);
    const x1 = Math.floor((rect.x + rect.w - 0.01) / PHYSICS.TILE);
    const y1 = Math.floor((rect.y + rect.h - 0.01) / PHYSICS.TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const def = this.at(tx, ty);
        if (def) out.push({ tx, ty, def });
      }
    }
    return out;
  }

  isSolidAt(px: number, py: number): boolean {
    const def = this.tileAtPixel(px, py);
    return def?.flags.solid ?? false;
  }
  isLethalAt(px: number, py: number): boolean {
    const def = this.tileAtPixel(px, py);
    return def?.flags.lethal ?? false;
  }
  isClimbableAt(px: number, py: number): boolean {
    const def = this.tileAtPixel(px, py);
    return def?.flags.climbable ?? false;
  }
  isIllusoryAt(px: number, py: number): boolean {
    const def = this.tileAtPixel(px, py);
    return def?.flags.illusory ?? false;
  }

  /** any defined (non-empty) tile overlapping rect, any flags */
  collides(rect: Rect): TileDef | null {
    for (const { def } of this.rectTiles(rect)) {
      if (def.id !== 0) return def;
    }
    return null;
  }

  /** any solid (non-illusory) tile overlapping rect */
  solidCollides(rect: Rect): TileDef | null {
    const bounds = this.screenRect();
    if (rect.x < bounds.x || rect.y < bounds.y || rect.x + rect.w > bounds.x + bounds.w || rect.y + rect.h > bounds.y + bounds.h) {
      return TILE_DEFS[1]!; // walls
    }
    for (const { def } of this.rectTiles(rect)) {
      if (def.flags.solid) return def;
    }
    return null;
  }

  lethalCollides(rect: Rect): TileDef | null {
    for (const { def } of this.rectTiles(rect)) {
      if (def.flags.lethal) return def;
    }
    return null;
  }
}
