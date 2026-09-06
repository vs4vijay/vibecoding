// src/render/Renderer.ts
import { PHYSICS } from "../core/types";
import { PALETTE_0, PALETTE_1, SPRITE_RECTS, buildSpriteAtlas } from "./sprites";

export function scaleToFit(vw: number, vh: number): number {
  const s = Math.floor(Math.min(vw / PHYSICS.LOGICAL_W, vh / PHYSICS.LOGICAL_H));
  return Math.max(1, Math.min(8, s));
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private scale: number;
  private palette: 0 | 1 = 0;
  private atlas: HTMLCanvasElement;

  constructor(container: HTMLElement, scale = 3) {
    this.canvas = document.createElement("canvas");
    this.scale = scale;
    this.canvas.style.imageRendering = "pixelated";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;
    this.atlas = buildSpriteAtlas();
    this.applySize();
  }

  setScale(scale: number): void {
    this.scale = Math.max(1, Math.min(8, Math.floor(scale)));
    this.applySize();
  }
  setPalette(p: 0 | 1): void {
    this.palette = p;
    const pal = p === 0 ? PALETTE_0 : PALETTE_1;
    this.atlas = buildSpriteAtlas(i => pal[i]!);
  }
  private applySize(): void {
    this.canvas.width = PHYSICS.LOGICAL_W * this.scale;
    this.canvas.height = PHYSICS.LOGICAL_H * this.scale;
  }
  clear(): void {
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
  drawTile(id: number, tx: number, ty: number): void {
    this.drawRects(tx * PHYSICS.TILE * this.scale, ty * PHYSICS.TILE * this.scale, id);
  }
  private drawRects(px: number, py: number, id: number): void { /* placeholder — replaced by drawSprite in Task 15 */ }

  drawSprite(name: string, px: number, py: number, flipX = false): void {
    const r = SPRITE_RECTS.get(name);
    if (!r) return;
    const scale = this.scale;
    const sx = px * scale;
    const sy = py * scale;
    if (flipX) {
      this.ctx.save();
      this.ctx.translate(sx + r.w * scale, sy);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(this.atlas, r.x, r.y, r.w, r.h, 0, 0, r.w * scale, r.h * scale);
      this.ctx.restore();
    } else {
      this.ctx.drawImage(this.atlas, r.x, r.y, r.w, r.h, sx, sy, r.w * scale, r.h * scale);
    }
  }

  drawText(text: string, px: number, py: number, color = "#fff"): void {
    this.ctx.fillStyle = color;
    this.ctx.font = `${8 * this.scale}px monospace`;
    this.ctx.textBaseline = "top";
    this.ctx.fillText(text, px * this.scale, py * this.scale);
  }
}
