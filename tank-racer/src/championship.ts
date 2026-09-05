// Phase 15: championship series data model.
//
// Pure data + localStorage persistence — no DOM, no game state, so the points
// math and resume logic stay testable in isolation. game.ts owns the flow
// (when races happen); this module owns what a championship IS. The only
// cross-module import is the data-only track roster, which defines the
// series length (one race per circuit).

import { TRACK_DEFS } from "./track";

/** Points by finishing position: 1st=10, 2nd=7, 3rd=5, 4th=3 (spec). */
export const CHAMP_POINTS = [10, 7, 5, 3];

export const CHAMP_FORMAT_VERSION = 1;

/** One entrant across the whole series (humans keep their slot identity). */
export interface ChampEntrant {
  /** Stable id: "p1" | "p2" | "ai0" | "ai1" | "ai2" (grid-slot based). */
  id: string;
  name: string;
  /** CSS color for table swatches. */
  color: string;
  isPlayer: boolean;
  isPlayerTwo?: boolean;
  points: number;
  /** Total race time per completed race; null = did not finish that race. */
  times: (number | null)[];
  wins: number;
}

export interface ChampState {
  v: number;
  /** 0-based index of the NEXT race to run (=== track count when complete). */
  raceIndex: number;
  twoPlayer: boolean;
  entrants: ChampEntrant[];
}

/**
 * Tie-break time used for a race a racer did not finish — strictly worse than
 * any real total, so DNFs lose time tie-breaks without NaN leaking around.
 */
const DNF_TIME_PENALTY = 9999;

/**
 * Series-total time for one entrant with DNFs penalized. Summing only finished
 * races would REWARD a DNF (fewer seconds on the clock), so each missing race
 * adds a penalty larger than any realistic total.
 */
export function effectiveTotal(e: ChampEntrant): number {
  let sum = 0;
  let missing = 0;
  for (const t of e.times) {
    if (t === null) missing++;
    else sum += t;
  }
  return sum + missing * DNF_TIME_PENALTY;
}

/** Raw sum of finished race totals (null when nothing was ever finished). */
export function totalTimeOf(e: ChampEntrant): number | null {
  let sum: number | null = null;
  for (const t of e.times) {
    if (t !== null) sum = (sum ?? 0) + t;
  }
  return sum;
}

/**
 * Standings order: points desc → effective total time asc → wins desc.
 * Array.prototype.sort is stable, so full ties keep grid order.
 */
export function sortStandings(entrants: ChampEntrant[]): ChampEntrant[] {
  return entrants.slice().sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const ta = effectiveTotal(a);
    const tb = effectiveTotal(b);
    if (ta !== tb) return ta - tb;
    return b.wins - a.wins;
  });
}

// --- Persistence -------------------------------------------------------------
// Stored after every completed race so an accidental refresh mid-series
// resumes at the right race. Cleared on completion or abandonment.

const CHAMP_STORAGE_KEY = "tankracer.champ";

export function loadChamp(): ChampState | null {
  try {
    const raw = localStorage.getItem(CHAMP_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ChampState>;
    if (
      typeof p.raceIndex !== "number" ||
      !Number.isInteger(p.raceIndex) ||
      p.raceIndex < 0 ||
      p.raceIndex > TRACK_DEFS.length || // all races done, podium not yet seen
      typeof p.twoPlayer !== "boolean" ||
      !Array.isArray(p.entrants) ||
      p.entrants.length !== 4
    ) {
      return null;
    }
    const entrants: ChampEntrant[] = [];
    for (const e of p.entrants) {
      if (
        typeof e?.id !== "string" ||
        typeof e?.name !== "string" ||
        typeof e?.color !== "string" ||
        typeof e?.isPlayer !== "boolean" ||
        typeof e?.points !== "number" ||
        !Number.isFinite(e.points) ||
        !Array.isArray(e.times) ||
        e.times.length !== p.raceIndex ||
        e.times.some((t) => t !== null && typeof t !== "number") ||
        typeof e?.wins !== "number"
      ) {
        return null;
      }
      entrants.push({
        ...e,
        points: e.points,
        wins: e.wins,
        times: e.times.slice(),
      });
    }
    return { v: CHAMP_FORMAT_VERSION, raceIndex: p.raceIndex, twoPlayer: p.twoPlayer, entrants };
  } catch {
    return null;
  }
}

export function storeChamp(state: ChampState): void {
  try {
    localStorage.setItem(CHAMP_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode etc. — the series just won't survive a refresh */
  }
}

export function clearChamp(): void {
  try {
    localStorage.removeItem(CHAMP_STORAGE_KEY);
  } catch {
    /* nothing to clean up */
  }
}
