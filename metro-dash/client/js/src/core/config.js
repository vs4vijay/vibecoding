/**
 * @file core/config.js
 * Central tunables for the entire engine. Every gameplay/visual constant
 * lives here so later waves can retune without hunting through modules.
 */

/** Gameplay constants (units: metres, seconds, m/s). */
export const CONFIG = {
  // Lanes
  LANE_COUNT: 3,
  LANE_WIDTH: 2.2,

  // Speed ramp (ramped over distance travelled)
  BASE_SPEED: 16,
  MAX_SPEED: 42,
  SPEED_RAMP_PER_METER: 0.022, // linear ramp: base + distance * ramp (clamped)

  // Player physics
  GRAVITY: -38,
  JUMP_VELOCITY: 12.2,
  COYOTE_TIME: 0.08, // s of still-allowed jump after leaving ground
  INPUT_BUFFER: 0.12, // s an action stays queued
  ROLL_DURATION: 0.62,
  ROLL_HEIGHT: 0.95, // hitbox height while rolling
  STAND_HEIGHT: 1.8,
  PLAYER_HALF_WIDTH: 0.36, // forgiving hitbox (~15% under 0.85 visual width)
  PLAYER_HALF_DEPTH: 0.3,
  HITBOX_SHRINK: 0.15, // obstacles are shrunk by this fraction on the sim side

  // Scoring
  COIN_SCORE: 10,
  MAX_MULTIPLIER: 10,

  // Camera (cinematic chase)
  FOV_BASE: 65,
  FOV_MAX: 72,
  CAMERA_HEIGHT: 4.35,
  CAMERA_DISTANCE: 6.3,
  CAMERA_LOOK_HEIGHT: 1.75,
  CAMERA_LOOK_AHEAD: 8,

  // Fixed timestep simulation
  FIXED_DT: 1 / 60,
  MAX_FRAME_DT: 0.1, // clamp huge frames (tab switch)

  // Slow-mo on death
  DEATH_SLOWMO_SCALE: 0.3,
  DEATH_SLOWMO_TIME: 0.8,

  // Wave-2 world dressing. Geometry constraints that QA cameras depend on:
  //  - building band inner face >= 13.5 (the ?cam=side rig flies at |x| ~13.2)
  //  - nothing crossing the play corridor (|x| < 3.3) below 4.5 m
  //  - bridges clear the corridor at 7.2 m (camera rigs peak at ~6.9 m)
  WORLD: {
    // Buildings
    BUILDING_FLOOR_H: 3.0, // instance heights are floor-quantized (facade alignment)
    BUILDING_INNER_FACE: 13.5,
    BUILDING_TILE_BAYS: 4, // facade texture holds 4 bays x 4 floors per tile
    BUILDING_TILE_FLOORS: 4,
    // Chunk variety plan (cycle length 20 chunk indexes)
    STATION_PERIOD: 5, // every 5th chunk (m % 5 === 4)
    BRIDGE_PERIOD: 4, // every ~4th chunk (m % 4 === 2), skipped on station slots
    BRIDGE_CLEARANCE: 7.2, // deck underside; side rig tops out at ~6.9 m
    // Catenary / corridor furniture
    CATENARY_SPAN: 20, // m between pole assemblies
    WIRE_HEIGHT: 4.72, // contact wire; mid-span sag dips to ~4.58 (> 4.5 floor)
    BEAM_HEIGHT: 6.35, // cross truss; above every camera rig's apex
    POSTER_SLOT: 40, // m between wall-poster/billboard slots
  },
};

/**
 * Quality presets. `tier` order matters for auto step-down: ultra > high >
 * medium > low. Index 0 = low.
 */
export const QUALITY_ORDER = ["low", "medium", "high", "ultra"];

export const QUALITY_PRESETS = {
  low: {
    pixelRatioCap: 1,
    shadowMapSize: 1024,
    shadowsEnabled: true,
    postEnabled: false,
    bloom: false,
    grade: false,
    smaa: false,
    msaaSamples: 2,
    drawDistance: 140,
    fogNear: 45,
    fogFar: 140,
    particleBudget: 0.25,
    maxChunksAhead: 5,
  },
  medium: {
    pixelRatioCap: 1.25,
    shadowMapSize: 1024,
    shadowsEnabled: true,
    postEnabled: true,
    bloom: false,
    grade: true,
    smaa: false,
    msaaSamples: 4,
    drawDistance: 180,
    fogNear: 55,
    fogFar: 170,
    particleBudget: 0.5,
    maxChunksAhead: 6,
  },
  high: {
    pixelRatioCap: 1.5,
    shadowMapSize: 2048,
    shadowsEnabled: true,
    postEnabled: true,
    bloom: true,
    grade: true,
    smaa: true,
    msaaSamples: 4,
    drawDistance: 240,
    fogNear: 85,
    fogFar: 215,
    particleBudget: 1,
    maxChunksAhead: 7,
  },
  ultra: {
    pixelRatioCap: 2,
    shadowMapSize: 2048,
    shadowsEnabled: true,
    postEnabled: true,
    bloom: true,
    grade: true,
    smaa: true,
    msaaSamples: 4,
    drawDistance: 300,
    fogNear: 80,
    fogFar: 250,
    particleBudget: 1.5,
    maxChunksAhead: 8,
  },
};

/**
 * Auto-detect a sensible default tier from devicePixelRatio + CPU cores.
 * @param {URLSearchParams} params URL params (?quality= overrides).
 * @returns {"low"|"medium"|"high"|"ultra"}
 */
export function detectQualityTier(params) {
  const forced = params && params.get("quality");
  if (forced && QUALITY_ORDER.includes(forced)) return forced;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cores =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  let tier;
  if (dpr >= 2 && cores >= 8) tier = "ultra";
  else if (cores >= 8 || (dpr >= 1.5 && cores >= 4)) tier = "high";
  else if (cores >= 4) tier = "medium";
  else tier = "low";
  return tier;
}

/**
 * Resolve a preset (with ?quality override already applied by detect).
 * @param {string} tier Tier name.
 * @returns {object} Preset object (do not mutate).
 */
export function getQualityPreset(tier) {
  return QUALITY_PRESETS[tier] || QUALITY_PRESETS.high;
}
