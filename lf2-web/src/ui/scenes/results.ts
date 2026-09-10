// src/ui/scenes/results.ts — winner banner (team color) or K/D standings;
// Rematch (seed+1) / Character Select / Menu.
import { el, onMenuKeys, TEAM_COLORS } from "../kit";
import type { Scene, SceneCtx } from "../scene-manager";
import { rematchSetup, type MatchSetup } from "../flow";
import type { Team } from "../../sim/types";

export interface MatchOutcome {
  winnerTeam: Team | "draw";
  /** Per-slot kills/deaths tallied by the battle scene from sim events. */
  kd: Array<{ slot: number; charId: string; team: Team; isHuman: boolean; kills: number; deaths: number }>;
}

export function createResultsScene(): Scene {
  const root = el("div", { cls: "scene results" });
  let ctx: SceneCtx | undefined;
  let disposeKeys: (() => void) | null = null;
  let setup: MatchSetup | null = null;

  const banner = el("div", { cls: "banner" });
  const standings = el("div", { cls: "standings" });

  const menu = el("div", { cls: "menu-row" });
  const rematchBtn = el("div", { cls: "card action", text: "REMATCH" });
  const selectBtn = el("div", { cls: "card action", text: "CHARACTER SELECT" });
  const menuBtn = el("div", { cls: "card action", text: "MENU" });
  menu.append(rematchBtn, selectBtn, menuBtn);

  function wire(c?: SceneCtx): void {
    if (c === undefined) return;
    rematchBtn.addEventListener("click", () => c.goto("battle", setup && rematchSetup(setup)));
    selectBtn.addEventListener("click", () => c.goto("select", setup));
    menuBtn.addEventListener("click", () => c.goto("title"));
  }

  return {
    root,
    enter(c) {
      ctx = ctx ?? c;
      const arg = c?.gotoArg as { setup: MatchSetup; outcome: MatchOutcome } | undefined;
      if (arg !== undefined) {
        setup = arg.setup;
        const winner = arg.outcome.winnerTeam;
        banner.textContent = winner === "draw" ? "DRAW" : `${winner.toUpperCase()} WINS`;
        banner.style.color = winner === "draw" ? "#fff" : TEAM_COLORS[winner];
        standings.replaceChildren(
          ...[...arg.outcome.kd]
            .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
            .map((row) =>
              el("div", {
                cls: "kd-row",
                text: `#${row.slot + 1} ${row.charId}${row.isHuman ? "" : " (CPU)"} — ${row.kills}K / ${row.deaths}D`,
              }),
            ),
        );
        wire(ctx);
      }
      if (root.children.length === 0) {
        root.appendChild(banner);
        root.appendChild(standings);
        root.appendChild(menu);
      }
      // Keyboard shortcuts mirror the three buttons (P1 attack/defend/jump).
      disposeKeys = onMenuKeys(globalThis.document, [0], (_slot, action) => {
        if (action === "attack") rematchBtn.dispatchEvent(new Event("click"));
        else if (action === "jump") selectBtn.dispatchEvent(new Event("click"));
        else if (action === "defend") menuBtn.dispatchEvent(new Event("click"));
      });
    },
    exit() {
      disposeKeys?.();
      disposeKeys = null;
    },
    update() {},
  };
}
