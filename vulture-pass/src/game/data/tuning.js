// Feel + balance constants (D6). Everything a tuning pass would touch lives
// here, never inline in systems.

export const driving = {
  brakeAccel: 30, // reverse-ish decel input
  reverseFactor: 0.4, // max reverse accel vs forward
  drag: 0.35, // forward velocity decay per second (coast)
  lateralBase: 22, // lateral bleed per second at low grip values
  steerSpeedScale: 8, // speed at which steering reaches full rate
  steerParkScale: 0.25, // steering authority at standstill
  driftSteerBoost: 1.25, // extra yaw authority while sliding
  wallBounce: 0.25, // velocity kept into a wall after push-out
  carPush: 0.5, // fraction of overlap pushed onto each car (car-vs-car)
};

export const camera = {
  fov: 55,
  pitchDeg: 75, // camera angle above horizontal (D3)
  distance: 17, // horizontal distance behind the car
  height: 34, // vertical offset above the car
  lookAhead: 0.65, // seconds of velocity to bias the look target
  lookAheadMax: 14,
  followLerp: 6.5, // per-second smoothing of the follow point
  aimUnprojectHeight: 0, // ground plane y for mouse aim
};

export const combat = {
  simHz: 60,
  arenaSize: 150, // half-extent walls at ±arenaSize/… see arena builder
  roadHalfWidth: 7,
  // ambush scaling (spec: strength scales with cargo value)
  ambushBaseChance: 0.42,
  ambushChancePerValue: 0.00028, // +chance per $ cargo value
  ambushChanceCap: 0.8,
  budgetBase: 3,
  budgetPerValue: 1 / 130, // +budget per $ cargo value
  budgetCap: 12,
  budgetPerDay: 1 / 7, // slow creep as days pass
  budgetDayCap: 3,
  maxEnemies: 8,
  xpToNextBase: 35,
  xpToNextPerLevel: 15,
  fieldRepairShare: 0.16, // per field-repair point: share of max HP healed after a win
  reloadBonusPerPoint: 0.12, // reload time reduced 12% per point (multiplicative)
  // upgrades
  sightWarnLevel: 1, // map sight level that reveals ambush warnings
  sightPriceLevel: 2, // map sight level that reveals distant town prices
};

export const economy = {
  driftRange: 0.1, // ±10% daily seeded price drift
  repairFeeRate: 0.0022, // repair cost per missing HP point relative to car price… (fee = damage * rate * price)
  insurancePrice: 180,
  defeatMoneyLoss: 0.25, // fraction of money lost on uninsured defeat
  respawnHealthFrac: 0.2,
  startingMoney: 400,
  jobRefreshDays: 3,
  travelMarkerSeconds: 1.1,
};

export const tuning = { driving, camera, combat, economy };
export default tuning;
