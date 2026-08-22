import * as THREE from "three";
import {
  createTankMesh,
  createTankState,
  MAX_SPEED,
  TANK_DEFS,
  updateTankPhysics,
  applyTankLivery,
  type TankDef,
  type TankInput,
  type TankState,
} from "./tank";
import { PlayerInput } from "./player";
import { TouchInput } from "./touch";
import { GamepadInput, type GamepadMenuAction } from "./gamepad";
import { closestOnSpline } from "./spline";
import {
  applySurfaceGrip,
  checkBoostPads,
  collideWithWalls,
  createTankProgress,
  createTrack,
  placeTankAtGridSlot,
  TOTAL_LAPS,
  TRACK_DEFS,
  updateBoostPads,
  updateTankProgress,
  type ProgressEvent,
  type Track,
  type TrackDef,
} from "./track";
import { createWeapons } from "./weapons";
import { createPowerups, type Powerups } from "./powerups";
import { AI_PERSONALITIES, createAIController, type AIController } from "./ai";
import {
  createScreens,
  formatRaceTime,
  type NewBest,
  type TankStatsView,
} from "./screens";
import { initAudio, resumeAudio, startMusic, stopMusic, sfx, suspendAudio, toggleMute, updateEngine } from "./audio";
import { createJuice } from "./juice";

/** High-level game flow (Phase 5): title → countdown → race → results. */
export type Phase = "title" | "countdown" | "race" | "results";

/** Shared game state — systems read/write this object. */
export interface World {
  tanks: TankState[];
  player: TankState;
  /** One progress record per tank (parallel to `tanks`). */
  racers: Racer[];
  /** Racers sorted by race position (index 0 = 1st). Recomputed every frame. */
  standings: Racer[];
  /** Player's 1-based race position — for the HUD POS readout. */
  playerPosition: number;
  /** Closed circuit: road, walls, boost pads, spline table. */
  track: Track;
  /** Current game-flow phase. */
  phase: Phase;
  /** Seconds since GO. Advances during race; frozen once results show. */
  raceTime: number;
}

export interface Racer {
  tank: TankState;
  progress: ReturnType<typeof createTankProgress>;
  /** raceTime when lap TOTAL_LAPS was completed; null while still racing. */
  finishTime: number | null;
}

export interface Game {
  world: World;
  update(dt: number): void;
  render(): void;
  onResize(): void;
  dispose(): void;
}

const START_T = 0.005; // just past the start/finish line

const COUNTDOWN_STEP = 0.8; // seconds per 3/2/1/GO step
const COUNTDOWN_LABELS = ["3", "2", "1", "GO!"] as const;

const BASE_FOV = 65;
const BOOST_FOV_KICK = 8; // extra FOV while a boost is active
const SHAKE_DECAY = 7; // 1/s exponential falloff of screen shake
const PLAYER_HIT_SHAKE = 0.5;
const PLAYER_WRECK_SHAKE = 1.0;

/** Start grid — player at the front, AIs behind/beside. Module-level so
 * resetRace() can put everyone back exactly where they started. */
const GRID = [
  { t: START_T, lateral: 0 },
  { t: START_T - 0.003, lateral: -3.6 },
  { t: START_T - 0.003, lateral: 3.6 },
  { t: START_T - 0.006, lateral: 0 },
];

const NO_INPUT: TankInput = { throttle: 0, steer: 0 };

