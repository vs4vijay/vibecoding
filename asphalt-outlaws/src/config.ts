import type { BikeSpec, LevelSpec, Palette } from "./sim/types";

// ---------------------------------------------------------------------------
// Every gameplay tunable lives here (GAMES.md rule: no magic numbers elsewhere).
// ---------------------------------------------------------------------------

export const VIEW = {
  width: 1280,
  height: 720,
} as const;

export const SIM = {
  step: 1 / 60,
  segmentLength: 200,
  rumbleLength: 3, // segments per rumble stripe
  lanes: 3,
  drawDistance: 110, // segments rendered ahead
  fov: 100, // degrees
  cameraHeight: 1000,
  roadWidth: 2100, // road half-width in world units
} as const;

/** One segment per tick. */
export const MAX_SPEED = SIM.segmentLength / SIM.step;

export const PLAYER = {
  accelMul: 0.38, // fraction of max speed gained per second
  brakeMul: 1.3, // fraction lost per second while braking
  coastMul: 0.14, // natural decel fraction per second
  offRoadDecelMul: 0.95,
  offRoadLimitMul: 0.25, // speed cap fraction off-road
  steerRate: 2.1, // lateral x-units per second at full lock
  steerSpeedFalloff: 0.35, // steering authority multiplier at top speed
  centrifugal: 0.34, // push-out factor scaled by segment curve
  xClamp: 2.35, // lateral clamp in road-half-width fractions
  hpRegen: 2, // hp per second
  regenDelay: 4, // seconds clean before regen kicks in
} as const;

export const COMBAT = {
  rangeZ: 300, // longitudinal strike reach (world units)
  minSideGap: 0.14, // alongside threshold in x fractions
  maxSideGap: 0.95, // too far to connect
  punchDamage: 22,
  kickDamage: 34,
  punchWobble: 0.45,
  kickWobble: 0.6,
  swingTime: 0.32, // attack animation seconds
  impactAt: 0.4, // fraction of swing when damage lands
  cooldown: 0.55,
  knockdownSpeedFrac: 0.4, // victim above this speed fraction + wobble >= 1 goes down
  downTime: 2.4, // seconds on the tarmac
  remountInvuln: 2.0,
  wobbleDecay: 0.45, // wobble lost per second
  copBustSpeedFrac: 0.3, // player below this speed while a cop is alongside...
  copBustTime: 1.5, // ...for this many cumulative seconds => busted
} as const;

export const RIVAL = {
  hp: 100,
  speedFracMin: 0.62, // slowest rival cruise (fraction of max)
  speedFracMax: 0.93, // fastest rival cruise at skill 1
  rubberbandAhead: 0.965, // speed mul when rival is far ahead of player
  rubberbandBehind: 1.06, // speed mul when rival is far behind
  rubberbandRange: 26000, // world units where rubber-banding kicks in
  attackGapMin: 2.2, // seconds between attack attempts (scaled by aggression)
  attackGapMax: 6.5,
  copHuntBoost: 1.04, // cops push slightly harder than their skill
  retirePenalty: 0.85, // speed mul after a rival remounts from a knockdown
} as const;

export const TRAFFIC = {
  sameSpeedMin: 0.2, // fraction of max speed
  sameSpeedMax: 0.45,
  oncomingSpeed: 0.52,
  aheadSegments: 240, // keep traffic spawned this far ahead of the player
  behindSegments: 20, // recycle once this far behind
  hitZ: 340, // collision half-depth in world units
  hitX: 0.26, // collision half-width in x fractions
  nearMissZ: 520, // near-miss event distance
} as const;

export const HUD = {
  mphDivisor: 63, // speed / 63 => mph (~190 at top speed)
  toastTime: 2.2,
  countdownTime: 3.999,
} as const;

export const ECONOMY = {
  startMoney: 500,
  retryFee: 200, // cost to retry a failed race
} as const;

export const BIKES: BikeSpec[] = [
  {
    id: "sidewinder",
    name: "SIDEWINDER 600",
    blurb: "Balanced streetfighter. Forgiving, quick on its feet.",
    topSpeedMul: 1.0,
    accelMul: 1.0,
    brakeMul: 1.0,
    steerMul: 1.0,
    weight: 1.0,
    color: "#ff5b2e",
    accent: "#ffd23c",
  },
  {
    id: "banshee",
    name: "BANSHEE 1100",
    blurb: "A literal rocket. Twitchy when the fists start flying.",
    topSpeedMul: 1.12,
    accelMul: 1.08,
    brakeMul: 0.92,
    steerMul: 0.88,
    weight: 0.8,
    color: "#3ec6ff",
    accent: "#e8f6ff",
  },
  {
    id: "warthog",
    name: "WARTHOG 900",
    blurb: "Brute cruiser. Shrugs off hits, hugs the corners.",
    topSpeedMul: 0.94,
    accelMul: 0.92,
    brakeMul: 1.1,
    steerMul: 1.12,
    weight: 1.35,
    color: "#71d98b",
    accent: "#14231a",
  },
];

const pacificPalette: Palette = {
  skyTop: "#2e8fe0",
  skyBottom: "#bfe7ff",
  haze: "#dff3ff",
  grassLight: "#37a34a",
  grassDark: "#2c8a3e",
  roadLight: "#6d6d78",
  roadDark: "#65656f",
  rumbleLight: "#eceade",
  rumbleDark: "#c9463a",
  lane: "#f4f1e6",
  backdrop: "#2c6e63",
  water: "#1f6fae",
  sun: "#fff3b0",
};

