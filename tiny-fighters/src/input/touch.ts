// src/input/touch.ts — on-screen gamepad source for touch devices (P1 only).
// DOM-free like the keyboard source: the pad UI (or tests) drives the held
// set via press/release, poll() derives frames with the same edge semantics
// as createKeyboardSource so touch feeds the composite merge unchanged.
import { collapseEdges, neutralFrame, type Source } from "./keyboard";
import type { InputFrame } from "../sim/types";

export type TouchAction = "left" | "right" | "up" | "down" | "attack" | "jump" | "defend";

export interface TouchSource extends Source {
  press(action: TouchAction): void;
  release(action: TouchAction): void;
  clear(): void;
}

export function createTouchSource(): TouchSource {
  const down = new Set<TouchAction>();
  let prev = neutralFrame();
  return {
    press(action: TouchAction): void {
      down.add(action);
    },
    release(action: TouchAction): void {
      down.delete(action);
    },
    clear(): void {
      down.clear();
      prev = neutralFrame();
    },
    poll(): InputFrame {
      let left = 0, right = 0, up = 0, dn = 0;
      let aHeld = false, jHeld = false, dHeld = false;
      for (const action of down) {
        switch (action) {
          case "left": left++; break;
          case "right": right++; break;
          case "up": up++; break;
          case "down": dn++; break;
          case "attack": aHeld = true; break;
          case "jump": jHeld = true; break;
          case "defend": dHeld = true; break;
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

/** True when the device reports touch points — the battle scene mounts the
 * on-screen pad only then, so desktop stays clean. */
export function hasTouch(): boolean {
  const g = globalThis as { navigator?: { maxTouchPoints?: number } };
  return (g.navigator?.maxTouchPoints ?? 0) > 0;
}
