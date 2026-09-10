// src/ui/flow.ts — the match-configuration handoff carried between scenes,
// plus the pure rules for turning select-screen state into SlotConfigs.
import type { SlotConfig, Team } from "../sim/types";
import { CHAR_IDS } from "./kit";

export type GameMode = "ffa" | "teams";

/** One character-select cell: joined = human-controlled, otherwise CPU. */
export interface SelectSlot {
  joined: boolean;
  charId: string;
  team: Team;
}

export const TEAM_CYCLE: readonly Team[] = ["independent", "red", "blue"];

/** 8 empty slots; archetype i defaults to roster order so bots are varied. */
export function freshSlots(): SelectSlot[] {
  return Array.from({ length: 8 }, (_, i) => ({
    joined: false,
    charId: CHAR_IDS[i % CHAR_IDS.length]!,
    team: "independent",
  }));
}

export function cycleTeam(team: Team): Team {
  const i = TEAM_CYCLE.indexOf(team);
  return TEAM_CYCLE[(i + 1) % TEAM_CYCLE.length]!;
}

/**
 * Final configs for spawnMatch, slot order preserved — built BY the battle
 * scene at spawn time (brief: "battle builds SlotConfig[]"). FFA forces every
 * fighter independent. In teams mode humans keep their cycled team
 * (Independent plays as its own side); bots are dealt to red/blue balancing
 * the human counts, ties go red.
 */
export function buildSlotConfigs(
  slots: readonly SelectSlot[],
  mode: GameMode,
): SlotConfig[] {
  return slots.map((slot, i): SlotConfig => {
    if (mode === "ffa") return { isHuman: slot.joined, charId: slot.charId, team: "independent" };
    const team = slot.joined ? slot.team : dealBotTeam(slots, i);
    return { isHuman: slot.joined, charId: slot.charId, team };
  });
}

function dealBotTeam(slots: readonly SelectSlot[], botIndex: number): Team {
  let reds = 0, blues = 0;
  for (let i = 0; i < botIndex; i++) {
    const s = slots[i]!;
    if (s.team === "red") reds++;
    else if (s.team === "blue") blues++;
  }
  return blues < reds ? "blue" : "red";
}

/** Everything mode→select→stage-select accumulate and battle consumes. */
export interface MatchSetup {
  mode: GameMode;
  /** Live join state; battle converts this to SlotConfig[]. */
  selectSlots: SelectSlot[];
  /** Human slot indices (drives router/keymap wiring). */
  humans: number[];
  /** Human slot → physical gamepad index (absent = keyboard only). */
  padsBySlot: Partial<Record<number, number>>;
  stageId: string;
  seed: number;
}

/** Rematch rule: deterministic seed increment, everything else identical. */
export function rematchSetup(prev: MatchSetup): MatchSetup {
  return { ...prev, seed: prev.seed + 1 };
}

/** UI-side default seed (spec: Date.now()%1e9 is fine OUTSIDE the sim). */
export function uiSeed(): number {
  return Date.now() % 1e9;
}
