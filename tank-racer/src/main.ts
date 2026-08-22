import "./style.css";
import { createGame } from "./game";
import { initHud } from "./hud";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const game = createGame(canvas);
initHud(game.world);

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
