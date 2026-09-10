// src/input/composite.ts — one Source per slot merging every connected device.
// Keyboard is always live; each gamepad contributes its frame when any of its
// signals are active, so a resting pad never masks the keyboard (spec §4).
import type { InputFrame } from "../sim/types";
import { collapseEdges, neutralFrame, type Source } from "./keyboard";
import { createGamepadSource, type SnapshotProvider } from "./gamepad";

export interface CompositeSourceOptions {
  keyboard: Source;
  /** Physical pad indices (system snapshot) or test providers. */
  pads?: Array<number | SnapshotProvider>;
}

/**
 * Merge policy: dir/dHeld are OR-ed levels across devices; a/j edges OR the
 * raw held level of every device before ONE collapse against the merged
 * previous frame — a press seen by any device fires exactly one edge.
 */
export function createCompositeSource(opts: CompositeSourceOptions): Source {
  const padSources = (opts.pads ?? []).map((pad): Source =>
    createGamepadSource(typeof pad === "number" ? pad : 0, typeof pad === "number" ? undefined : pad));
  let prev = neutralFrame();
  return {
    poll(): InputFrame {
      const frames: InputFrame[] = [opts.keyboard.poll(), ...padSources.map((s) => s.poll())];
      // Direction: sum across devices then clamp — two devices pulling opposite
      // ways cancel, exactly like opposing keys on one keyboard.
      const rawX = frames.reduce((sum, f) => sum + f.dir.x, 0);
      const rawZ = frames.reduce((sum, f) => sum + f.dir.z, 0);
      const x = Math.max(-1, Math.min(1, rawX)) as -1 | 0 | 1;
      const z = Math.max(-1, Math.min(1, rawZ)) as -1 | 0 | 1;
      const dHeld = frames.some((f) => f.dHeld);
      const aHeld = frames.some((f) => f.a);
      const jHeld = frames.some((f) => f.j);
      // Devices already collapsed their own edges; OR-ing those edges can drop
      // simultaneous presses to one frame, so re-expand to held-levels first.
      const cur = collapseEdges(prev, aHeld, jHeld, dHeld, x as -1 | 0 | 1, z as -1 | 0 | 1);
      prev = cur;
      return cur;
    },
  };
}

