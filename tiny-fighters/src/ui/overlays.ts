// src/ui/overlays.ts — transient overlay builders: Pause menu and the key
// remap capture screen (spec §4 Options, reachable from Title and Pause).
// Overlays ride SceneManager's overlay stack; they are never scenes.
import { el, PLAYER_COLORS } from "./kit";
import { createMapper, BINDINGS_KEY } from "../input/mapper";
import type { Action } from "../input/keyboard";
import type { EventTargetLike } from "../input/keyboard";

const ACTIONS: readonly Action[] = ["attack", "jump", "defend", "up", "down", "left", "right"];

function storage(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/** Pause overlay: Resume / Remap / Quit. Freezes nothing itself — the battle
 * scene gates its tick on the overlay being open. */
export function buildPauseOverlay(handlers: {
  onResume(): void;
  onRemap(): void;
  onQuit(): void;
}): HTMLElement {
  const root = el("div", { cls: "overlay pause" });
  root.appendChild(el("div", { cls: "panel-title", text: "PAUSED" }));
  root.appendChild(el("div", { cls: "card action", text: "RESUME", onClick: handlers.onResume }));
  root.appendChild(el("div", { cls: "card action", text: "REMAP", onClick: handlers.onRemap }));
  root.appendChild(el("div", { cls: "card action", text: "QUIT TO MENU", onClick: handlers.onQuit }));
  return root;
}

/**
 * Remap capture overlay: pick a player, then an action; the next keydown
 * binds. Duplicate codes across players are flagged inline (mapper rule) and
 * NOT persisted. Close discards nothing — successful binds persist immediately
 * under tiny.bindings.v1.
 */
export function buildRemapOverlay(handlers: { onClose(): void }): HTMLElement {
  const root = el("div", { cls: "overlay remap" });
  const mapper = createMapper({ humanSlots: [0, 1, 2, 3] });
  const store = storage();
  if (store !== undefined) mapper.loadBindings(store);

  const status = el("div", { cls: "hint", text: "Pick player, then action; press a key to bind." });
  let selectedSlot = 0;

  const playerRow = el("div", { cls: "menu-row" });
  const playerBtns = PLAYER_COLORS.map((color, i) => {
    const btn = el("div", {
      cls: "card action",
      text: `P${i + 1}`,
      onClick: () => {
        selectedSlot = i;
        paint();
      },
    });
    playerRow.appendChild(btn);
    return btn;
  });

  const actionRow = el("div", { cls: "menu-row" });
  let pendingAction: Action | null = null;
  const capture = (ev: Event): void => {
    const code = (ev as KeyboardEvent).code;
    if (typeof code !== "string" || code === "Escape") return;
    ev.preventDefault();
    if (pendingAction === null) return;
    const dups = mapper.duplicateErrors();
    status.textContent = `P${selectedSlot + 1} ${pendingAction} ← ${code}` +
      (dups.length > 0 ? ` ⚠ ${dups.join("; ")}` : "");
    pendingAction = null;
    paint();
    if (store !== undefined) mapper.persistBindings(store);
  };

  for (const action of ACTIONS) {
    actionRow.appendChild(
      el("div", {
        cls: "card action",
        text: action.toUpperCase(),
        onClick: () => {
          pendingAction = action;
          status.textContent = `Press a key for P${selectedSlot + 1} ${action}…`;
        },
      }),
    );
  }

  function paint(): void {
    for (const [i, btn] of playerBtns.entries()) {
      btn.classList.toggle("selected", i === selectedSlot);
      btn.style.borderColor = PLAYER_COLORS[i] ?? "#fff";
    }
    const bound = mapper.bindings()[selectedSlot];
    status.textContent =
      `P${selectedSlot + 1}: ` +
      ACTIONS.map((a) => `${a}=${bound?.[a] ?? "-"}`).join(" ");
  }

  const closeBtn = el("div", { cls: "card action", text: "CLOSE", onClick: () => {
    globalThis.document.removeEventListener("keydown", capture);
    handlers.onClose();
  } });

  root.append(playerRow, actionRow, status, closeBtn);
  globalThis.document.addEventListener("keydown", capture);
  void BINDINGS_KEY;
  return root;
}

/** Keydown disposer helper shared by battle-scene global keys. */
export function onDocumentKeys(target: EventTargetLike, fn: (ev: KeyboardEvent) => void): () => void {
  const listener = (ev: unknown): void => fn(ev as KeyboardEvent);
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener?.("keydown", listener);
}
