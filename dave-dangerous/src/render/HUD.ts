// src/render/HUD.ts
import { GameState } from "../state/GameState";
import { Renderer } from "./Renderer";

export class HUD {
  constructor(private renderer: Renderer) {}

  draw(state: GameState): void {
    const r = this.renderer;
    r.drawText(`SCORE ${String(state.score).padStart(5, "0")}`, 1, 1);
    r.drawText(`LIVES ${state.lives}`, 15, 1);
    if (state.hasGun) r.drawText("GUN", 15, 9);
    if (state.jetpackFuel > 0) {
      const pct = Math.round((state.jetpackFuel / 60) * 100);
      r.drawText(`FUEL ${pct}%`, 15 * 0 + 1, 17); // second row
    }
  }
}