const dustPalette: Palette = {
  skyTop: "#4fa8e0",
  skyBottom: "#ffd9a0",
  haze: "#ffe6bf",
  grassLight: "#d8a45c",
  grassDark: "#c8934c",
  roadLight: "#75706a",
  roadDark: "#6c6762",
  rumbleLight: "#efe6d2",
  rumbleDark: "#b3542f",
  lane: "#f6ecd6",
  backdrop: "#a4552e",
  sun: "#fff0c2",
};

const sunsetPalette: Palette = {
  skyTop: "#2b1a5e",
  skyBottom: "#ff7043",
  haze: "#ffb26b",
  grassLight: "#24402e",
  grassDark: "#1c3325",
  roadLight: "#565460",
  roadDark: "#4e4c58",
  rumbleLight: "#e8e2d0",
  rumbleDark: "#b23a30",
  lane: "#efeadb",
  backdrop: "#14102b",
  cityGlow: "#ffcf6b",
};

const canyonPalette: Palette = {
  skyTop: "#0a0a1e",
  skyBottom: "#26264d",
  haze: "#3a3a66",
  grassLight: "#2e2338",
  grassDark: "#251c2e",
  roadLight: "#4c4a56",
  roadDark: "#454350",
  rumbleLight: "#cfc9bd",
  rumbleDark: "#9c352d",
  lane: "#d8d4c6",
  backdrop: "#16121f",
  night: true,
};

const frostPalette: Palette = {
  skyTop: "#8fa8bf",
  skyBottom: "#dbe7f0",
  haze: "#e8f1f7",
  grassLight: "#e8eef2",
  grassDark: "#d9e3ea",
  roadLight: "#5a5f66",
  roadDark: "#53585f",
  rumbleLight: "#e8e6df",
  rumbleDark: "#d94f3d",
  lane: "#f2f0e8",
  backdrop: "#b8c9d6",
};

export const LEVELS: LevelSpec[] = [
  {
    id: "pacific-run",
    name: "PACIFIC RUN",
    blurb: "Sun, palms, easy money. Watch the tourists.",
    lengthSegs: 4000,
    curves: 0.35,
    hills: 0.4,
    trafficDensity: 2.0, // cars per 100 segments
    oncomingShare: 0.15,
    rivalCount: 7,
    copCount: 0,
    rivalSkill: 0.55,
    rivalAggression: 0.25,
    qualifyPlace: 5,
    prize: 1500,
    palette: pacificPalette,
    weather: "clear",
    fog: 1.0,
    maxSpeedMul: 1.0,
  },
  {
    id: "dust-devils",
    name: "DUST DEVILS",
    blurb: "Desert heat, rolling dunes, grit in your teeth.",
    lengthSegs: 4600,
    curves: 0.5,
    hills: 0.65,
    trafficDensity: 2.6,
    oncomingShare: 0.25,
    rivalCount: 7,
    copCount: 0,
    rivalSkill: 0.65,
    rivalAggression: 0.35,
    qualifyPlace: 4,
    prize: 3000,
    palette: dustPalette,
    weather: "clear",
    fog: 1.1,
    maxSpeedMul: 1.02,
  },
  {
    id: "sunset-strip",
    name: "SUNSET STRIP",
    blurb: "Neon boulevard at dusk. The heat is ON — literally.",
    lengthSegs: 5200,
    curves: 0.45,
    hills: 0.25,
    trafficDensity: 3.4,
    oncomingShare: 0.3,
    rivalCount: 7,
    copCount: 2,
    rivalSkill: 0.72,
    rivalAggression: 0.5,
    qualifyPlace: 3,
    prize: 5000,
    palette: sunsetPalette,
    weather: "clear",
    fog: 1.15,
    maxSpeedMul: 1.04,
  },
  {
    id: "canyon-rush",
    name: "CANYON RUSH",
    blurb: "Moonlit switchbacks with zero guardrails.",
    lengthSegs: 5800,
    curves: 0.85,
    hills: 0.6,
    trafficDensity: 3.0,
    oncomingShare: 0.25,
    rivalCount: 7,
    copCount: 2,
    rivalSkill: 0.8,
    rivalAggression: 0.6,
    qualifyPlace: 3,
    prize: 8000,
    palette: canyonPalette,
    weather: "clear",
    fog: 1.25,
    maxSpeedMul: 1.06,
  },
  {
    id: "frostbite-pass",
    name: "FROSTBITE PASS",
    blurb: "Snow, fog, fortune. The final run for the crown.",
    lengthSegs: 6500,
    curves: 0.7,
    hills: 0.8,
    trafficDensity: 4.0,
    oncomingShare: 0.35,
    rivalCount: 7,
    copCount: 2,
    rivalSkill: 0.88,
    rivalAggression: 0.7,
    qualifyPlace: 2,
    prize: 12000,
    palette: frostPalette,
    weather: "snow",
    fog: 1.6,
    maxSpeedMul: 1.08,
  },
];

export const RIVAL_NAMES = [
  "HAWK",
  "JINX",
  "AXLE",
  "SABLE",
  "REX",
  "MOJO",
  "TANK",
  "VIPER",
  "CINDER",
  "DUKE",
] as const;

export const RIVAL_COLORS = [
  "#e0b13e",
  "#8f5be0",
  "#3ec6ff",
  "#e05585",
  "#71d98b",
  "#e07b3e",
  "#b8bfcc",
  "#d9cf4e",
] as const;
