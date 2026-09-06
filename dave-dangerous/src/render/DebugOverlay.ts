// src/render/DebugOverlay.ts
import { Renderer } from "./Renderer";
import type { World } from "../world/World";
import { PHYSICS } from "../core/types";

export class DebugOverlay {
  enabled = false;
  constructor(private renderer: Renderer) {}

  toggle(): void { this.enabled = !this.enabled; }

  draw(world: World): void {
    if (!this.enabled) return;
    const r = this.renderer;
    // dave hitbox
    const dh = world.dave.hitbox;
    this.rect(dh.x, dh.y, dh.w, dh.h, "#0f0");
    // enemies
    for (const e of world.enemies) {
      if (e.dead) continue;
      const eh = e.hitbox;
      this.rect(eh.x, eh.y, eh.w, eh.h, "#f00");
    }
    // tile grid on lethal tiles
    for (let ty = 0; ty < world.map.height; ty++) {
      for (let tx = 0; tx < world.map.width; tx++) {
        const def = world.map.at(tx, ty);
        if (def?.flags.lethal) this.rect(tx * 16, ty * 16, 16, 16, "#f0f");
      }
    }
    r.drawText(`screen ${world.state.currentScreen} score ${world.state.score}`, 1, 184);
  }

  private rect(x: number, y: number, w: number, h: number, color: string): void {
    const r = this.renderer;
    const s = r.canvas.width / PHYSICS.LOGICAL_W;
    r.ctx.strokeStyle = color;
    r.ctx.lineWidth = 1;
    r.ctx.strokeRect(x * s, y * s, w * s, h * s);
  }
}
