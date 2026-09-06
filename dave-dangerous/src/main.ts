// src/main.ts — entry point
import { Game } from "./game";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("missing #app");
const game = new Game(app);
game.start();
