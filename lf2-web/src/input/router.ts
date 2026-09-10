// src/input/router.ts — fans controller sources out to sim slots 0..MAX_FIGHTERS-1.
// Slots without a human source (empty, bot, or out of range) yield NEUTRAL so
// stepWorld always receives exactly MAX_FIGHTERS frames per tick.
import { MAX_FIGHTERS } from "../sim/constants";
import type { InputFrame } from "../sim/types";
import { neutralFrame, type Source } from "./keyboard";

export interface RoutedSource {
  /** Sim fighter slot, 0-based. */
  slot: number;
  /** Human controller, or "bot" (kept explicit for roster bookkeeping). */
  source: Source | "bot";
}

/**
 * One router per match. Sources are polled exactly once per router.poll(),
 * in slot order; a duplicate slot keeps the LAST registered source.
 */
export function createRouter(sources: RoutedSource[]): { poll(): InputFrame[] } {
  const bySlot = new Map<number, Source>();
  for (const routed of sources) {
    if (routed.slot < 0 || routed.slot >= MAX_FIGHTERS || !Number.isInteger(routed.slot)) {
      throw new RangeError(`router: slot ${routed.slot} outside 0..${MAX_FIGHTERS - 1}`);
    }
    if (routed.source !== "bot") bySlot.set(routed.slot, routed.source);
  }
  return {
    poll(): InputFrame[] {
      const frames: InputFrame[] = new Array(MAX_FIGHTERS);
      for (let slot = 0; slot < MAX_FIGHTERS; slot++) {
        const source = bySlot.get(slot);
        frames[slot] = source !== undefined ? source.poll() : neutralFrame();
      }
      return frames;
    },
  };
}
