// src/render/HUD.ts
import { GameState } from "../state/GameState";
import { Renderer } from "./Renderer";

export class HUD {
  constructor(private renderer: Renderer) {}

  draw(state: GameState): void {
    const r = this.renderer;
    // Solid bar so HUD text never blends with tiles behind it.
    r.fillRect(0, 0, 320, 10, "#000");
    r.drawText(`SCORE ${String(state.score).padStart(5, "0")}`, 1, 1);
    r.drawText(`LV${state.level}`, 104, 1);
    r.drawText(`LIVES ${state.lives}`, 160, 1);
    const status: string[] = [];
    if (state.hasGun) status.push("GUN");
    if (state.jetpackFuel > 0) status.push(`FUEL ${Math.round((state.jetpackFuel / 60) * 100)}%`);
    if (status.length > 0) {
      const lowFuel = state.jetpackFuel > 0 && state.jetpackFuel < 15;
      const blink = lowFuel && Math.floor(Date.now() / 300) % 2 === 0;
      r.drawText(status.join(" "), 232, 1, blink ? "#ff5555" : "#fff");
    }
  }
}
