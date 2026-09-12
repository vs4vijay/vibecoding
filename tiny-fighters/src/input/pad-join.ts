// src/input/pad-join.ts — "press Attack to join" detection for the select
// screen. Watches raw pad snapshots for rising attack edges; select assigns
// each newly-pressed pad to the next open human slot and records it in
// MatchSetup.padsBySlot, which battle's composite source consumes.
import { PAD_ATTACK_BUTTON, type SnapshotProvider } from "./gamepad";

const THRESHOLD = 0.5; // mirrors gamepad.ts DEAD_ZONE

export interface PadJoinWatcher {
  /** Pad indices whose attack button rose this poll (was up, now down). */
  poll(): number[];
}

export function createPadJoinWatcher(providers: readonly SnapshotProvider[]): PadJoinWatcher {
  let prev = providers.map(() => false);
  return {
    poll(): number[] {
      const fresh: number[] = [];
      providers.forEach((provider, i) => {
        const btn = provider()?.buttons?.[PAD_ATTACK_BUTTON];
        const pressed = btn?.pressed === true || (btn?.value ?? 0) >= THRESHOLD;
        if (pressed && !prev[i]) fresh.push(i);
        prev[i] = pressed;
      });
      return fresh;
    },
  };
}
