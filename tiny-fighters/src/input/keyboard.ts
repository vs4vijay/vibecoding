// src/input/keyboard.ts — P1–P4 default keymaps and the poll-based keyboard source.
// DOM-free: the event target is injected, so Bun tests drive it with fakes.
import type { InputFrame } from "../sim/types";

/** Semantic action a physical key maps to. */
export type Action = "attack" | "jump" | "defend" | "up" | "down" | "left" | "right";

/** event.code string → action. Key identity is layout-independent physical position. */
export type Keymap = Record<string, Action>;

/** Anything that can receive key events; injectable so tests never touch window. */
export interface EventTargetLike {
  addEventListener(type: string, fn: (event: unknown) => void): void;
  /** Optional so minimal test fakes stay valid; real DOM targets have it. */
  removeEventListener?(type: string, fn: (event: unknown) => void): void;
}

/** A per-slot controller: one InputFrame per poll(); edges computed internally against the previous poll. */
export interface Source {
  poll(): InputFrame;
}

export function neutralFrame(): InputFrame {
  return { a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } };
}

/**
 * Collapse held-level signals into edge semantics for a/j (rising edge only),
 * leaving dHeld and dir as levels — matching InputBuffer's expectations.
 */
export function collapseEdges(
  prev: InputFrame,
  aHeld: boolean,
  jHeld: boolean,
  dHeld: boolean,
  x: -1 | 0 | 1,
  z: -1 | 0 | 1,
): InputFrame {
  return { a: aHeld && !prev.a, j: jHeld && !prev.j, dHeld, dir: { x, z } };
}

/**
 * Spec §4 table, verbatim. Key identity = KeyboardEvent.code strings.
 * P3 shares `,`/`/` with P1 by default; resolveKeymaps applies the documented
 * fallback when both are human.
 */
export const DEFAULT_KEYMAPS: Keymap[] = [
  {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    Comma: "attack", Period: "jump", Slash: "defend",
  },
  {
    KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
    KeyF: "attack", KeyG: "jump", KeyH: "defend",
  },
  {
    KeyI: "up", KeyK: "down", KeyJ: "left", KeyL: "right",
    Semicolon: "attack", Comma: "jump", Slash: "defend",
  },
  {
    Numpad8: "up", Numpad5: "down", Numpad4: "left", Numpad6: "right",
    Numpad0: "attack", NumpadDecimal: "jump", NumpadAdd: "defend",
  },
];

/**
 * Per-keyboard join rule: P3's `,`/`/` collide with P1's attack/defend, so when
 * P1 AND P3 are both human, P3 falls back to Jump `'` (Quote) / Defend Enter.
 */
export function resolveKeymaps(humanSlots: number[]): Keymap[] {
  const maps = DEFAULT_KEYMAPS.map((m) => ({ ...m }));
  if (humanSlots.includes(0) && humanSlots.includes(2)) {
    delete maps[2]!.Comma;
    delete maps[2]!.Slash;
    maps[2]!.Quote = "jump";
    maps[2]!.Enter = "defend";
  }
  return maps;
}

/**
 * Poll-based keyboard source. Held keys live in a set updated by keydown/keyup;
 * poll() derives the frame fresh each tick, so opposing directions cancel and
 * attack/jump fire only on the poll that first observes the press.
 *
 * Note: taps fully contained between two polls are invisible (standard
 * poll-model trade-off; the sim samples per tick anyway).
 */
export function createKeyboardSource(target: EventTargetLike, map: Keymap): Source {
  const down = new Set<string>();
  target.addEventListener("keydown", (e) => {
    const code = (e as KeyboardEvent).code;
    if (typeof code === "string") down.add(code);
  });
  target.addEventListener("keyup", (e) => {
    const code = (e as KeyboardEvent).code;
    if (typeof code === "string") down.delete(code);
  });
  // Alt-tab / focus loss would otherwise leave keys stuck down forever.
  target.addEventListener("blur", () => down.clear());

  let prev = neutralFrame();
  return {
    poll(): InputFrame {
      let left = 0, right = 0, up = 0, dn = 0;
      let aHeld = false, jHeld = false, dHeld = false;
      for (const code of down) {
        const action = map[code];
        switch (action) {
          case "left": left++; break;
          case "right": right++; break;
          case "up": up++; break;
          case "down": dn++; break;
          case "attack": aHeld = true; break;
          case "jump": jHeld = true; break;
          case "defend": dHeld = true; break;
          default: break; // unmapped code (menu key, modifiers, …)
        }
      }
      const x = Math.min(1, Math.max(-1, right - left)) as -1 | 0 | 1;
      const z = Math.min(1, Math.max(-1, dn - up)) as -1 | 0 | 1;
      const cur = collapseEdges(prev, aHeld, jHeld, dHeld, x, z);
      prev = cur;
      return cur;
    },
  };
}
