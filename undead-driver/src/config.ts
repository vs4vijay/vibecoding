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

  // ── aaa-visual-overhaul: every tunable below belongs to the new visual systems ──

  /** Cinematic dusk lighting mood (supersedes `world` light values as systems migrate). */
  look: {
    /** Shadow-casting key light (DirectionalLight). Elevation/azimuth in degrees. */
    sun: { elevationDeg: 14, azimuthDeg: 38, color: 0xffa15e, intensity: 16 },
    hemisphere: { skyColor: 0x4a3a6e, groundColor: 0x57351c, intensity: 2.1 },
    /** Low ambient floor so shadows keep detail (no crushed black). */
    ambient: { color: 0x31274d, intensity: 1.7 },
    fog: { color: 0x2c1810, near: 40, far: 170, density: 0.0075 },
    /** Gradual mood shift across level progression (task 2.3): deltas applied per level-up. */
    moodShift: {
      levelsSpan: 8,
      sunElevationDeltaDeg: -9,
      sunHueShiftDeg: 34,
      fogColorLate: 0x120a14,
      fogDensityScale: 1.8,
      lightIntensityScale: 0.9,
      /** Exponential damp rate (1/s) toward the level's target mood. */
      lerpRate: 0.8,
    },
    /** ACES exposure multiplier for the filmic pipeline. */
    exposure: 1.1,
    /** Real headlight SpotLights (one per side). */
    headlights: { color: 0xffe6b0, intensity: 70, range: 42, angleDeg: 20, penumbra: 0.45, decay: 1.6 },
    /** Visible additive beam fakes riding the headlight spots (task 2.2). */
    headBeam: { length: 7.5, opacity: 0.14 },
    /** Streetlamp fakes per D4: decal light pool + additive beam cone + head glow. */
    lampPool: {
      color: 0xffc873,
      poolRadius: 3.4,
      poolOpacity: 0.85,
      /** Pool ellipse stretch along the road (z) — decal is wider than deep. */
      poolStretchZ: 1.35,
      beamHeight: 5.6,
      beamRadiusTop: 0.18,
      beamRadiusBottom: 1.15,
      beamOpacity: 0.16,
      headGlowSize: 0.5,
      spacingZ: 30,
    },
    /** renderer.shadowMap (PCFSoft) tuning; extent = ortho frustum half-size following the car. */
    shadow: {
      mapSize: 2048,
      bias: -0.0006,
      normalBias: 0.02,
      radius: 3,
      extent: 30,
      cameraNear: 5,
      cameraFar: 90,
      /** Sun distance behind the frustum anchor (inside near..far at every mood elevation). */
      lightDistance: 40,
      /** 8-bit sRGB luma floor for the darkest road under the car ("Shadow detail retained"). */
      floorLuma8bit: 16,
    },
  },

  /**
   * Procedural texture factory. `scale` fields are noise cells across the tile
   * (not meters); seeds mix with masterSeed for the final PRNG seed.
   */
  textures: {
    defaultSize: 512,
    /** Boot-time generation wall-clock budget (ms) — dev hook logs overruns (task 1.3). */
    genBudgetMs: 250,
    /** Total boot texture VRAM pin from D10. */
    vramBudgetMb: 48,
    masterSeed: 1337,
    anisotropy: 8,
    /** Shared fBm shape; surfaces override via their own fields where needed. */
    noise: { octaves: 5, lacunarity: 1.92, gain: 0.55 },
    asphalt: {
      seed: 11,
      scale: 48,
      wearSeed: 12,
      wearScale: 6,
      wearAmount: 0.4,
      albedoLow: 0x23232a,
      albedoHigh: 0x43434d,
      roughBase: 0.88,
      roughVariance: 0.18,
      normalStrength: 1.4,
    },
    sand: { seed: 21, scale: 26, rippleStrength: 0.35, albedoLow: 0x4a3320, albedoHigh: 0x6b4c30, roughBase: 0.92, normalStrength: 0.8 },
    metal: {
      seed: 31,
      scale: 34,
      rustAmount: 0.55,
      burntSeed: 32,
      burntAmount: 0.35,
      albedoBase: 0x6a6a6a,
      rustColor: 0x7a4a26,
      burntColor: 0x1c1a18,
      roughBase: 0.55,
      normalStrength: 1.1,
    },
    zombieSkin: {
      scale: 18,
      normalStrength: 0.7,
      walker: { seed: 41, mottle: 0.5, tint: 0x8a9a7a },
      runner: { seed: 42, mottle: 0.35, tint: 0x9aa284 },
      brute: { seed: 43, mottle: 0.7, tint: 0x7d8a6a },
    },
    /** Grayscale detail overlay (flake + micro-scratch); paint tint lives on the material. */
    carPaint: { seed: 51, scale: 90, flakeAmount: 0.25, scratchSeed: 52, scratchAmount: 0.2, normalStrength: 0.5 },
    debris: { seed: 61, scale: 22, albedoLow: 0x3a3630, albedoHigh: 0x5c564c },
    /** Crossed alpha-tested vegetation planes; `alphaCut` thresholds the mask. */
    foliage: { seed: 71, scale: 14, alphaCut: 0.5, albedoLow: 0x4a4230, albedoHigh: 0x6a5f40 },
    /** Additive beam cone falloff (radial gradient, not noise). */
    beamFalloff: { size: 128, falloffPow: 1.6 },
    /** Lamp light-pool decal (radial gradient). */
    lightPool: { size: 256, falloffPow: 2.2 },
    /** Tiny procedural dusk sky for PMREM env lighting (task 1.3, D2). */
    sky: { seed: 81, size: 256, sunGlowPow: 3.5, sunGlowIntensity: 1 },
  },

  /** Adaptive quality controller (D7) + per-tier knobs. Tier 0 = lowest, tier 3 = max. */
  quality: {
    /** Master post-stack switch; false bypasses the composer entirely (task 1.4). */
    postFx: true,
    startTier: 3,
    fpsTarget: 60,
    fpsFloor: 55,
    /** EMA time constant (seconds) for the fps monitor. */
    emaWindowS: 1,
    /** Step down when EMA fps < stepDownFps, up when > stepUpFps (hysteresis). */
    stepDownFps: 55,
    stepUpFps: 67,
    /** A boundary condition must hold this long (s) before a tier step fires. */
    holdTimeS: 2,
    cooldownMs: 4000,
    /** Pinned degradation order — encoded as the ordered knob list (D7/vfx spec). */
    degradationOrder: ["resolution", "post", "particles", "shadows"] as const,
    pixelRatioScales: [0.7, 0.85, 1.0, 1.0],
    particleDensity: [0.5, 0.75, 0.9, 1.0],
    shadowMapSizes: [1024, 1024, 1536, 2048],
    shadowsOn: [false, true, true, true],
    /** Hard DPR cap for the renderer (existing behavior, now pinned here). */
    maxPixelRatio: 2,
  },

  /** Post stack, pooled particles, decals, camera feel, muzzle light. */
  vfx: {
    post: {
      bloom: { threshold: 0.85, radius: 0.6, strength: 0.55 },
      vignette: { amount: 0.35 },
      grain: { amount: 0.06 },
      chromaticAberration: { amount: 0.0012 },
    },
    particles: {
      /** Master preallocated pool; per-event counts scale by quality.particleDensity. */
      poolSize: 768,
      blood: { count: 26, lifeS: 0.7, gravity: 18, size: 0.16, spread: 3.2 },
      sparks: { count: 18, lifeS: 0.45, gravity: 9, size: 0.06, spread: 4.5 },
      smoke: { count: 14, lifeS: 1.6, gravity: -1.2, size: 0.55, spread: 0.9 },
      dust: { count: 10, lifeS: 1.2, gravity: 1.5, size: 0.3, spread: 1.6 },
      muzzle: { count: 8, lifeS: 0.12, gravity: 0, size: 0.22, spread: 2.5 },
    },
    /** Ground decals (blood/skid/oil) — shared instanced pool (tasks 4.3/6.2). */
    decals: { poolSize: 64, size: 0.9, lifeS: 12 },
    /** Camera feel envelopes (task 6.3): pulse amplitude decaying to zero. */
    camera: {
      damageShake: { amplitude: 0.22, durationS: 0.45, frequency: 24 },
      scrapeRumble: { amplitude: 0.05, durationS: 0.25, frequency: 30 },
      shotRecoil: { amplitude: 0.035, durationS: 0.1 },
      deathCam: { fovKick: 5, durationS: 1.4 },
    },
    /** Single muzzle-flash point light, retriggered per shot. */
    muzzleLight: { intensity: 40, range: 14, durationS: 0.08 },
  },

  /** Character visual fidelity params (render-side; sim specs stay in `zombies`/`car`). */
  actors: {
    zombie: {
      /** Instanced parts per zombie (torso, head, 2 arms, 2 legs) per D5. */
      parts: 6,
      /** Restrained gore default; 0..1 scale on blood counts/pool sizes/dismember odds. */
      goreIntensity: 0.6,
      /** Overkill = lethal damage exceeding hp by this many hits triggers dismemberment. */
      overkillThreshold: 3,
      minDismemberParts: 2,
      debrisPoolSize: 96,
      corpseFadeS: 2.5,
      /** Procedural cycle profiles. cycleHz = limb cycles/s at that type's sim speed. */
      cycles: {
        walker: { cycleHz: 1.1, limbAmplitude: 0.6, limbPhase: [0, Math.PI, Math.PI, 0], lean: 0.12, bob: 0.05 },
        runner: { cycleHz: 2.4, limbAmplitude: 0.95, limbPhase: [0, Math.PI, 0, Math.PI], lean: 0.28, bob: 0.09 },
        brute: { cycleHz: 0.7, limbAmplitude: 0.5, limbPhase: [Math.PI, 0, 0, Math.PI], lean: 0.06, bob: 0.11 },
      },
    },
    car: {
      /** Damage states as accumulated-damage fraction 0..1 (micro-scratches is the base state). */
      damageStates: { wornAt: 0.34, batteredAt: 0.67 },
      /** Detachable trim: first threshold crossed pops its part into pooled debris. */
      trimDetach: [
        { part: "leftMirror", dmgAt: 0.3 },
        { part: "rightMirror", dmgAt: 0.3 },
        { part: "frontBumper", dmgAt: 0.55 },
      ],
      /** Engine smoke emitter below this health fraction (aligns with hud.critAt). */
      criticalSmoke: 0.75,
      /** Suspension/steering visual response gains (radians/meters per unit state). */
      suspension: { rollGain: 0.06, pitchGain: 0.04, heaveGain: 0.05, settleS: 0.5 },
      steerVisualGain: 0.55,
      wheels: { radius: 0.34, width: 0.25, frontZ: 1.4, rearZ: -1.4, halfTrack: 0.82 },
    },
  },

  /** UI motion design (D8): durations in seconds unless noted. */
  ui: {
    entranceS: 0.45,
    /** Per-item delay for staggered reveals (game-over sequence, menu entrances). */
    staggerS: 0.08,
    hitMarkerS: 0.18,
    /** Directional damage indicator decay window. */
    damageIndicatorS: 0.6,
    /** Streak flare escalation: opacity/intensity added per streak tier, capped. */
    flarePerTier: 0.3,
    flareMax: 1,
    /** Title-screen attract camera drift speed (m/s along the corridor). */
    attractDriftSpeed: 1.5,
    /** When true, honor prefers-reduced-motion: suppress nonessential animation. */
    honorReducedMotion: true,
  },
};
