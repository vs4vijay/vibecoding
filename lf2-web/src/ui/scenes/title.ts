// src/ui/scenes/title.ts — logo, blinking PRESS ATTACK, real menu.
// Up/Down move the cursor over VS MODE / CONTROLS / ABOUT; Attack selects.
// VS MODE keeps the one-press quick start; the other items push info scenes
// onto the scene stack so Defend pops back here.
import { el, onMenuKeys } from "../kit";
import type { Scene, SceneCtx } from "../scene-manager";
import { createControlsScene, createAboutScene } from "./controls";

const ITEMS = ["VS MODE", "CONTROLS", "ABOUT"] as const;

export function createTitleScene(humanSlots: number[] = [0]): Scene {
  const root = el("div", { cls: "scene title" });
  let ctx: SceneCtx | undefined;
  let disposeKeys: (() => void) | null = null;
  let blink = 0;
  let cursor = 0;

  const logo = el("div", { cls: "logo", text: "LF2 WEB" });
  const prompt = el("div", { cls: "press-attack blink", text: "PRESS ATTACK" });
  const menu = el("div", { cls: "menu-row title-menu" });
  const items = ITEMS.map((label, i) => {
    const item = el("div", {
      cls: "card title-item",
      text: label,
      onClick: () => {
        cursor = i;
        paint();
        choose();
      },
    });
    menu.appendChild(item);
    return item;
  });

  function paint(): void {
    for (const [i, item] of items.entries()) item.classList.toggle("selected", i === cursor);
  }

  function choose(): void {
    if (ctx === undefined) return;
    if (cursor === 0) ctx.goto("mode");
    else if (cursor === 1) ctx.sm.push(createControlsScene());
    else ctx.sm.push(createAboutScene());
  }

  return {
    root,
    enter(c) {
      ctx = c ?? ctx;
      if (root.children.length === 0) {
        root.appendChild(logo);
        root.appendChild(prompt);
        root.appendChild(menu);
      }
      paint();
      disposeKeys = onMenuKeys(globalThis.document, humanSlots, (_slot, action) => {
        if (action === "up" && cursor > 0) cursor--;
        else if (action === "down" && cursor < ITEMS.length - 1) cursor++;
        else if (action === "attack") choose();
        else return;
        paint();
      });
    },
    exit() {
      disposeKeys?.();
      disposeKeys = null;
    },
    update(dtMs: number) {
      blink += dtMs;
      prompt.style.opacity = Math.floor(blink / 500) % 2 === 0 ? "1" : "0.15";
    },
  };
}
