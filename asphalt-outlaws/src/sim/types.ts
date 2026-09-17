// Shared simulation types — the contract between sim, render, ui and audio.
// Types only: this file must never import from config.ts or any module that
// does (keeps it circular-import free). Value constants live in config.ts.

import type { RNG } from "../core/rng";

export type Side = "left" | "right";

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** A track point in world space plus its cached camera/screen projection. */
export interface ProjPoint {
  world: P3;
  camera: { x: number; y: number };
  screen: { x: number; y: number; w: number; scale: number };
}

export interface RoadColors {
  road: string;
  grass: string;
  rumble: string;
  lane: string | null;
}

export interface Segment {
  index: number;
  p1: ProjPoint;
  p2: ProjPoint;
  curve: number;
  colors: RoadColors;
  clip: number;
}

export type SceneryKind =
  | "palm"
  | "pine"
  | "cactus"
  | "rock"
  | "bush"
  | "sign"
  | "billboard"
  | "lamp"
  | "city";

export interface SceneryItem {
  kind: SceneryKind;
  /** Lateral position in road-half-width fractions (negative = left side). */
  offset: number;
  scale: number;
  flip: boolean;
}

export interface TrackData {
  segments: Segment[];
  /** Segment index -> roadside items. */
  scenery: Map<number, SceneryItem[]>;
  /** Segment index of the finish line. */
  finishIndex: number;
}

export interface Palette {
  skyTop: string;
  skyBottom: string;
  haze: string;
  grassLight: string;
  grassDark: string;
  roadLight: string;
  roadDark: string;
  rumbleLight: string;
  rumbleDark: string;
  lane: string;
  backdrop: string;
  water?: string;
  sun?: string;
  cityGlow?: string;
  night?: boolean;
}

export interface LevelSpec {
  id: string;
  name: string;
  blurb: string;
  lengthSegs: number;
  /** 0..1 — how twisty. */
  curves: number;
  /** 0..1 — how hilly. */
  hills: number;
  /** Average cars per 100 segments. */
  trafficDensity: number;
  /** 0..1 — fraction of traffic that is oncoming. */
  oncomingShare: number;
  rivalCount: number;
  copCount: number;
  /** 0..1 rival pace. */
  rivalSkill: number;
  /** 0..1 attack frequency. */
  rivalAggression: number;
  /** Best place that still advances the career. */
  qualifyPlace: number;
  prize: number;
  palette: Palette;
  weather: "clear" | "snow";
  /** Fog density multiplier. */
  fog: number;
  maxSpeedMul: number;
}

export interface BikeSpec {
  id: string;
  name: string;
  blurb: string;
  topSpeedMul: number;
  accelMul: number;
  brakeMul: number;
  steerMul: number;
  /** Resistance to wobble from hits. */
  weight: number;
  color: string;
  accent: string;
}

export type RiderKind = "player" | "rival" | "cop";

export interface RiderAI {
  skill: number;
  aggression: number;
  targetX: number;
  /** Seconds until the next line decision. */
  decisionT: number;
  /** Seconds until the next attack attempt. */
  attackT: number;
  mode: "race" | "hunt" | "bust";
}

export interface Rider {
  id: number;
  name: string;
  kind: RiderKind;
  color: string;
  accent: string;
  /** Track position in world units. */
  z: number;
  /** Lateral offset in road-half-width fractions (0 = center). */
  x: number;
  speed: number;
  hp: number;
  /** 0..1+ instability from hits — reaches 1 at speed => knockdown. */
  wobble: number;
  /** Visual lean, -1..1. */
  lean: number;
  /** Current steering input, -1..1. */
  steer: number;
  offRoad: boolean;
  /** Remount invulnerability remaining. */
  invulnT: number;
  /** >0 while knocked down (tumble timer). */
  downT: number;
  /** Tumble rotation accumulator for the down animation. */
  downSpin: number;
  /** >0 while an attack swing animates. */
  attackT: number;
  attackSide: Side;
  attackKind: "punch" | "kick" | null;
  /** Impact of the current swing already resolved. */
  attackHitDone: boolean;
  /** Cooldown before the next swing. */
  attackCd: number;
  /** Hit flash remaining. */
  hitFlashT: number;
  /** Seconds since this rider last gave or took combat (drives HP regen). */
  cleanT: number;
  finished: boolean;
  finishTime: number | null;
  /** 1-based rank; 0 while on the grid. */
  place: number;
  ai: RiderAI | null;
}

export type TrafficKind = "car" | "truck" | "bus";

export interface TrafficCar {
  id: number;
  kind: TrafficKind;
  /** 1 = same direction as the race, -1 = oncoming. */
  dir: 1 | -1;
  z: number;
  x: number;
  speed: number;
  color: string;
  active: boolean;
}

export type RacePhase =
  | "countdown"
  | "racing"
  | "finished"
  | "busted"
  | "wrecked";

export type RaceEventType =
  | "swing"
  | "hit-given"
  | "hit-taken"
  | "knockdown"
  | "crash"
  | "traffic-hit"
  | "near-miss"
  | "countdown-beep"
  | "go"
  | "finish"
  | "busted"
  | "wrecked"
  | "remount"
  | "cop-alert";

export interface RaceEvent {
  type: RaceEventType;
  z: number;
  x?: number;
  side?: Side;
  text?: string;
  big?: boolean;
}

export interface Toast {
  text: string;
  t: number;
  big: boolean;
}

export interface Results {
  place: number;
  totalRacers: number;
  time: number;
  prize: number;
  qualified: boolean;
  ending: "finished" | "busted" | "wrecked";
  levelIdx: number;
}

export interface RaceConfig {
  levelIdx: number;
  level: LevelSpec;
  bike: BikeSpec;
  seed: number;
}

export interface RaceState {
  cfg: RaceConfig;
  /** The single seeded randomness stream for this race. */
  rng: RNG;
  track: TrackData;
  phase: RacePhase;
  /** Race clock in seconds, frozen at 0 until GO. */
  time: number;
  /** Countdown remaining before GO. */
  countdown: number;
  player: Rider;
  rivals: Rider[];
  traffic: TrafficCar[];
  totalRacers: number;
  /** 0..1+ — cumulative slow-speed-while-cop-alongside pressure. */
  bustPressure: number;
  /** Sim pushes, view/audio drains. */
  events: RaceEvent[];
  toasts: Toast[];
  results: Results | null;
  nextId: number;
}
