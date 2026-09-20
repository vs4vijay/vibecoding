export type ZombieSpec = {
  hp: number;
  weight: number;
  points: number;
  speed: number;
  leapRange: number;
};

export const CONFIG = {
  sim: { dt: 1 / 60, maxFrameDt: 0.1 },
  road: {
    halfWidth: 7,
    segmentLength: 30,
    visibleSegments: 6,
    lanes: [-5.6, -2.8, 0, 2.8, 5.6],
  },
  car: {
    width: 1.9,
    length: 4.4,
    halfWidth: 0.95,
    steerMaxSpeed: 10,
    steerAccel: 60,
    railBounceVx: 2,
    capacityPerSide: 4,
    flipWindowS: 1.2,
    tiltRate: 3,
    scrapeSpeedLoss: 3,
    scrapeTickS: 0.25,
    speedFloor: 12,
  },
  gun: {
    magSize: 8,
    reloadS: 1,
    fireIntervalS: 0.14,
    dmg: 1,
    recentLeapWindowS: 1.5,
    recentLeapMult: 2,
  },
  scrape: { dmgToClingers: 2 },
  zombies: {
    walker: { hp: 1, weight: 1, points: 25, speed: 6, leapRange: 9 },
    runner: { hp: 1, weight: 1, points: 50, speed: 11, leapRange: 13 },
    brute: { hp: 3, weight: 2, points: 150, speed: 4, leapRange: 7 },
  } as Record<"walker" | "runner" | "brute", ZombieSpec>,
  score: { streakTiers: [3, 6, 9], multipliers: [2, 3, 4], streakDecayS: 4 },
  difficulty: {
    baseReq: 400,
    exp: 1.35,
    unlockLevel: { walker: 1, runner: 2, brute: 3 },
  },
  spawn: { shoulderOffset: 1.2, zMinAhead: 70, zMaxAhead: 110 },
  world: {
    duskColor: 0x3d1f10,
    hemisphereIntensity: 0.95,
    sunIntensity: 1.35,
    rearFillIntensity: 0.45,
    roadAlbedo: 0x2b2b31,
    sandAlbedo: 0x5a4028,
    railAlbedo: 0x6a6a6a,
    fogColor: 0x3a2012,
    fogNear: 60,
    fogFar: 160,
  },
  camera: {
    fovBase: 62,
    fovBoost: 74,
    near: 0.1,
    far: 2000,
    offset: { x: 0.55, y: 4.2, z: 9 },
    lookAt: { x: 0.8, y: 1.2, z: -14 },
  },
  hud: { warnAt: 0.5, critAt: 0.75, popupCount: 6, popupLifeS: 1 },
  readability: { obstacleWarnDist: 45 },
};
