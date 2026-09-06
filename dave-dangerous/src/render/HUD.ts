// src/render/HUD.ts
import { GameState } from "../state/GameState";
import { Renderer } from "./Renderer";

export class HUD {
  constructor(private renderer: Renderer) {}

  draw(state: GameState): void {
    const r = this.renderer;
    r.drawText(`SCORE ${String(state.score).padStart(5, "0")}`, 1, 1);
    r.drawText(`LIVES ${state.lives}`, 15 * 8, 1);
    if (state.hasGun) r.drawText("GUN", 15 * 8, 9);
    if (state.jetpackFuel > 0) {
      const pct = Math.round((state.jetpackFuel / 60) * 100);
      r.drawText(`FUEL ${pct}%`, 1, 17); // second row
    }
  }
}
