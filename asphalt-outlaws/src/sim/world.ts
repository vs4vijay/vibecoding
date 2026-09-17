import type { RaceConfig, RaceEvent, RaceState } from "./types";
import type { InputState } from "../core/input";
import { SIM } from "../config";
import { createRace, stepRaceFlow, updatePlaces } from "./race";
import { stepPlayer } from "./bike";
import { stepRivals } from "./rider-ai";
import { checkTrafficHit, stepTraffic } from "./traffic";
import { resolveCombat, tryAttack } from "./combat";
import { isDowned, startCrash, stepDowned } from "./crash";

// Sim composition root: one fixed SIM.step tick, in the order the module
// owners' contracts require (see agent integration notes in .plan.md §4).

export function createWorld(cfg: RaceConfig): RaceState {
  return createRace(cfg);
}

export function stepWorld(state: RaceState, input: InputState): void {
  const dt = SIM.step;

  // Flow first: advances the clock / countdown, detects finish crossings
  // from last tick's positions, finalizes busted/wrecked results, ranks.
  stepRaceFlow(state, dt);

  if (state.phase === "racing") {
    stepPlayer(state, input, dt);

    // Attack sides: side is the ATTACKER's position relative to the target.
    // "attack left" (J) targets a rider on the player's left => player is
    // to the target's right.
    if (input.attackL) tryAttack(state, state.player, "right");
    if (input.attackR) tryAttack(state, state.player, "left");

    stepRivals(state, dt);
    stepTraffic(state, dt);

    const p = state.player;
    if (!isDowned(p) && p.invulnT <= 0) {
      const car = checkTrafficHit(state, p);
      if (car) {
        startCrash(state, p, "traffic");
        state.events.push({ type: "traffic-hit", z: p.z, x: p.x });
      }
    }

    resolveCombat(state, dt);
  }

  // Downed riders tumble/remount in every phase (finishing while tumbling
  // still plays out on the results frame).
  stepDowned(state, dt);

  for (const t of state.toasts) t.t -= dt;
  state.toasts = state.toasts.filter((t) => t.t > 0);

  updatePlaces(state);
}

/** Take and clear pending events (view/audio consume these). */
export function drainEvents(state: RaceState): RaceEvent[] {
  const out = state.events;
  state.events = [];
  return out;
}
