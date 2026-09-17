// Shared pure-logic test fixtures. Deliberately independent of every
// implementation module (config/types/rng/math only) so each agent's tests
// can build race states without other agents' code being implemented yet.

import { BIKES, LEVELS, SIM } from "../src/config";
import { RNG } from "../src/core/rng";
import type {
  BikeSpec,
  LevelSpec,
  RaceConfig,
  RaceState,
  Rider,
  ProjPoint,
  Segment,
  TrackData,
} from "../src/sim/types";

function projPoint(y: number, z: number): ProjPoint {
  return {
    world: { x: 0, y, z },
    camera: { x: 0, y: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
  };
}

/** Flat, straight track with `segs` segments and rumble striping. */
export function makeStraightTrack(segs = 600): TrackData {
  const segments: Segment[] = [];
  for (let i = 0; i < segs; i++) {
    const dark = Math.floor(i / SIM.rumbleLength) % 2 === 1;
    segments.push({
      index: i,
      p1: projPoint(0, i * SIM.segmentLength),
      p2: projPoint(0, (i + 1) * SIM.segmentLength),
      curve: 0,
      colors: {
        road: dark ? "#56565e" : "#5e5e66",
        grass: dark ? "#2c8a3e" : "#37a34a",
        rumble: dark ? "#c9463a" : "#eceade",
        lane: null,
      },
      clip: 0,
    });
  }
  return { segments, scenery: new Map(), finishIndex: segs - 10 };
}

export function makeLevel(over: Partial<LevelSpec> = {}): LevelSpec {
  return { ...LEVELS[0]!, ...over };
}

export function makeBike(over: Partial<BikeSpec> = {}): BikeSpec {
  return { ...BIKES[0]!, ...over };
}

let riderSeq = 100;

export function makeRider(over: Partial<Rider> & { id?: number } = {}): Rider {
  riderSeq += 1;
  return {
    id: over.id ?? riderSeq,
    name: "TESTER",
    kind: "rival",
    color: "#e0b13e",
    accent: "#222",
    z: 5 * SIM.segmentLength,
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
    place: 0,
    ai: null,
    ...over,
  };
}

export interface MakeStateOpts {
  track?: TrackData;
  level?: Partial<LevelSpec>;
  bike?: Partial<BikeSpec>;
  rivals?: number;
  seed?: number;
}

/** Racing-phase state with a straight track, a player, and N flat rivals. */
export function makeState(opts: MakeStateOpts = {}): RaceState {
  const track = opts.track ?? makeStraightTrack();
  const level = makeLevel(opts.level);
  const bike = makeBike(opts.bike);
  const cfg: RaceConfig = {
    levelIdx: 0,
    level,
    bike,
    seed: opts.seed ?? 42,
  };
  const rng = new RNG(cfg.seed);
  const rivals: Rider[] = [];
  const n = opts.rivals ?? 3;
  for (let i = 0; i < n; i++) {
    rivals.push(
      makeRider({
        id: i + 2,
        name: `RIVAL${i}`,
        z: 4 * SIM.segmentLength - i * SIM.segmentLength * 0.5,
        x: i % 2 === 0 ? -0.4 : 0.4,
        ai: {
          skill: 0.5,
          aggression: 0.3,
          targetX: 0,
          decisionT: 0,
          attackT: 1,
          mode: "race",
        },
      }),
    );
  }
  const player = makeRider({
    id: 1,
    name: "PLAYER",
    kind: "player",
    color: bike.color,
    accent: bike.accent,
    z: 2 * SIM.segmentLength,
  });
  return {
    cfg,
    rng: new RNG(cfg.seed),
    track,
    phase: "racing",
    time: 0,
    countdown: 0,
    player,
    rivals,
    traffic: [],
    totalRacers: rivals.length + 1,
    bustPressure: 0,
    events: [],
    toasts: [],
    results: null,
    nextId: 1000,
  };
}

/** Pop all pending events (mirrors world.drainEvents). */
export function drain(state: RaceState) {
  const out = state.events;
  state.events = [];
  return out;
}
