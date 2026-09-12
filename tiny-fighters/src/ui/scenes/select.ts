// src/ui/scenes/select.ts — 6-portrait grid, per-player join/team/confirm.
// Join = that player's Attack; cycle team Independent→Red→Blue on Defend;
// confirm with Jump. Duplicate picks allowed. Bots auto-fill the
// remaining 8-slot roster from cycling archetypes.
import { CHAR_IDS, PLAYER_COLORS, TEAM_COLORS, el, onMenuKeys } from "../kit";
import type { Scene, SceneCtx } from "../scene-manager";
import { cycleTeam, freshSlots, type MatchSetup, type SelectSlot } from "../flow";
import { createPadJoinWatcher, type PadJoinWatcher } from "../../input/pad-join";
import { systemSnapshot } from "../../input/gamepad";
import type { SnapshotProvider } from "../../input/gamepad";

const HUMAN_SLOTS = [0, 1, 2, 3];

export function createSelectScene(): Scene {
  const root = el("div", { cls: "scene select" });
  let ctx: SceneCtx | undefined;
  let disposeKeys: (() => void) | null = null;
  let setup: MatchSetup | null = null;
  let slots: SelectSlot[] = freshSlots();
  let watcher: PadJoinWatcher | null = null;
  let watcherPadCount = -1;

  const heading = el("div", { cls: "panel-title", text: "CHARACTER SELECT" });
  const grid = el("div", { cls: "char-grid" });
  const chipsRow = el("div", { cls: "chips" });
  const hint = el("div", {
    cls: "hint",
    text: "Attack join · Defend team · Jump confirm · duplicates OK",
  });

  const cells = CHAR_IDS.map((id) => {
    const cell = el("div", { cls: "char-cell", text: id });
    grid.appendChild(cell);
    return cell;
  });
  const chipEls = HUMAN_SLOTS.map((slot) => {
    const chip = el("span", { cls: "chip", text: `P${slot + 1}` });
    chipsRow.appendChild(chip);
    return chip;
  });

  function paint(): void {
    for (const [i, id] of CHAR_IDS.entries()) {
      const picks = slots.filter((s) => s.charId === id && s.joined);
      const cell = cells[i]!;
      cell.classList.toggle("picked", picks.length > 0);
      cell.dataset.pickedBy = picks.map((p) => `P${HUMAN_SLOTS[slots.indexOf(p)]! + 1}`).join(",");
    }
    for (const [i, slot] of slots.entries()) {
      const chipEl = chipEls[i];
      if (chipEl === undefined) continue;
      if (!slot.joined) {
        chipEl.style.display = "none";
        continue;
      }
      chipEl.style.display = "";
      chipEl.style.borderColor = PLAYER_COLORS[i] ?? "#fff";
      chipEl.style.color = TEAM_COLORS[slot.team];
      chipEl.textContent = `P${i + 1} · ${slot.charId} · ${slot.team}`;
    }
  }

  function handle(slot: number, action: string): void {
    const s = slots[slot];
    if (s === undefined) return;
    if (!s.joined) {
      if (action === "attack") s.joined = true;
      paint();
      return;
    }
    if (action === "defend") s.team = cycleTeam(s.team);
    else if (action === "jump") confirm();
    // Attack while joined toggles back out (un-join).
    else if (action === "attack") {
      s.joined = false;
      if (setup !== null) delete setup.padsBySlot[slot];
    }
    paint();
  }
  function confirm(): void {
    if (ctx === undefined || setup === null) return;
    // Battle builds SlotConfig[] itself; we hand over the live join state.
    setup.selectSlots = slots.map((s) => ({ ...s }));
    ctx.goto("stage-select", setup);
  }

  /**
   * Watcher span = raw getGamepads() length, NOT the connected-pad count:
   * the array is sparse (null holes for disconnected indices), so providers
   * stay positional and the watcher reports true pad indices even when index
   * 0 is absent (pad 1 must not silently become unreachable).
   */
  function padSpan(): number {
    const nav = globalThis.navigator;
    if (
      typeof nav === "object" && nav !== null && "getGamepads" in nav &&
      typeof nav.getGamepads === "function"
    ) {
      return nav.getGamepads().length;
    }
    return 0;
  }

  function ensureWatcher(): void {
    const count = padSpan();
    if (count === watcherPadCount) return;
    watcherPadCount = count;
    watcher = createPadJoinWatcher(
      Array.from({ length: count }, (_, i): SnapshotProvider => () => systemSnapshot(i)),
    );
  }

  /** First open human slot (not yet joined) takes the pad. */
  function joinPad(padIndex: number): void {
    if (setup === null) return;
    if (Object.values(setup.padsBySlot).includes(padIndex)) return; // pad already owns a slot
    const slot = HUMAN_SLOTS.find((s) => !slots[s]!.joined);
    if (slot === undefined) return;
    slots[slot]!.joined = true;
    setup.padsBySlot[slot] = padIndex;
    paint();
  }

  return {
    root,
    enter(c) {
      ctx = c ?? ctx;
      const arg = c?.gotoArg as MatchSetup | undefined;
      if (arg !== undefined) {
        setup = arg;
        slots = freshSlots(); // fresh join state on every arrival
        // Pad claims are join state too: a rematch handing back the SAME setup
        // object must not leave stale padsBySlot entries — joinPad's
        // includes-check would refuse a pad that joined the previous match.
        arg.padsBySlot = {};
      }
      if (root.children.length === 0) {
        root.appendChild(heading);
        root.appendChild(grid);
        root.appendChild(chipsRow);
        root.appendChild(hint);
      }
      paint();
      ensureWatcher();
      disposeKeys = onMenuKeys(globalThis.document, HUMAN_SLOTS, handle);
    },
    exit() {
      disposeKeys?.();
      disposeKeys = null;
    },
    update() {
      ensureWatcher();
      if (watcher === null) return;
      for (const pad of watcher.poll()) joinPad(pad);
    },
  };
}
