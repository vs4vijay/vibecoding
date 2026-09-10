// src/ui/kit.ts — DOM-overlay building blocks shared by all scenes.
// Menu navigation keys are per-player keymaps (spec §4 table): P1's Attack is
// Comma etc., so every scene listens on the document and resolves codes through
// the resolved keymap set.
import { DEFAULT_KEYMAPS } from "../input/keyboard";
import type { Action, EventTargetLike, Keymap } from "../input/keyboard";

export const CHAR_IDS = [
  "brawler", "swordsman", "fire-caster", "ice-caster", "ninja", "support-mage",
] as const;

export const TEAM_ORDER: readonly Team[] = ["independent", "red", "blue"];
type Team = import("../sim/types").Team;

export const TEAM_COLORS: Record<Team, string> = {
  independent: "#9AA0A6",
  red: "#E23B3B",
  blue: "#4A6FE3",
};

export const PLAYER_COLORS = ["#FFD24A", "#7BD66F", "#5AB4E8", "#F28CB1"] as const;

/**
 * Document-level keydown listener → per-slot semantic actions.
 * Returns the disposer; scenes register one and remove it on exit.
 */
export function onMenuKeys(
  target: EventTargetLike,
  humanSlots: number[],
  handler: (slot: number, action: Action) => void,
): () => void {
  const maps: Keymap[] = DEFAULT_KEYMAPS.map((m) => ({ ...m }));
  // P3 fallback mirrors resolveKeymaps so menus work identically in battle.
  if (humanSlots.includes(0) && humanSlots.includes(2)) {
    delete maps[2]!.Comma;
    delete maps[2]!.Slash;
    maps[2]!.Quote = "jump";
    maps[2]!.Enter = "defend";
  }
  const byCode = new Map<string, { slot: number; action: Action }>();
  for (const slot of humanSlots) {
    const map = maps[slot];
    if (map === undefined) continue;
    for (const [code, action] of Object.entries(map)) {
      // Duplicate codes across slots keep the FIRST claimant — P3's `,` stays
      // P1's attack until the resolveKeymaps fallback applies.
      if (!byCode.has(code)) byCode.set(code, { slot, action });
    }
  }
  const fn = (ev: unknown): void => {
    const code = (ev as KeyboardEvent).code;
    if (typeof code !== "string") return;
    const hit = byCode.get(code);
    if (hit === undefined) return;
    handler(hit.slot, hit.action);
  };
  target.addEventListener("keydown", fn);
  return () => target.removeEventListener?.("keydown", fn);
}

export interface ElOpts {
  cls?: string;
  text?: string;
  html?: string;
  onClick?: () => void;
}

/** Create an element with optional class/text/html/click handler. */
export function el(tag: string, opts: ElOpts = {}): HTMLElement {
  const e = globalThis.document.createElement(tag);
  if (opts.cls !== undefined) e.className = opts.cls;
  if (opts.text !== undefined) e.textContent = opts.text;
  if (opts.html !== undefined) e.innerHTML = opts.html;
  e.addEventListener("click", () => opts.onClick?.());
  return e;
}

/** Panel with heading + content column; returns root and body refs. */
export function panel(title: string, subtitle?: string): { root: HTMLElement; body: HTMLElement } {
  const root = el("div", { cls: "panel" });
  const h = el("div", { cls: "panel-title", text: title });
  root.appendChild(h);
  if (subtitle !== undefined) root.appendChild(el("div", { cls: "panel-sub", text: subtitle }));
  const body = el("div", { cls: "panel-body" });
  root.appendChild(body);
  return { root, body };
}
