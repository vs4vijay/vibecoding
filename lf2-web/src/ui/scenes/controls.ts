// src/ui/scenes/controls.ts — Controls reference (per-player keymaps + gamepad
// mapping, REMAP opens the capture overlay) and the About panel. Both pop back
// to title on Defend/Esc; the pop is suppressed while an overlay (remap
// capture) is open so binding capture keys can't navigate away.
import { el, onMenuKeys } from "../kit";
import { DEFAULT_KEYMAPS } from "../../input/keyboard";
import { buildRemapOverlay } from "../overlays";
import type { Scene, SceneCtx } from "../scene-manager";

const ACTION_LABELS: Record<string, string> = {
  attack: "Attack", jump: "Jump", defend: "Defend",
  up: "Up", down: "Down", left: "Left", right: "Right",
};

/** Shared behavior: Defend or Esc pops the scene, unless an overlay is open. */
function popOnBack(ctxRef: { ctx?: SceneCtx }, register: (fn: () => void) => void): void {
  const back = (): void => {
    const ctx = ctxRef.ctx;
    if (ctx === undefined || ctx.sm.overlayOpen) return;
    ctx.sm.pop();
  };
  const keys = onMenuKeys(globalThis.document, [0], (_slot, action) => {
    if (action === "defend") back();
  });
  const onEsc = (ev: Event): void => {
    if ((ev as KeyboardEvent).code === "Escape") back();
  };
  globalThis.document.addEventListener("keydown", onEsc);
  register(() => {
    keys();
    globalThis.document.removeEventListener("keydown", onEsc);
  });
}

export function createControlsScene(): Scene {
  const root = el("div", { cls: "scene controls" });
  const ctxRef: { ctx?: SceneCtx } = {};
  let dispose: (() => void) | null = null;

  const table = el("div", { cls: "controls-table" });
  DEFAULT_KEYMAPS.forEach((map, slot) => {
    const row = el("div", { cls: "controls-row" });
    row.appendChild(el("div", { cls: "controls-player", text: `P${slot + 1}` }));
    const binds = Object.entries(map)
      .map(([code, action]) => `${code} = ${ACTION_LABELS[action] ?? action}`)
      .join(" · ");
    row.appendChild(el("div", { cls: "controls-binds", text: binds }));
    table.appendChild(row);
  });
  table.appendChild(el("div", {
    cls: "hint",
    text: "Gamepad (standard mapping): X = Attack · A = Jump · B = Defend · left stick / dpad = move. Press Attack on a pad in Character Select to join.",
  }));

  const remapBtn = el("div", { cls: "card action", text: "REMAP KEYS" });
  remapBtn.addEventListener("click", () => {
    const ctx = ctxRef.ctx;
    if (ctx === undefined) return;
    ctx.sm.overlay(buildRemapOverlay({ onClose: () => ctx.sm.closeOverlay() }));
  });

  return {
    root,
    enter(c) {
      if (c !== undefined) ctxRef.ctx = c;   // re-enter without ctx keeps the old one
      if (root.children.length === 0) {
        root.appendChild(el("div", { cls: "panel-title", text: "CONTROLS" }));
        root.appendChild(table);
        root.appendChild(remapBtn);
        root.appendChild(el("div", { cls: "hint", text: "Defend / Esc = back" }));
      }
      popOnBack(ctxRef, (fn) => { dispose = fn; });
    },
    exit() {
      dispose?.();
      dispose = null;
    },
    update() {},
  };
}

export function createAboutScene(): Scene {
  const root = el("div", { cls: "scene about" });
  const ctxRef: { ctx?: SceneCtx } = {};
  let dispose: (() => void) | null = null;

  const body = el("div", { cls: "controls-binds", text:
    "A web remake of Little Fighter 2's VS mode: 6 original archetypes, 2 stages, " +
    "up to 4 local humans plus CPU bots (max 8 fighters). The simulation is fully " +
    "deterministic — every match is driven by JSON character sheets at a fixed 60 Hz, " +
    "seeded PRNG, and replayable hash-for-hash. All art and audio are CC0." });

  return {
    root,
    enter(c) {
      if (c !== undefined) ctxRef.ctx = c;   // re-enter without ctx keeps the old one
      if (root.children.length === 0) {
        root.appendChild(el("div", { cls: "panel-title", text: "ABOUT" }));
        root.appendChild(body);
        root.appendChild(el("div", { cls: "hint", text: "Defend / Esc = back" }));
      }
      popOnBack(ctxRef, (fn) => { dispose = fn; });
    },
    exit() {
      dispose?.();
      dispose = null;
    },
    update() {},
  };
}
