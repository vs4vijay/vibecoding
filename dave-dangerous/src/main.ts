// src/main.ts — entry point
import { Game } from "./game";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("missing #app");
const game = new Game(app);
game.start();

const on = (id: string, fn: () => void): void => {
  document.querySelector<HTMLButtonElement>(id)?.addEventListener("click", fn);
};

const soundBtn = document.querySelector<HTMLButtonElement>("#btn-sound");
on("#btn-pause", () => game.togglePause());
on("#btn-resume", () => game.resume());
on("#btn-restart", () => game.restart());
on("#btn-restart2", () => game.restart());
on("#btn-again", () => game.restart());
on("#btn-next", () => game.finishClear());
on("#btn-sound", () => {
  const muted = game.toggleMute();
  if (soundBtn) soundBtn.textContent = muted ? "Sound off (M)" : "Sound on (M)";
});
