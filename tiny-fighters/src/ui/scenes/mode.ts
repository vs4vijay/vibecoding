// src/ui/scenes/mode.ts — FFA vs 2 Teams cards; opens the shared MatchSetup.
// Attack on a card locks the mode and moves to Character Select. Keyboard:
// Left/Right move the cursor, Attack confirms; clicking a card works too.
import { el, onMenuKeys } from "../kit";
import type { Scene, SceneCtx } from "../scene-manager";
import { freshSlots, uiSeed, type GameMode, type MatchSetup } from "../flow";

export function createModeScene(humanSlots: number[] = [0]): Scene {
  const root = el("div", { cls: "scene mode" });
  let ctx: SceneCtx | undefined;
  let disposeKeys: (() => void) | null = null;

  const heading = el("div", { cls: "panel-title", text: "SELECT MODE" });
  const cards: HTMLElement[] = [];

  function choose(mode: GameMode): void {
    if (ctx === undefined) return;
    const setup: MatchSetup = {
      mode,
      selectSlots: freshSlots(),
      humans: [...humanSlots],
      padsBySlot: {},
      stageId: "grassland-dojo",
      seed: uiSeed(),
    };
    ctx.goto("select", setup);
  }

  return {
    root,
    enter(c) {
      ctx = c ?? ctx;
      if (root.children.length > 0) return;
      root.appendChild(heading);
      let cursor = 0;
      for (const mode of ["ffa", "teams"] as const) {
        const card = el("div", {
          cls: "card mode-card",
          text: mode === "ffa" ? "FREE-FOR-ALL" : "2 TEAMS",
          onClick: () => choose(mode),
        });
        root.appendChild(card);
        cards.push(card);
      }
      const paint = (): void => {
        for (const [i, card] of cards.entries()) card.classList.toggle("selected", i === cursor);
      };
      disposeKeys = onMenuKeys(globalThis.document, humanSlots, (_slot, action) => {
        if (action === "left" && cursor > 0) cursor--;
        else if (action === "right" && cursor < cards.length - 1) cursor++;
        else if (action === "attack") choose(cursor === 0 ? "ffa" : "teams");
        else return;
        paint();
      });
      paint();
    },
    exit() {
      disposeKeys?.();
      disposeKeys = null;
    },
    update() {},
  };
}
