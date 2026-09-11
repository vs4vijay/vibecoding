// src/ui/scenes/stage-select.ts — 2 stage cards + seed display; Attack confirms.
import { el, onMenuKeys } from "../kit";
import type { Scene, SceneCtx } from "../scene-manager";
import type { MatchSetup } from "../flow";

const STAGES = [
  { id: "grassland-dojo", label: "GRASSLAND DOJO" },
  { id: "rooftop-night", label: "ROOFTOP NIGHT" },
] as const;

export function createStageSelectScene(humanSlots: number[] = [0]): Scene {
  const root = el("div", { cls: "scene stage-select" });
  let ctx: SceneCtx | undefined;
  let disposeKeys: (() => void) | null = null;
  let setup: MatchSetup | null = null;
  let cursor = 0;

  const heading = el("div", { cls: "panel-title", text: "SELECT STAGE" });
  const seedLabel = el("div", { cls: "seed" });
  const cardEls = STAGES.map((stage) =>
    el("div", { cls: "card stage-card", text: stage.label }),
  );

  function paint(): void {
    for (const [i, card] of cardEls.entries()) card.classList.toggle("selected", i === cursor);
    if (setup !== null) seedLabel.textContent = `SEED ${setup.seed}`;
  }

  function confirm(): void {
    if (ctx === undefined || setup === null) return;
    setup.stageId = STAGES[cursor]!.id;
    ctx.goto("battle", setup);
  }

  return {
    root,
    enter(c) {
      ctx = c ?? ctx;
      const arg = c?.gotoArg as MatchSetup | undefined;
      if (arg !== undefined) setup = arg;
      if (root.children.length === 0) {
        root.appendChild(heading);
        for (const [i, card] of cardEls.entries()) {
          card.addEventListener("click", () => {
            cursor = i;
            confirm();
          });
        }
        root.append(...cardEls);
        root.appendChild(seedLabel);
      }
      disposeKeys = onMenuKeys(globalThis.document, humanSlots, (_slot, action) => {
        if (action === "left" && cursor > 0) cursor--;
        else if (action === "right" && cursor < cardEls.length - 1) cursor++;
        else if (action === "attack") confirm();
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
