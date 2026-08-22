import "./style.css";
import { createGame } from "./game";
import { initHud } from "./hud";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const game = createGame(canvas);
const hud = initHud(game.world);

// Phase 13: rebuild the HUD layout whenever the 1P/2P mode flips on the title
game.setOnModeChange((twoPlayer) => hud.setMode(twoPlayer));

window.addEventListener("resize", () => game.onResize());

// Bootstrap: RAF loop owns timing; game.update(dt) advances simulation.
let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1); // clamp long frames
  last = now;
  game.update(dt);
  game.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Dev/debug: headless smoke tests read race state through this handle.
(window as any).__tankracerWorld = game.worldRef;
