// src/input/gamepad.ts — standard-mapping gamepad source.
// DOM-free: the pad snapshot reader is injected (or defaulted to
// navigator.getGamepads when available), so Bun tests run headless.
import type { InputFrame } from "../sim/types";
import { collapseEdges, neutralFrame, type Source } from "./keyboard";

/** Structural subset of the W3C Gamepad API used here (also accepts terse fixtures). */
export interface GamepadSnapshot {
  axes?: ReadonlyArray<number>;
  buttons?: ReadonlyArray<{ pressed?: boolean; value?: number }>;
}

/** Live pads change between polls; a static snapshot is only useful in tests. */
export type SnapshotProvider = () => GamepadSnapshot | null | undefined;

const DEAD_ZONE = 0.5;

function buttonDown(b?: { pressed?: boolean; value?: number }): boolean {
  if (b === undefined) return false;
  if (b.pressed === true) return true;
  return b.value !== undefined && b.value >= DEAD_ZONE;
}

function axisToDir(v: number | undefined): -1 | 0 | 1 {
  if (v === undefined || !Number.isFinite(v)) return 0;
  if (v > DEAD_ZONE) return 1;
  if (v < -DEAD_ZONE) return -1;
  return 0;
}

export function systemSnapshot(index: number): GamepadSnapshot | null | undefined {
  const nav = globalThis.navigator;
  if (
    typeof nav === "object" && nav !== null && "getGamepads" in nav &&
    typeof nav.getGamepads === "function"
  ) {
    return nav.getGamepads()[index];  // headless / unsupported envs never reach this
  }
  return undefined;
}

/**
 * Standard-mapping source for gamepad `index`:
 *   axes[0]/dpad buttons 12–15 → dir (buttons 12↑ 13↓ 14← 15→)
 *   button 2 (X) → attack · button 0 (A) → jump · button 1 (B) → defend
 *
 * `snapshot` is a test seam: pass a fixed GamepadSnapshot (brief fixtures) or a
 * provider closure; omit it in production to read navigator.getGamepads().
 * Like the keyboard source, a/j are rising edges computed against the previous
 * poll; dHeld and dir are levels.
 */
export function createGamepadSource(
  index: number,
  snapshot?: GamepadSnapshot | SnapshotProvider,
): Source {
  const read: SnapshotProvider =
    typeof snapshot === "function"
      ? snapshot
      : snapshot !== undefined
        ? () => snapshot
        : () => systemSnapshot(index);

  let prev = neutralFrame();
  return {
    poll(): InputFrame {
      const pad = read();
      if (pad === null || pad === undefined) {
        prev = neutralFrame();
        return prev;
      }
      const btn = (i: number) => buttonDown(pad.buttons?.[i]);
      const axisX = axisToDir(pad.axes?.[0]);
      const dx = Math.min(1, Math.max(-1, axisX + (btn(15) ? 1 : 0) - (btn(14) ? 1 : 0))) as -1 | 0 | 1;
      const dz = Math.min(1, Math.max(-1, (btn(13) ? 1 : 0) - (btn(12) ? 1 : 0))) as -1 | 0 | 1;
      const cur = collapseEdges(prev, btn(2), btn(0), btn(1), dx, dz);
      prev = cur;
      return cur;
    },
  };
}

/** Standard-mapping attack button (X), mirrored by src/input/pad-join.ts. */
export const PAD_ATTACK_BUTTON = 2;

/** Number of currently connected pads (nulls in getGamepads() skipped). */
export function countSystemPads(): number {
  const nav = globalThis.navigator;
  if (
    typeof nav === "object" && nav !== null && "getGamepads" in nav &&
    typeof nav.getGamepads === "function"
  ) {
    return (nav.getGamepads() as Array<GamepadSnapshot | null>).filter((p) => p != null).length;
  }
  return 0;
}
