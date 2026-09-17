import type { RaceEvent, RaceEventType, RaceState, Rider } from "./types";
import { COMBAT, HUD } from "../config";

// OWNER: Agent B. Crash / knockdown state machine. Contract per .plan.md §5
// and §6. Do not change signatures. NOTE: this module must not import
// combat.ts (combat imports crash).

/** Tumble spin rate in rad/s while a rider slides on the tarmac. */
const DOWN_SPIN_RATE = 9;
/** HP rivals always remount with (plan §6; the player keeps their own hp). */
const RIVAL_REMOUNT_HP = 60;

function pushToast(state: RaceState, text: string, big = false): void {
  state.toasts.push({ text, t: HUD.toastTime, big });
}

function causeToast(cause: "traffic" | "offroad" | "combat" | "wobble"): string {
  if (cause === "traffic") return "TRAFFIC!";
  if (cause === "offroad") return "WIPEOUT!";
  return "KNOCKED OUT!"; // combat / wobble
}

/**
 * Put a rider on the tarmac: zero speed, start the tumble timer, add spin,
 * emit "crash"/"knockdown". If the victim is the player at hp <= 0 the race
 * ends wrecked (phase "wrecked" + results via race.ts's computeResults —
 * here just set phase + push a "wrecked" event; results are finalized by
 * stepRaceFlow on the next tick).
 */
export function startCrash(
  state: RaceState,
  victim: Rider,
  cause: "traffic" | "offroad" | "combat" | "wobble",
): void {
  victim.speed = 0;
  victim.downT = COMBAT.downTime;
  victim.downSpin = 0;
  victim.attackT = 0;
  victim.wobble = 0;
  victim.invulnT = 0;

  if (victim.kind === "player") {
    state.events.push({ type: "crash", z: victim.z, x: victim.x });
    pushToast(state, causeToast(cause), true);
    if (victim.hp <= 0) {
      state.phase = "wrecked";
      const wrecked: RaceEvent = {
        type: "wrecked",
        z: victim.z,
        x: victim.x,
        big: true,
      };
      state.events.push(wrecked);
      pushToast(state, "WRECKED!", true);
    }
    return;
  }

  // Rival/cop victims: knocked DOWN when fists or wobble did it, else crashed.
  const eventType: RaceEventType =
    cause === "combat" || cause === "wobble" ? "knockdown" : "crash";
  state.events.push({ type: eventType, z: victim.z, x: victim.x });
}

/** Step every downed rider: tumble friction, timer, remount + invuln. */
export function stepDowned(state: RaceState, dt: number): void {
  const riders: Rider[] = [state.player, ...state.rivals];
  for (const r of riders) {
    if (r.downT <= 0) continue;
    r.downSpin += dt * DOWN_SPIN_RATE;
    r.downT -= dt;
    if (r.downT > 0) continue;

    // Remount.
    r.downT = 0;
    r.downSpin = 0;
    r.speed = 0;
    r.invulnT = COMBAT.remountInvuln;
    if (r.kind !== "player") r.hp = RIVAL_REMOUNT_HP;
    state.events.push({ type: "remount", z: r.z, x: r.x });
  }
}

/** True once the tumble timer is running for this rider. */
export function isDowned(r: Rider): boolean {
  return r.downT > 0;
}