export function createGame(canvas: HTMLCanvasElement): Game {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff); // tinted per track by applyTheme()
  scene.fog = new THREE.Fog(0xffffff, 120, 420);

  // --- Lighting ------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0xd8b878, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.far = 300;
  // Shadow camera follows the player so shadows stay cheap and local
  scene.add(sun, sun.target);

  // --- Ground: flat sand plane ---------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshLambertMaterial({ color: 0xd9b56e }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Screens overlay (created early: loadTrack updates the title card) -----
  const screens = createScreens();

  // --- Track selection (Phase 6) ----------------------------------------------
  /** localStorage key for the last-selected circuit. */
  const TRACK_STORAGE_KEY = "tankracer.track";

  function loadStoredTrackIndex(): number {
    try {
      const raw = localStorage.getItem(TRACK_STORAGE_KEY);
      const idx = raw === null ? NaN : Number.parseInt(raw, 10);
      return Number.isInteger(idx) && idx >= 0 && idx < TRACK_DEFS.length ? idx : 0;
    } catch {
      return 0;
    }
  }

  function storeTrackIndex(index: number): void {
    try {
      localStorage.setItem(TRACK_STORAGE_KEY, String(index));
    } catch {
      /* private mode etc. — selection just won't persist */
    }
  }

  // --- Tank selection (Phase 7) -----------------------------------------------
  /** localStorage key for the last-selected tank. */
  const TANK_STORAGE_KEY = "tankracer.tank";

  function loadStoredTankIndex(): number {
    try {
      const raw = localStorage.getItem(TANK_STORAGE_KEY);
      const idx = raw === null ? NaN : Number.parseInt(raw, 10);
      return Number.isInteger(idx) && idx >= 0 && idx < TANK_DEFS.length
        ? idx
        : 0;
    } catch {
      return 0;
    }
  }

  function storeTankIndex(index: number): void {
    try {
      localStorage.setItem(TANK_STORAGE_KEY, String(index));
    } catch {
      /* private mode etc. — selection just won't persist */
    }
  }

  let tankIndex = loadStoredTankIndex();

  /** Definition of the tank the player will race (title-screen selection). */
  function playerTankDef(): TankDef {
    return TANK_DEFS[tankIndex];
  }

  function hexColor(n: number): string {
    return `#${n.toString(16).padStart(6, "0")}`;
  }

  /** Normalized stat bars (0..1) for the title-screen stats card. */
  function tankStatsView(def: TankDef): TankStatsView {
    return {
      name: def.name,
      blurb: def.blurb,
      color: hexColor(def.hullColor),
      speed: def.maxSpeed / 52,
      armor: def.maxHp / 160,
      fire: 1 / def.fireCooldown / 1.7,
    };
  }

  /**
   * Select + persist a tank on the title screen: restyles the player mesh,
   * applies per-tank physics stats and refreshes the stats card.
   * Safe to call repeatedly while cycling with UP/DOWN.
   */
  function selectTank(index: number): void {
    const n = TANK_DEFS.length;
    tankIndex = ((index % n) + n) % n;
    storeTankIndex(tankIndex);
    applyTankLivery(player.mesh, playerTankDef());
    resetTankCombat(player); // picks up maxHp/fireCooldownMax + full HP
    screens.setTankCard(tankStatsView(playerTankDef()));
  }

  // --- Best times (Phase 7) -----------------------------------------------------
  /** Per-track records persisted in localStorage. */
  interface BestTimes {
    lap: number | null;
    total: number | null;
  }

  function bestKey(trackId: string): string {
    return `tankracer.best.${trackId}`;
  }

  function loadBestTimes(trackId: string): BestTimes {
    try {
      const raw = localStorage.getItem(bestKey(trackId));
      if (!raw) return { lap: null, total: null };
      const parsed = JSON.parse(raw) as Partial<BestTimes>;
      return {
        lap: typeof parsed.lap === "number" ? parsed.lap : null,
        total: typeof parsed.total === "number" ? parsed.total : null,
      };
    } catch {
      return { lap: null, total: null };
    }
  }

  function storeBestTimes(trackId: string, best: BestTimes): void {
    try {
      localStorage.setItem(bestKey(trackId), JSON.stringify(best));
    } catch {
      /* private mode etc. — records just won't persist */
    }
  }

  /** Refresh the title-screen best-time readout for this circuit. */
  function showBestTimesForTrack(def: TrackDef): void {
    const best = loadBestTimes(def.id);
    screens.setBestTimes(
      best.lap !== null ? formatRaceTime(best.lap) : null,
      best.total !== null ? formatRaceTime(best.total) : null,
    );
  }

  let trackIndex = loadStoredTrackIndex();
  let track!: Track; // assigned by loadTrack() below
  let powerups: Powerups; // rebuilt per track (crate spots come from the TrackDef)

  function applyTheme(def: TrackDef): void {
    (scene.background as THREE.Color).setHex(def.skyColor);
    (scene.fog as THREE.Fog).color.setHex(def.skyColor);
    (ground.material as THREE.MeshLambertMaterial).color.setHex(def.groundColor);
    // Phase 12: night circuits can boost ambient / dim the sun for readability
    hemi.intensity = def.hemiIntensity ?? 0.9;
    sun.intensity = def.sunIntensity ?? 1.6;
  }

  /** Free a track group's GPU resources and remove it from the scene. */
  function disposeTrackGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as
        | THREE.Material
        | THREE.Material[]
        | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    scene.remove(group);
  }

  /**
   * Build the selected circuit and re-seat every tank on its grid.
   * Safe to call repeatedly on the title screen (LEFT/RIGHT cycling).
   */
  function loadTrack(index: number): void {
    trackIndex =
      ((index % TRACK_DEFS.length) + TRACK_DEFS.length) % TRACK_DEFS.length;
    const def = TRACK_DEFS[trackIndex];
    storeTrackIndex(trackIndex);

    if (track) disposeTrackGroup(track.group);
    if (powerups) powerups.dispose();
    weapons.reset(world); // stale shells/puffs from any previous race
    juice.reset();

    track = createTrack(def);
    scene.add(track.group);
    powerups = createPowerups(scene, track.points, def.crateTs, {
      onPickup: (_tank, kind) => {
        if (kind === "boost") sfx.boost();
        else sfx.pickup();
      },
    });
    applyTheme(def);

    // Rebuild progress + AI brains against the new spline, tanks on the grid
    racers.length = 0;
    aiControllers.length = 0;
    for (let i = 0; i < GRID.length && i < world.tanks.length; i++) {
      placeTankAtGridSlot(world.tanks[i], track, GRID[i].t, GRID[i].lateral);
      resetTankCombat(world.tanks[i]);
      racers.push({
        tank: world.tanks[i],
        progress: createTankProgress(GRID[i].t),
        finishTime: null,
      });
    }
    for (let i = 1; i < racers.length; i++) {
      aiControllers.push(
        createAIController(AI_PERSONALITIES[i - 1], racers[i], track),
      );
    }
    world.track = track;
    world.raceTime = 0;

    // Title-orbit centroid follows the new circuit
    centerX = 0;
    centerZ = 0;
    for (const p of track.points) {
      centerX += p.x;
      centerZ += p.z;
    }
    centerX /= track.points.length;
    centerZ /= track.points.length;

    screens.setTrackName(def.name);
    showBestTimesForTrack(def);
  }

  /** Display name + swatch color per racer index (player first) — results UI.
   * Player color is resolved at row-build time so it tracks the selected tank. */
  const roster: { name: string; color: string }[] = [
    { name: "YOU", color: "" },
    ...AI_PERSONALITIES.map((p) => ({
      name: p.name,
      color: `#${p.hullColor.toString(16).padStart(6, "0")}`,
    })),
  ];

  // --- Player tank + input --------------------------------------------------
  const player = createTankState(createTankMesh(), playerTankDef());
  scene.add(player.mesh.root);

  const input = new PlayerInput();
  input.attach();

  // Phase 8: touch controls — same TankInput shape, merged in readPlayerInput().
  // attach() happens further down, after `world` exists (a synchronous
  // coarse-pointer enable would otherwise read world.phase too early).
  const touchInput = new TouchInput({
    onEnable: updateTouchControlsVisibility,
  });

  // Phase 10: gamepad — same TankInput merge shape; menus via drained actions.
  // attach() only registers listeners/probes, so it's safe before `world`.
  const gamepadInput = new GamepadInput({
    onConnect: () => screens.toast("🎮 CONNECTED"),
    onDisconnect: () => screens.toast("🎮 DISCONNECTED"),
  });
  gamepadInput.attach();

  const racers: Racer[] = [];
  const aiControllers: AIController[] = [];

  const world: World = {
    tanks: [player],
    player,
    racers,
    standings: [],
    playerPosition: 1,
    track: null as unknown as Track, // set by loadTrack() immediately below
    phase: "title",
    raceTime: 0,
  };

  // --- AI opponents (meshes created once; loadTrack() re-seats them) ----------
  for (let i = 1; i < GRID.length && i <= AI_PERSONALITIES.length; i++) {
    const pers = AI_PERSONALITIES[i - 1];
    const mesh = createTankMesh(pers.hullColor, pers.turretColor);
    const ai = createTankState(mesh);
    scene.add(ai.mesh.root);
    world.tanks.push(ai);
  }

  // --- Weapons (audio/juice hooks wired here) ---------------------------------
  const juice = createJuice(scene);
  const weapons = createWeapons(scene, {
    onShot: () => sfx.shot(),
    onHit: (target) => {
      sfx.hit();
      juice.impactSparks(target.position.x, 1.2, target.position.z);
      if (target === player) shake = PLAYER_HIT_SHAKE;
    },
    onWreck: (target) => {
      sfx.explosion();
      juice.wreckBurst(target.position.x, 0.5, target.position.z);
      if (target === player) shake = PLAYER_WRECK_SHAKE;
    },
  });

  // Title-screen orbit centroid — filled in by loadTrack()
  let centerX = 0;
  let centerZ = 0;

  // Build the persisted track, seat all tanks, wire crates + AI brains
  loadTrack(trackIndex);

  screens.showTitle(`${TRACK_DEFS.length} CIRCUITS`);
  setPhase("title"); // hoisted function decl; hides the HUD behind the title card
  selectTank(tankIndex); // applies livery/stats + title-screen stats card
  touchInput.attach(); // safe now: world + phase exist for the onEnable callback

  // --- Cameras -----------------------------------------------------------------
  let shake = 0;
  let countdownClock = 0;
  let countdownStep = -1;
  let goHideTimer = 0;

  // Phase 9: pause freezes the whole sim; dust-puff spawn timer lives here too.
  let paused = false;
  let dustTimer = 0;

  /**
   * Freeze/resume everything. The AudioContext suspends with the sim, which
   * silences SFX/engine/music at once — the music scheduler runs on
   * ctx.currentTime, so it resumes exactly where it left off. world.phase
   * stays "race" while paused, so resume simply continues the frame loop.
   */
  function setPaused(value: boolean): void {
    if (paused === value) return;
    paused = value;
    if (value) {
      suspendAudio();
      screens.showPaused();
    } else {
      resumeAudio();
      screens.hidePaused();
      // Drop anything pressed during the freeze so no stale shot/steer leaks in
      input.consumeFire();
      touchInput.consumeFire();
      gamepadInput.consumeFire();
    }
    updateTouchControlsVisibility();
  }

  const camera = new THREE.PerspectiveCamera(
    BASE_FOV,
    window.innerWidth / window.innerHeight,
    0.5,
    1000,
  );
  const CAM_DIST = 14;
  const CAM_HEIGHT = 7;

  let titleAngle = 0;

  // Preallocated vectors — the chase camera runs every frame; no allocations.
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const fwdVec = new THREE.Vector3();
  const CAM_LIFT = new THREE.Vector3(0, CAM_HEIGHT, 0);

  function snapChaseCamera(): void {
    fwdVec.set(Math.sin(player.heading), 0, Math.cos(player.heading));
    camPos
      .copy(player.position)
      .addScaledVector(fwdVec, -CAM_DIST)
      .add(CAM_LIFT);
    camera.position.copy(camPos);
    camera.lookAt(player.position.x, player.position.y + 2, player.position.z);
  }

  function chaseCamera(dt: number): void {
    fwdVec.set(Math.sin(player.heading), 0, Math.cos(player.heading));
    camTarget.copy(player.position).addScaledVector(fwdVec, -CAM_DIST);
    camTarget.y += CAM_HEIGHT;
    // Frame-rate independent smoothing
    camPos.lerp(camTarget, 1 - Math.exp(-5 * dt));
    camera.position.copy(camPos);

    // Screen-shake pulse (decays exponentially)
    if (shake > 0.002) {
      camera.position.x += (Math.random() * 2 - 1) * shake;
      camera.position.y += (Math.random() * 2 - 1) * shake * 0.6;
      camera.position.z += (Math.random() * 2 - 1) * shake;
      shake *= Math.exp(-SHAKE_DECAY * dt);
    }

    camera.lookAt(player.position.x, player.position.y + 2, player.position.z);

    // FOV kick while boosting — smooth toward the target, skip DOM-free no-ops
    const targetFov =
      BASE_FOV + (player.boostTimer > 0 ? BOOST_FOV_KICK : 0);
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, 8 * dt);
      camera.updateProjectionMatrix();
    }
  }

  function titleCamera(dt: number): void {
    titleAngle += dt * 0.12;
    const r = 250;
    camera.position.set(
      centerX + Math.cos(titleAngle) * r,
      95,
      centerZ + Math.sin(titleAngle) * r,
    );
    camera.lookAt(centerX, 0, centerZ);
  }

  // --- State machine helpers -----------------------------------------------------
  function setPhase(phase: Phase): void {
    world.phase = phase;
    // HUD hidden on the title only; toggled on phase change, never per frame.
    const hud = document.getElementById("hud");
    if (hud) hud.style.display = phase === "title" ? "none" : "";
    updateTouchControlsVisibility();
  }

  /** Touch buttons live on the countdown + race only; screens stay tappable. */
  function updateTouchControlsVisibility(): void {
    touchInput.setControlsVisible(
      !paused && (world.phase === "race" || world.phase === "countdown"),
    );
  }

  function beginCountdown(): void {
    countdownClock = 0;
    countdownStep = -1;
    goHideTimer = 0;
    screens.hideResults();
    screens.showCountdownTag(`${playerTankDef().name} — READY`); // Phase 7
    setPhase("countdown");
    snapChaseCamera(); // spec: snap straight to the chase cam on Enter
  }

  /** Full state reset for restart: grid positions, HP, crates, shells, timers. */
  function resetRace(): void {
    for (let i = 0; i < racers.length; i++) {
      const slot = GRID[i];
      placeTankAtGridSlot(racers[i].tank, track, slot.t, slot.lateral);
      resetTankCombat(racers[i].tank);
      racers[i].progress = createTankProgress(slot.t);
      racers[i].finishTime = null;
    }
    weapons.reset(world); // stale shells/puffs/wreck visuals
    juice.reset(); // dust/sparks/bursts from the previous race
    powerups.reset(); // crates back up, bubbles hidden
    world.raceTime = 0;
    stopMusic(0.3); // restart path: music comes back fresh at GO
    updateStandings(world);
    beginCountdown();
  }

  function resetTankCombat(tank: TankState): void {
    tank.hp = tank.maxHp; // Phase 7: per-tank max HP
    tank.fireCooldown = 0;
    tank.spinTimer = 0;
    tank.spinDir = 1;
    tank.wreckTimer = 0;
    tank.invulnTimer = 0;
    tank.shield = false;
    tank.tripleShots = 0;
    tank.boostTimer = 0;
    tank.boostMultiplier = 1;
    // Fresh object: simulate() may have pointed tank.input at the shared
    // NO_INPUT constant, which must never be mutated.
    tank.input = { throttle: 0, steer: 0 };
  }

  function finishRace(): void {
    setPhase("results");
    stopMusic(); // duck the loop out under the results screen
    const racer = world.racers[0]; // the player
    const best = loadBestTimes(track.def.id);
    const newBest: NewBest = { lap: false, total: false };
    const bestLap = racer.progress.bestLap;
    if (bestLap !== null && (best.lap === null || bestLap < best.lap)) {
      best.lap = bestLap;
      newBest.lap = true;
    }
    if (
      racer.finishTime !== null &&
      (best.total === null || racer.finishTime < best.total)
    ) {
      best.total = racer.finishTime;
      newBest.total = true;
    }
    if (newBest.lap || newBest.total) storeBestTimes(track.def.id, best);
    screens.showResults(buildResultRows(), track.def.name, newBest);
  }

  function buildResultRows() {
    // Finished racers by time, then unfinished by track progress.
    const order = world.racers.slice().sort((a, b) => {
      if (a.finishTime !== null && b.finishTime !== null) {
        return a.finishTime - b.finishTime;
      }
      if (a.finishTime !== null) return -1;
      if (b.finishTime !== null) return 1;
      return b.progress.totalProgress - a.progress.totalProgress;
    });
    return order.map((racer) => {
      const idx = world.racers.indexOf(racer);
      const entry = roster[idx] ?? { name: "???", color: "#888888" };
      return {
        name: entry.name,
        color:
          racer.tank === player
            ? hexColor(playerTankDef().hullColor) // tracks the selected tank
            : entry.color,
        isPlayer: racer.tank === player,
        time:
          racer.finishTime !== null ? formatRaceTime(racer.finishTime) : "—",
        best:
          racer.progress.bestLap !== null
            ? formatRaceTime(racer.progress.bestLap)
            : "—",
      };
    });
  }

  /** Lap/gate event side effects: FINAL LAP banner + finish detection. */
  function handleProgressEvent(tank: TankState, racer: Racer, ev: ProgressEvent): void {
    if (ev !== "lap") return;
    const prog = racer.progress;
    if (prog.lap > TOTAL_LAPS) {
      if (racer.finishTime === null) racer.finishTime = world.raceTime;
      if (tank === player) finishRace(); // player finish triggers results
    } else if (tank === player && prog.lap === TOTAL_LAPS) {
      screens.flashBanner("FINAL LAP");
    }
  }

  /**
   * Merge keyboard + touch + gamepad into one TankInput — the exact shape the
   * AI brains produce, so physics/weapons need no special cases. Auto-throttle
   * wins over "no key held"; steering sums so a stuck touch can't outvote the
   * keys, clamped to ±1 so an analog stick can never exceed full lock.
   */
  function readPlayerInput(): TankInput {
    const kb = input.read();
    const tc = touchInput.read();
    const gp = gamepadInput.read();
    return {
      throttle: Math.max(kb.throttle, tc.throttle, gp.throttle),
      steer: Math.max(-1, Math.min(1, kb.steer + tc.steer + gp.steer)),
    };
  }

  /**
   * One simulated race frame. `driving=false` freezes everyone's inputs
   * (countdown coast-in / post-finish freeze); physics and FX keep running.
   */
  function simulate(dt: number, driving: boolean): void {
    player.input = driving ? readPlayerInput() : NO_INPUT;
    const kbFire = input.consumeFire(); // always drain queued shots
    const touchFire = touchInput.consumeFire();
    const padFire = gamepadInput.consumeFire();
    if (driving && (kbFire || touchFire || padFire)) weapons.tryFire(player);

    for (let i = 0; i < world.tanks.length; i++) {
      const tank = world.tanks[i];
      if (driving && i > 0) {
        // AI brains produce the same input shape as the player's keyboard
        const d = aiControllers[i - 1].think(dt, world);
        tank.input.throttle = d.throttle;
        tank.input.steer = d.steer;
        if (d.fire) weapons.tryFire(tank);
      } else if (!driving) {
        tank.input = NO_INPUT;
      }
      // Phase 11: stage surface grip from the tank's last-known spline t
      // (one-frame-old is fine — patches are ~40u long) before physics runs.
      applySurfaceGrip(track, tank, racers[i].progress.lastT);
      updateTankPhysics(tank, dt);
      collideWithWalls(track, tank);
      if (checkBoostPads(track, tank) && tank === player) sfx.boost();
      // Phase 9 juice: dust when lateral slip is high (drifting / hard turns
      // at speed — turning rotates the heading away from the velocity vector,
      // which shows up as lateral velocity). Rate-gated by a shared timer.
      dustTimer -= dt;
      const dropDust = dustTimer <= 0;
      if (dropDust) dustTimer = 0.07;
      if (dropDust && tank.wreckTimer <= 0) {
        const fx = Math.sin(tank.heading);
        const fz = Math.cos(tank.heading);
        const lateral = Math.abs(tank.velocity.x * fz - tank.velocity.z * fx);
        if (tank.velocity.length() > 10 && lateral > 5) juice.dust(tank);
      }
      // Progress: closest point on the centerline drives gates/laps.
      // Frozen once the race is over so times stay exactly as displayed.
      if (driving) {
        const hit = closestT(track, tank);
        handleProgressEvent(
          tank,
          racers[i],
          updateTankProgress(racers[i].progress, hit, dt, track.def.gates),
        );
      }
    }
    if (driving) updateStandings(world);
    updateBoostPads(track, dt);
    // Shell movement/hits + wreck timers → respawn
    weapons.update(world, dt);
    // Dust/sparks/burst particles
    juice.update(dt);
    // Crate animation, pickups, shield bubbles
    powerups.update(world, dt);
    chaseCamera(dt);
    // Keep shadow frustum centered on the action
    sun.position.set(player.position.x + 60, 90, player.position.z + 40);
    sun.target.position.copy(player.position);
  }

  // --- Global keys: Enter (start), R (restart), M (mute), ←/→ track select -----
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === "KeyM") {
      const muted = toggleMute();
      screens.toast(muted ? "SOUND OFF" : "SOUND ON");
      return;
    }
    // Phase 9: pause lives in the race phase only (countdown/title/results are
    // untouched). While paused world.phase is still "race", so this same branch
    // handles resume.
    if (e.code === "KeyP" || e.code === "Escape") {
      if (world.phase === "race") setPaused(!paused);
      return;
    }
    // Restart from pause: unfreeze first so the countdown runs on live audio
    if (e.code === "KeyR" && paused) {
      setPaused(false);
      resetRace();
      return;
    }
    // Title screen: LEFT/RIGHT cycles circuits (Phase 6), UP/DOWN tanks (Phase 7)
    if (world.phase === "title") {
      if (e.code === "ArrowLeft") {
        sfx.pickup();
        loadTrack(trackIndex - 1);
        return;
      }
      if (e.code === "ArrowRight") {
        sfx.pickup();
        loadTrack(trackIndex + 1);
        return;
      }
      if (e.code === "ArrowUp") {
        sfx.pickup();
        selectTank(tankIndex - 1);
        return;
      }
      if (e.code === "ArrowDown") {
        sfx.pickup();
        selectTank(tankIndex + 1);
        return;
      }
    }
    if (e.code === "Enter" && world.phase === "title") {
      initAudio(); // first user gesture unlocks WebAudio
      beginCountdown();
    } else if (e.code === "KeyR" && world.phase === "results") {
      initAudio();
      resetRace(); // instant restart straight into COUNTDOWN
    }
  };
  window.addEventListener("keydown", onKeyDown);

  // --- Phase 10: gamepad menus -------------------------------------------------
  /**
   * Route drained gamepad menu actions through the exact same code paths the
   * keyboard uses (loadTrack/selectTank/beginCountdown/resetRace/setPaused),
   * so gamepad menu behavior can't drift from keyboard behavior. Start toggles
   * pause only during a race — identical gating to the P/Esc branch above.
   */
  function handleGamepadMenuAction(action: GamepadMenuAction): void {
    if (action === "pause") {
      if (world.phase === "race") setPaused(!paused); // also resumes while paused
      return;
    }
    if (world.phase === "title") {
      if (action === "left") {
        sfx.pickup();
        loadTrack(trackIndex - 1);
      } else if (action === "right") {
        sfx.pickup();
        loadTrack(trackIndex + 1);
      } else if (action === "up") {
        sfx.pickup();
        selectTank(tankIndex - 1);
      } else if (action === "down") {
        sfx.pickup();
        selectTank(tankIndex + 1);
      } else if (!paused) {
        // A = Enter equivalent. Not while paused: pause only exists mid-race,
        // so this is just belt-and-braces against future phase changes.
        initAudio(); // first user gesture unlocks WebAudio
        beginCountdown();
      }
    } else if (world.phase === "results" && action === "confirm") {
      initAudio();
      resetRace(); // A = R equivalent on results
    }
  }

  /** Per-frame gamepad poll — runs even while paused so Start can resume. */
  function pollGamepad(dt: number): void {
    gamepadInput.update(dt);
    for (const action of gamepadInput.drainMenuActions()) {
      handleGamepadMenuAction(action);
    }
  }


  // Phase 8: tap anywhere = Enter/R equivalent on title/results (touch mode
  // only, so the desktop click flow is untouched). Countdown has no keyboard
  // skip either — a mid-countdown tap is intentionally ignored.
  const onPointerDown = (e: PointerEvent) => {
    if (!touchInput.enabled) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("#touch-controls")) return; // button press, not a screen tap
    if (world.phase === "title") {
      initAudio(); // same unlock as the Enter path
      beginCountdown();
    } else if (world.phase === "results") {
      initAudio();
      resetRace();
    }
  };
  window.addEventListener("pointerdown", onPointerDown);

  return {
    world,
    update(dt: number) {
      // Phase 10: gamepad poll runs even while frozen so Start can resume.
      pollGamepad(dt);
      // Phase 9: frozen sim — nothing advances (physics, timers, lap logic,
      // AI, shells, crate respawn clocks, music). The RAF loop keeps ticking
      // and main.ts keeps refreshing its `last` timestamp, so the first dt
      // after resume is a normal frame — no physics jump.
      if (paused) return;
      switch (world.phase) {
        case "title":
          titleCamera(dt); // slow orbit; tanks idle at the grid
          break;
        case "countdown":
          countdownClock += dt;
          {
            const step = Math.min(
              Math.floor(countdownClock / COUNTDOWN_STEP),
              COUNTDOWN_LABELS.length - 1,
            );
            if (step !== countdownStep) {
              countdownStep = step;
              screens.showCountdown(COUNTDOWN_LABELS[step]);
              if (step === COUNTDOWN_LABELS.length - 1) {
                sfx.go();
                startMusic(); // race music kicks in exactly at GO
                screens.showCountdownTag(
                  `${playerTankDef().name} — GO!`,
                ); // Phase 7
                setPhase("race"); // timer starts exactly at GO
                goHideTimer = 0.8; // let "GO!" linger briefly
              } else {
                sfx.beep();
              }
            }
          }
          // Ambient FX keep running behind the countdown text; no physics,
          // so lap timers can't start early and tanks stay locked on the grid.
          updateBoostPads(track, dt);
          weapons.update(world, dt);
          juice.update(dt);
          powerups.update(world, dt);
          chaseCamera(dt);
          updateEngine(0, false);
          break;
        case "race":
          world.raceTime += dt;
          if (goHideTimer > 0) {
            goHideTimer -= dt;
            if (goHideTimer <= 0) screens.hideCountdown();
          }
          simulate(dt, true);
          updateEngine(player.velocity.length() / MAX_SPEED, true);
          break;
        case "results":
          // Freeze all inputs but let tanks coast to a stop; progress and
          // timers are gated off inside simulate(), so the times shown in
          // the results table stay frozen.
          simulate(dt, false);
          updateEngine(0, false);
          break;
      }
    },
    render() {
      renderer.render(scene, camera);
    },
    onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      input.detach();
      touchInput.dispose();
      gamepadInput.dispose();
      stopMusic(0.1);
      renderer.dispose();
    },
  };
}

function closestT(track: Track, tank: TankState): number {
  return closestOnSpline(track.table, tank.position.x, tank.position.z).t;
}

/** Sort racers by laps + fractional progress → world.standings/playerPosition. */
function updateStandings(world: World): void {
  const sorted = world.racers.slice().sort(
    (a, b) => b.progress.totalProgress - a.progress.totalProgress,
  );
  world.standings = sorted;
  world.playerPosition = sorted.indexOf(world.racers[0]) + 1;
}
