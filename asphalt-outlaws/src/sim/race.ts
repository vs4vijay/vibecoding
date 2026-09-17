import type { RaceConfig, RaceState, Results } from "./types";
import { HUD, SIM } from "../config";
import { RNG } from "../core/rng";
import { buildTrack } from "./track";
import { spawnRivals } from "./rider-ai";
import { spawnTraffic } from "./traffic";

// OWNER: Agent C. Race lifecycle: create, ranks, flow, results. Contract per
// .plan.md §5 and §6. Do not change signatures.

/** Build a ready-to-race state: track via buildTrack, spawns, countdown. */
export function createRace(cfg: RaceConfig): RaceState {
  // One RNG drives the whole race; buildTrack and the spawns interleave draws
  // in a fixed call order, which is what makes runs reproducible.
  const rng = new RNG(cfg.seed);
  const state: RaceState = {
    cfg,
    rng,
    track: buildTrack(cfg.level, rng),
    phase: "countdown",
    time: 0,
    countdown: HUD.countdownTime,
    player: {
      id: 1,
      name: "YOU",
      kind: "player",
      color: cfg.bike.color,
      accent: cfg.bike.accent,
      z: 2 * SIM.segmentLength,
      x: 0,
      speed: 0,
      hp: 100,
      wobble: 0,
      lean: 0,
      steer: 0,
      offRoad: false,
      invulnT: 0,
      downT: 0,
      downSpin: 0,
      attackT: 0,
      attackSide: "left",
      attackKind: null,
      attackHitDone: true,
      attackCd: 0,
      hitFlashT: 0,
      cleanT: 99,
      finished: false,
      finishTime: null,
      place: 1,
      ai: null,
    },
    rivals: [],
    traffic: [],
    totalRacers: 1,
    bustPressure: 0,
    events: [],
    toasts: [],
    results: null,
    nextId: 2,
  };
  spawnRivals(state);
  spawnTraffic(state);
  updatePlaces(state);
  return state;
}

/** Rank every rider by progress (finished riders keep finish order). */
export function updatePlaces(state: RaceState): void {
  const sorted = [state.player, ...state.rivals].sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.finishTime ?? 0) - (b.finishTime ?? 0);
    }
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.z - a.z;
  });
  sorted.forEach((rider, i) => {
    rider.place = i + 1;
  });
}

/** Countdown ticking: beep on each whole-second ceil crossing of 3/2/1. */
function stepCountdown(state: RaceState, dt: number): void {
  const prev = Math.ceil(state.countdown);
  state.countdown = Math.max(0, state.countdown - dt);
  const now = Math.ceil(state.countdown);
  for (let c = now; c < prev; c++) {
    if (c >= 1 && c <= 3) {
      state.events.push({ type: "countdown-beep", z: state.player.z });
    }
  }
  if (state.countdown <= 0) {
    state.phase = "racing";
    state.events.push({ type: "go", z: state.player.z });
    state.toasts.push({ text: "GO!", t: HUD.toastTime, big: true });
  }
}

/** Flag finish-line crossings; the player's crossing ends the race. */
function stepFinishCrossings(state: RaceState): void {
  const finishZ = state.track.finishIndex * SIM.segmentLength;

  for (const rival of state.rivals) {
    if (!rival.finished && rival.z >= finishZ) {
      rival.finished = true;
      rival.finishTime = state.time;
    }
  }

  const player = state.player;
  if (!player.finished && player.z >= finishZ) {
    player.finished = true;
    player.finishTime = state.time;
    state.phase = "finished";
    // Rank before recording results so results.place is the final standing.
    updatePlaces(state);
    state.events.push({ type: "finish", z: player.z, x: player.x, big: true });
    state.toasts.push({ text: "FINISHED!", t: HUD.toastTime, big: true });
    state.results = computeResults(state, "finished");
  }
}

/**
 * Countdown ticking + beeps -> "go", race clock, finish-line crossing
 * (player + rivals), busted/wrecked finalization, results via computeResults.
 */
export function stepRaceFlow(state: RaceState, dt: number): void {
  switch (state.phase) {
    case "countdown":
      stepCountdown(state, dt);
      break;
    case "racing":
      state.time += dt;
      stepFinishCrossings(state);
      break;
    case "busted":
    case "wrecked":
      // Phase set asynchronously by combat/crash; finalize exactly once.
      if (state.results === null) {
        state.results = computeResults(state, state.phase);
      }
      break;
    case "finished":
      // Clock frozen; results were locked in at the line.
      break;
  }
  updatePlaces(state);
}

/** Build results for the current ending (prize + qualify per level spec). */
export function computeResults(
  state: RaceState,
  ending: Results["ending"],
): Results {
  const level = state.cfg.level;
  const place = state.player.place;
  const qualified = place <= level.qualifyPlace;
  const prize = qualified ? level.prize : Math.floor(level.prize * 0.25);
  return {
    place,
    totalRacers: state.totalRacers,
    time: state.time,
    prize,
    qualified,
    ending,
    levelIdx: state.cfg.levelIdx,
  };
}
