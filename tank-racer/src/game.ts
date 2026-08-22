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
  type ChampPodiumView,
  type ChampResultsView,
  type NewBest,
  type TankStatsView,
} from "./screens";
import { initAudio, resumeAudio, startMusic, stopMusic, sfx, suspendAudio, toggleMute, updateEngine } from "./audio";
import { createJuice } from "./juice";
import {
  CHAMP_POINTS,
  clearChamp,
  loadChamp,
  sortStandings,
  storeChamp,
  totalTimeOf,
  type ChampEntrant,
  type ChampState,
} from "./championship";
import {
  createGhostPlayer,
  createGhostRecorder,
  GHOST_FORMAT_VERSION,
  loadGhost,
  storeGhost,
  type GhostRecording,
} from "./ghost";

/** High-level game flow (Phase 5): title → countdown → race → results.
 * Phase 15 adds "podium" — the final championship standings screen. */
export type Phase = "title" | "countdown" | "race" | "results" | "podium";

/** Shared game state — systems read/write this object. */
export interface World {
  tanks: TankState[];
  player: TankState;
  /** Phase 13: second human player in 2P split-screen (null in 1P). */
  player2: TankState | null;
  /** Phase 13: true while local 2-player split-screen is active. */
  twoPlayer: boolean;
  /** One progress record per tank (parallel to `tanks`). */
  racers: Racer[];
  /** Racers sorted by race position (index 0 = 1st). Recomputed every frame. */
  standings: Racer[];
  /** Player's 1-based race position — for the HUD POS readout. */
  playerPosition: number;
  /** Phase 13: P2's 1-based race position (HUD in 2P only). */
  playerPosition2: number;
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
  /** Dev/debug handle for headless smoke tests. */
  worldRef: World;
  update(dt: number): void;
  render(): void;
  onResize(): void;
  dispose(): void;
  /** Phase 13: notified whenever the 1P/2P mode changes (HUD rebuild). */
  setOnModeChange(cb: (twoPlayer: boolean) => void): void;
}

const START_T = 0.005; // just past the start/finish line

const COUNTDOWN_STEP = 0.8; // seconds per 3/2/1/GO step
const COUNTDOWN_LABELS = ["3", "2", "1", "GO!"] as const;

const BASE_FOV = 65;
const BOOST_FOV_KICK = 8; // extra FOV while a boost is active
const SHAKE_DECAY = 7; // 1/s exponential falloff of screen shake
const PLAYER_HIT_SHAKE = 0.5;
const PLAYER_WRECK_SHAKE = 1.0;

/** Phase 13: P2's fixed livery (orange — pairs with P1's cyan HUD accent). */
const P2_HULL_COLOR = 0xff8c00;
const P2_TURRET_COLOR = 0xffb066;

/** Start grid — humans at the front, AIs behind/beside. In 2P the grid stays
 * 4 tanks: P1, P2, then only 2 AI (the third AI tank is benched). Module-level
 * so resetRace() can put everyone back exactly where they started. */
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

  // --- Cameras (created early: the boot-time mode/championship restore can
  // call applyMode() → updateCameraAspects(), which reads these) --------------
  const camera = new THREE.PerspectiveCamera(
    BASE_FOV,
    window.innerWidth / window.innerHeight,
    0.5,
    1000,
  );
  // Phase 13: second chase camera for P2's half of the split screen.
  const camera2 = new THREE.PerspectiveCamera(
    BASE_FOV,
    window.innerWidth / window.innerHeight,
    0.5,
    1000,
  );

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

  // --- Mode selection (Phase 13): local 1P vs 2P split-screen -----------------
  /** localStorage key for the last-used mode ("1p" | "2p"). */
  const MODE_STORAGE_KEY = "tankracer.mode";

  function loadStoredTwoPlayer(): boolean {
    try {
      return localStorage.getItem(MODE_STORAGE_KEY) === "2p";
    } catch {
      return false;
    }
  }

  function storeMode(twoPlayer: boolean): void {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, twoPlayer ? "2p" : "1p");
    } catch {
      /* private mode etc. — selection just won't persist */
    }
  }

  // --- Championship Mode (Phase 15): all 4 circuits in fixed order -------------
  /**
   * Two pieces of state:
   *  - `champMode` — the title-screen V toggle (persisted). While on, the
   *    track picker is disabled and ENTER races the series in TRACK_DEFS order.
   *  - `champ` — an in-progress series (persisted after every race under
   *    "tankracer.champ"), so a refresh resumes at the right race. Cleared on
   *    completion or abandonment.
   */
  const SERIES_STORAGE_KEY = "tankracer.series";

  /** Title-screen toggle state; declared before loadTrack() (persist guard). */
  let champMode = false;
  /** In-progress series, or null when none is running. */
  let champ: ChampState | null = null;

  function loadStoredChampMode(): boolean {
    try {
      return localStorage.getItem(SERIES_STORAGE_KEY) === "champ";
    } catch {
      return false;
    }
  }

  function storeChampMode(on: boolean): void {
    try {
      localStorage.setItem(SERIES_STORAGE_KEY, on ? "champ" : "single");
    } catch {
      /* private mode etc. — selection just won't persist */
    }
  }

  /** Grid slot → stable championship entrant id ("p1"/"p2"/"ai{n}"). */
  function entrantIdForSlot(slot: number): string {
    const humans = world.twoPlayer ? 2 : 1;
    if (slot === 0) return "p1";
    if (slot === 1 && world.twoPlayer) return "p2";
    return `ai${slot - humans}`;
  }

  /** Fresh 4-entrant table from the current grid roster (humans keep names/colors
   * they race with all series long; AI personalities are module constants). */
  function buildChampEntrants(): ChampEntrant[] {
    const humans = world.twoPlayer ? 2 : 1;
    const list: ChampEntrant[] = [
      {
        id: "p1",
        name: humanName(player),
        color: hexColor(playerTankDef().hullColor),
        isPlayer: true,
        points: 0,
        times: [],
        wins: 0,
      },
    ];
    if (world.twoPlayer) {
      list.push({
        id: "p2",
        name: "P2",
        color: hexColor(P2_HULL_COLOR),
        isPlayer: false,
        isPlayerTwo: true,
        points: 0,
        times: [],
        wins: 0,
      });
    }
    for (let i = humans; i < GRID.length; i++) {
      const pers = AI_PERSONALITIES[i - humans];
      list.push({
        id: `ai${i - humans}`,
        name: pers.name,
        color: `#${pers.hullColor.toString(16).padStart(6, "0")}`,
        isPlayer: false,
        points: 0,
        times: [],
        wins: 0,
      });
    }
    return list;
  }

  /** P1's swatch tracks a mid-series tank re-pick (cosmetic only). */
  function syncChampP1Color(): void {
    if (!champ) return;
    const p1 = champ.entrants.find((e) => e.id === "p1");
    if (p1) p1.color = hexColor(playerTankDef().hullColor);
  }

  /**
   * Award points for one completed race. `order` is finishing order (same sort
   * as the results table): points by position, winner banks a win, DNF racers
   * still score by progress but record no time (time tie-breaks penalize it).
   */
  function recordChampRace(order: Racer[]): ChampResultsView {
    const st = champ!;
    for (
      let pos = 0;
      pos < order.length && pos < CHAMP_POINTS.length;
      pos++
    ) {
      const racer = order[pos];
      const entrant = st.entrants.find(
        (e) => e.id === entrantIdForSlot(world.racers.indexOf(racer)),
      );
      if (!entrant) continue;
      entrant.points += CHAMP_POINTS[pos];
      if (pos === 0) entrant.wins += 1;
      entrant.times.push(racer.finishTime);
    }
    st.raceIndex += 1;
    storeChamp(st); // crash-safe resume point even between this line + podium
    return buildChampResultsView(st);
  }

  /** Sorted cumulative standings view for the results overlay sidebar. */
  function buildChampResultsView(st: ChampState): ChampResultsView {
    const sorted = sortStandings(st.entrants);
    const done = st.raceIndex >= TRACK_DEFS.length;
    return {
      afterRace: st.raceIndex,
      totalRaces: TRACK_DEFS.length,
      prompt: done
        ? "PRESS ENTER — FINAL PODIUM"
        : `PRESS ENTER — RACE ${st.raceIndex + 1}/${TRACK_DEFS.length}: ${TRACK_DEFS[st.raceIndex].name}`,
      standings: sorted.map((e, i) => ({
        pos: i + 1,
        name: e.name,
        color: e.color,
        points: e.points,
        isPlayer: e.isPlayer,
        isPlayerTwo: e.isPlayerTwo,
      })),
    };
  }

  /** Final podium data (points order; ties fall through time then wins). */
  function buildPodiumView(st: ChampState): ChampPodiumView {
    return {
      entries: sortStandings(st.entrants).map((e, i) => ({
        pos: i + 1,
        name: e.name,
        color: e.color,
        points: e.points,
        isPlayer: e.isPlayer,
        isPlayerTwo: e.isPlayerTwo,
        time:
          totalTimeOf(e) !== null ? formatRaceTime(totalTimeOf(e)!) : "—",
        wins: e.wins,
      })),
    };
  }

  /**
   * ENTER on the title with the series toggle on: start a fresh championship
   * at race 0, or continue the stored one at its saved race index — either way
   * straight into that circuit's countdown without touching the title again.
   */
  function startSeriesRace(): void {
    if (!champ) {
      champ = {
        v: 1,
        raceIndex: 0,
        twoPlayer: world.twoPlayer,
        entrants: buildChampEntrants(),
      };
      storeChamp(champ);
    }
    syncChampP1Color();
    loadTrack(champ.raceIndex); // fixed order — never the title picker's pick
    beginCountdown();
  }

  /** Results-screen continue: next race's countdown, or the podium after #4. */
  function continueFromResults(): void {
    initAudio();
    if (!champ) {
      resetRace(); // single race: unchanged instant restart
      return;
    }
    if (champ.raceIndex >= TRACK_DEFS.length) {
      enterPodium();
    } else {
      loadTrack(champ.raceIndex);
      beginCountdown();
    }
  }

  /** Show the final standings and end the series (storage cleared here). */
  function enterPodium(): void {
    const st = champ;
    if (!st) {
      exitSeriesToTitle();
      return;
    }
    champ = null;
    clearChamp();
    setPhase("podium");
    screens.showPodium(buildPodiumView(st));
  }

  /** Abandon/leave any series context back to the title card. */
  function exitSeriesToTitle(): void {
    champ = null;
    clearChamp();
    screens.hideResults();
    screens.showTitle(); // also removes the podium overlay
    setPhase("title");
    titleCamera(0); // snap the orbit cam somewhere sane for the first frame
    loadTrack(champMode ? 0 : trackIndex); // preview race 1 / restore pick
    if (champMode) {
      // The series line must not keep pointing at a finished/abandoned race.
      screens.setChampRace(`RACE 1 OF ${TRACK_DEFS.length}`);
    }
  }

  /** Esc at an interstitial: abandon the series entirely. */
  function abandonChampionship(): void {
    exitSeriesToTitle();
    screens.toast("CHAMPIONSHIP ABANDONED");
  }

  /**
   * Title-screen V toggle. Blocked while a series is in progress — flipping
   * modes mid-series would corrupt the persisted roster/mode pairing.
   */
  function toggleChampMode(): void {
    if (world.phase !== "title") return;
    if (champ) {
      screens.toast("SERIES IN PROGRESS — FINISH OR ABANDON IT");
      return;
    }
    champMode = !champMode;
    storeChampMode(champMode);
    sfx.pickup();
    screens.setChampMode(champMode);
    if (champMode) {
      loadTrack(0); // series starts at the first circuit
      screens.setChampRace(`RACE 1 OF ${TRACK_DEFS.length}`);
    } else {
      screens.setChampRace(null);
      loadTrack(loadStoredTrackIndex()); // restore the single-race pick
    }
  }

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

  // --- Ghost Car (Phase 14) -----------------------------------------------------
  /**
   * Cosmetic replay of the player's (P1's) best lap per track. Recording and
   * storage mirror the best-times flow; playback is a translucent mesh that
   * never enters world.tanks, so collisions/AI/standings ignore it by
   * construction. In 2P the ghost always follows P1's line — P2 laps are NOT
   * recorded (one ghost per track keeps the minimap-free HUD clean and the
   * choice documented here).
   */

  /** localStorage key for the on/off toggle ("on" | "off"). */
  const GHOST_TOGGLE_KEY = "tankracer.ghost";

  function loadStoredGhostEnabled(): boolean {
    try {
      return localStorage.getItem(GHOST_TOGGLE_KEY) !== "off"; // default ON
    } catch {
      return true;
    }
  }

  function storeGhostEnabled(on: boolean): void {
    try {
      localStorage.setItem(GHOST_TOGGLE_KEY, on ? "on" : "off");
    } catch {
      /* private mode etc. — selection just won't persist */
    }
  }

  let ghostEnabled = loadStoredGhostEnabled();
  /** Ghost recording for the currently loaded track (null = none stored). */
  let ghostData: GhostRecording | null = null;

  const ghostRecorder = createGhostRecorder();
  const ghostPlayer = createGhostPlayer(scene);

  /** Title-screen G toggle: persists + refreshes the title card pill. */
  function toggleGhost(): void {
    if (world.phase !== "title") return;
    ghostEnabled = !ghostEnabled;
    storeGhostEnabled(ghostEnabled);
    screens.setGhost(ghostEnabled);
    sfx.pickup();
    if (!ghostEnabled) ghostPlayer.hide();
  }

  let trackIndex = loadStoredTrackIndex();
  let track!: Track; // assigned by loadTrack() below
  let powerups: Powerups; // rebuilt per track (crate spots come from the TrackDef)
  // Declared before the boot-time setPhase("title"): updateTouchControlsVisibility
  // reads it during init and a later `let` would be a TDZ crash.
  let paused = false;

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
    // Phase 15: championship previews/series tracks must not clobber the
    // user's persisted single-race pick.
    if (!champMode) storeTrackIndex(trackIndex);

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

    seatRacers();
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

    // Phase 14: ghosts are per-track — drop the old circuit's recording,
    // hide any playing mesh and load the new circuit's stored lap.
    ghostPlayer.hide();
    ghostData = loadGhost(def.id);
  }

  /** How many human tanks lead world.tanks (1 in 1P, P1+P2 in 2P). */
  function humanCount(): number {
    return world.twoPlayer ? 2 : 1;
  }

  /**
   * Seat every tank in world.tanks on the grid (humans first, AIs after),
   * rebuild progress records and AI brains. Used by loadTrack(), applyMode()
   * and resetRace() so all three paths seat tanks identically.
   */
  function seatRacers(): void {
    racers.length = 0;
    aiControllers.length = 0;
    const n = Math.min(GRID.length, world.tanks.length);
    for (let i = 0; i < n; i++) {
      placeTankAtGridSlot(world.tanks[i], track, GRID[i].t, GRID[i].lateral);
      resetTankCombat(world.tanks[i]);
      racers.push({
        tank: world.tanks[i],
        progress: createTankProgress(GRID[i].t),
        finishTime: null,
      });
    }
    // AI brains only for the slots behind the humans (Phase 13: 2 AI in 2P)
    for (let i = humanCount(); i < racers.length; i++) {
      aiControllers.push(
        createAIController(AI_PERSONALITIES[i - humanCount()], racers[i], track),
      );
    }
  }

  // --- Player tank + input --------------------------------------------------
  const player = createTankState(createTankMesh(), playerTankDef());
  scene.add(player.mesh.root);

  // Phase 13: P2's tank — fixed orange livery (BALANCED stats) so both humans
  // read instantly on screen and on the minimap. Created once; joins
  // world.tanks only while 2P mode is active.
  const player2 = createTankState(
    createTankMesh(P2_HULL_COLOR, P2_TURRET_COLOR),
  );
  player2.mesh.root.visible = false;
  scene.add(player2.mesh.root);

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
  // Declared before the boot-time applyMode() restore call, which fires the
  // onModeChange callback (a later `let` here would be a TDZ crash).
  let onModeChange: ((twoPlayer: boolean) => void) | null = null;

  // Phase 13: the third AI is benched (hidden + excluded) in 2P so the grid
  // stays at 4 tanks: P1, P2, then 2 AI.
  const aiTanks: TankState[] = [];

  const world: World = {
    tanks: [player],
    player,
    player2: null,
    twoPlayer: false,
    racers,
    standings: [],
    playerPosition: 1,
    playerPosition2: 1,
    track: null as unknown as Track, // set by loadTrack() immediately below
    phase: "title",
    raceTime: 0,
  };

  // --- AI opponents (meshes created once; loadTrack() re-seats them) ----------
  for (let i = 0; i < AI_PERSONALITIES.length && aiTanks.length < GRID.length - 1; i++) {
    const pers = AI_PERSONALITIES[i];
    const mesh = createTankMesh(pers.hullColor, pers.turretColor);
    const ai = createTankState(mesh);
    scene.add(ai.mesh.root);
    aiTanks.push(ai);
  }
  world.tanks = [player, ...aiTanks];

  // --- Weapons (audio/juice hooks wired here) ---------------------------------
  const juice = createJuice(scene);
  const weapons = createWeapons(scene, {
    onShot: () => sfx.shot(),
    onHit: (target) => {
      sfx.hit();
      juice.impactSparks(target.position.x, 1.2, target.position.z);
      if (target === player) rig1.shake = PLAYER_HIT_SHAKE;
      else if (target === player2) rig2.shake = PLAYER_HIT_SHAKE;
    },
    onWreck: (target) => {
      sfx.explosion();
      juice.wreckBurst(target.position.x, 0.5, target.position.z);
      if (target === player) rig1.shake = PLAYER_WRECK_SHAKE;
      else if (target === player2) rig2.shake = PLAYER_WRECK_SHAKE;
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
  screens.setGhost(ghostEnabled); // Phase 14: ghost pill reflects the toggle
  touchInput.attach(); // safe now: world + phase exist for the onEnable callback

  // Phase 13: restore the persisted mode. Touch and gamepad devices are
  // 1P-only, so a stored "2p" silently falls back to "1p" there.
  let wantedTwoPlayer = loadStoredTwoPlayer();
  if (wantedTwoPlayer && gamepadInput.connected) wantedTwoPlayer = false;
  if (wantedTwoPlayer && touchInput.enabled) wantedTwoPlayer = false;
  if (wantedTwoPlayer !== world.twoPlayer) {
    applyMode(wantedTwoPlayer);
  } else {
    screens.setMode(world.twoPlayer); // ensure the title card shows the mode
  }

  // Phase 15: restore the series toggle + any in-progress championship.
  // A stored series pins the mode (the roster was built for it), re-colors
  // P1's swatch to the persisted tank and previews the next race's circuit.
  champMode = loadStoredChampMode();
  screens.setChampMode(champMode);
  champ = loadChamp();
  if (champ && champ.raceIndex >= TRACK_DEFS.length) {
    // Refreshed between the last finish and its continue press — the series
    // is decided, so skip straight to the podium instead of a phantom race 5.
    enterPodium();
  } else if (champ) {
    if (champ.twoPlayer !== world.twoPlayer) applyMode(champ.twoPlayer);
    syncChampP1Color();
    loadTrack(champ.raceIndex);
    screens.setChampRace(
      `RACE ${champ.raceIndex + 1} OF ${TRACK_DEFS.length}`,
    );
  } else if (champMode) {
    loadTrack(0);
    screens.setChampRace(`RACE 1 OF ${TRACK_DEFS.length}`);
  }

  // --- Cameras -----------------------------------------------------------------
  // (camera + camera2 are created up top — needed by boot-time applyMode)
  let countdownClock = 0;
  let countdownStep = -1;
  let goHideTimer = 0;  // Phase 9: pause freezes the whole sim; dust-puff spawn timer lives here too.
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
      input.consumeFire2();
      touchInput.consumeFire();
      gamepadInput.consumeFire();
    }
    updateTouchControlsVisibility();
  }

  const CAM_DIST = 14;
  const CAM_HEIGHT = 7;

  let titleAngle = 0;

  /**
   * Per-camera chase state: smoothed position + independent screen shake
   * (each player feels their own hits/wrecks in their own half).
   */
  interface CamRig {
    camera: THREE.PerspectiveCamera;
    pos: THREE.Vector3;
    shake: number;
  }
  const rig1: CamRig = { camera, pos: new THREE.Vector3(), shake: 0 };
  const rig2: CamRig = { camera: camera2, pos: new THREE.Vector3(), shake: 0 };

  // Preallocated vectors — the chase camera runs every frame; no allocations.
  const camTarget = new THREE.Vector3();
  const fwdVec = new THREE.Vector3();
  const CAM_LIFT = new THREE.Vector3(0, CAM_HEIGHT, 0);

  /** Keep each active camera's aspect matched to its viewport (half in 2P). */
  function updateCameraAspects(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (world.twoPlayer) {
      const aspect = w / 2 / h;
      camera.aspect = aspect;
      camera2.aspect = aspect;
    } else {
      camera.aspect = w / h;
    }
    camera.updateProjectionMatrix();
    camera2.updateProjectionMatrix();
  }

  function snapChaseCameraRig(tank: TankState, rig: CamRig): void {
    fwdVec.set(Math.sin(tank.heading), 0, Math.cos(tank.heading));
    rig.pos
      .copy(tank.position)
      .addScaledVector(fwdVec, -CAM_DIST)
      .add(CAM_LIFT);
    rig.camera.position.copy(rig.pos);
    rig.camera.lookAt(tank.position.x, tank.position.y + 2, tank.position.z);
  }

  /** Snap both active chase cams (used at countdown start). */
  function snapChaseCamera(): void {
    snapChaseCameraRig(player, rig1);
    if (world.twoPlayer && world.player2) snapChaseCameraRig(world.player2, rig2);
  }

  function chaseCameraRig(tank: TankState, rig: CamRig, dt: number): void {
    fwdVec.set(Math.sin(tank.heading), 0, Math.cos(tank.heading));
    camTarget.copy(tank.position).addScaledVector(fwdVec, -CAM_DIST);
    camTarget.y += CAM_HEIGHT;
    // Frame-rate independent smoothing
    rig.pos.lerp(camTarget, 1 - Math.exp(-5 * dt));
    rig.camera.position.copy(rig.pos);

    // Screen-shake pulse (decays exponentially)
    const shake = rig.shake;
    if (shake > 0.002) {
      rig.camera.position.x += (Math.random() * 2 - 1) * shake;
      rig.camera.position.y += (Math.random() * 2 - 1) * shake * 0.6;
      rig.camera.position.z += (Math.random() * 2 - 1) * shake;
      rig.shake *= Math.exp(-SHAKE_DECAY * dt);
    }

    rig.camera.lookAt(tank.position.x, tank.position.y + 2, tank.position.z);

    // FOV kick while boosting — smooth toward the target, skip DOM-free no-ops
    const targetFov =
      BASE_FOV + (tank.boostTimer > 0 ? BOOST_FOV_KICK : 0);
    if (Math.abs(rig.camera.fov - targetFov) > 0.01) {
      rig.camera.fov += (targetFov - rig.camera.fov) * Math.min(1, 8 * dt);
      rig.camera.updateProjectionMatrix();
    }
  }

  /** Advance every active chase camera (P1 always; P2 too while in 2P). */
  function chaseCamera(dt: number): void {
    chaseCameraRig(player, rig1, dt);
    if (world.twoPlayer && world.player2) {
      chaseCameraRig(world.player2, rig2, dt);
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
    if (hud) {
      hud.style.display =
        phase === "title" || phase === "podium" ? "none" : "";
    }
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
    // Phase 14: fresh recording for this race; ghost (if stored + enabled)
    // rewinds to the line and starts replaying from GO.
    ghostRecorder.reset();
    if (ghostEnabled && ghostData) {
      ghostPlayer.begin(ghostData);
    } else {
      ghostPlayer.hide();
    }
    // Phase 13: "P1 vs P2" flavor in split-screen mode
    screens.showCountdownTag(
      world.twoPlayer ? "P1 VS P2 — READY" : `${playerTankDef().name} — READY`,
    );
    setPhase("countdown");
    snapChaseCamera(); // spec: snap straight to the chase cam on Enter
    // Drop any fire presses queued on the title/results screens (e.g. the
    // Enter press that started this race must not fire P2's cannon at GO).
    input.consumeFire();
    input.consumeFire2();
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

  // --- Mode management (Phase 13): local 1P vs 2P split-screen -----------------

  /**
   * Switch between 1P and 2P. Rebuilds the grid membership (P1, [P2,] AI…),
   * re-seats everyone, refreshes the title card + HUD layout and camera
   * aspects. Only ever invoked from the title screen, so no race state is
   * ever torn down mid-race.
   */
  function applyMode(twoPlayer: boolean): void {
    world.twoPlayer = twoPlayer;
    world.player2 = twoPlayer ? player2 : null;
    world.playerPosition2 = 1;
    input.setTwoPlayer(twoPlayer);
    storeMode(twoPlayer);

    if (twoPlayer) {
      // Grid stays at 4 tanks: P1, P2, then the first 2 AI. The third AI is
      // benched — hidden and excluded from shells/pickups/AI targeting.
      world.tanks = [player, player2, ...aiTanks.slice(0, 2)];
      aiTanks[2].mesh.root.visible = false;
    } else {
      world.tanks = [player, ...aiTanks];
      aiTanks[2].mesh.root.visible = true;
    }

    seatRacers(); // fresh grid + progress for the new roster
    weapons.reset(world); // stale shells referencing a benched tank
    juice.reset();
    powerups.reset();
    updateStandings(world);
    updateCameraAspects();
    screens.setMode(twoPlayer);
    onModeChange?.(twoPlayer);
  }

  /**
   * Title-screen toggle (key C / gamepad Y). Touch or gamepad devices are
   * single-player only: enabling 2P there shows a toast instead.
   */
  function toggleMode(): void {
    if (world.phase !== "title") return;
    // Phase 15: a live series pins 1P/2P — its roster was built for that mode.
    if (champ) {
      screens.toast("SERIES IN PROGRESS — FINISH OR ABANDON IT");
      return;
    }
    if (!world.twoPlayer) {
      if (gamepadInput.connected) {
        screens.toast("🎮 GAMEPAD ACTIVE — 1P ONLY");
        return;
      }
      if (touchInput.enabled) {
        screens.toast("TOUCH CONTROLS ACTIVE — 1P ONLY");
        return;
      }
      sfx.pickup();
    } else {
      sfx.pickup();
    }
    applyMode(!world.twoPlayer);
  }

  /** True if this tank is driven by a human (P1 always, P2 in 2P). */
  function isHumanTank(tank: TankState): boolean {
    return tank === player || (world.twoPlayer && tank === world.player2);
  }

  /** Display name for a human tank (banners/results). */
  function humanName(tank: TankState): string {
    if (tank === world.player2 && world.twoPlayer) return "P2";
    return world.twoPlayer ? "P1" : "YOU";
  }

  function finishRace(): void {
    setPhase("results");
    stopMusic(); // duck the loop out under the results screen
    // Phase 13: every HUMAN finisher is eligible for best times — in 2P both
    // players' best laps and totals are compared against the stored records.
    const best = loadBestTimes(track.def.id);
    const prevStoredLap = best.lap; // Phase 14: ghost eligibility baseline
    const newBest: NewBest = { lap: false, total: false };
    for (const racer of world.racers) {
      if (!isHumanTank(racer.tank)) continue;
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
    }
    if (newBest.lap || newBest.total) storeBestTimes(track.def.id, best);

    // Phase 14: store P1's recorded lap when it beat what was previously on
    // disk (P1-only by design — the ghost always replays P1's line, even in
    // 2P where P2 may hold the actual best-lap record). Reload so the next
    // race immediately replays the fresh recording.
    if (
      ghostRecorder.bestSamples &&
      ghostRecorder.bestTime !== null &&
      (prevStoredLap === null || ghostRecorder.bestTime < prevStoredLap)
    ) {
      storeGhost(track.def.id, {
        v: GHOST_FORMAT_VERSION,
        lap: ghostRecorder.bestTime,
        samples: ghostRecorder.bestSamples,
      });
      ghostData = loadGhost(track.def.id);
    }

    // Phase 15: championship scoring — points/wins/times recorded BEFORE the
    // overlay builds so the standings sidebar reflects this race's awards.
    const champView = champ ? recordChampRace(finishingOrder()) : undefined;

    screens.showResults(buildResultRows(), track.def.name, newBest, champView);
  }

  /** Finished racers by time, then unfinished by track progress. */
  function finishingOrder(): Racer[] {
    return world.racers.slice().sort((a, b) => {
      if (a.finishTime !== null && b.finishTime !== null) {
        return a.finishTime - b.finishTime;
      }
      if (a.finishTime !== null) return -1;
      if (b.finishTime !== null) return 1;
      return b.progress.totalProgress - a.progress.totalProgress;
    });
  }

  function buildResultRows() {
    const order = finishingOrder();
    const humans = humanCount();
    return order.map((racer) => {
      const isP1 = racer.tank === player;
      const isP2 = world.twoPlayer && racer.tank === world.player2;
      const ai = AI_PERSONALITIES[world.racers.indexOf(racer) - humans];
      let name: string;
      let color: string;
      if (isP1) {
        name = humanName(player);
        color = hexColor(playerTankDef().hullColor); // tracks the selected tank
      } else if (isP2) {
        name = "P2";
        color = hexColor(P2_HULL_COLOR);
      } else {
        name = ai?.name ?? "???";
        color =
          ai != null
            ? `#${ai.hullColor.toString(16).padStart(6, "0")}`
            : "#888888";
      }
      return {
        name,
        color,
        isPlayer: isP1,
        isPlayerTwo: isP2, // Phase 13: P2's row highlighted orange
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
    // Phase 14: a P1 lap just completed — keep its recording if it's the
    // best one driven this race (P2 laps are never recorded; see above).
    if (tank === player) ghostRecorder.completeLap();
    const prog = racer.progress;
    if (prog.lap > TOTAL_LAPS) {
      if (racer.finishTime === null) racer.finishTime = world.raceTime;
      if (isHumanTank(tank)) {
        // Phase 13: results wait until EVERY human has finished, so both
        // players' total/best-lap times make it onto the results screen.
        const pending = world.racers.filter(
          (r) => isHumanTank(r.tank) && r.finishTime === null,
        ).length;
        if (pending === 0) {
          finishRace();
        } else {
          screens.flashBanner(`${humanName(tank)} FINISHED!`);
        }
      }
    } else if (isHumanTank(tank) && prog.lap === TOTAL_LAPS) {
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
   * Phase 13: world.tanks is humans-first — P1 (and P2 in 2P) read their own
   * inputs; everything after them is AI.
   */
  function simulate(dt: number, driving: boolean): void {
    const p2 = world.player2;
    player.input = driving ? readPlayerInput() : NO_INPUT;
    if (world.twoPlayer && p2) p2.input = driving ? input.read2() : NO_INPUT;

    // Always drain the fire queues so presses never leak across frames/phases
    const kbFire = input.consumeFire();
    const kb2Fire = input.consumeFire2();
    const touchFire = touchInput.consumeFire();
    const padFire = gamepadInput.consumeFire();
    if (driving) {
      if (kbFire || touchFire || padFire) weapons.tryFire(player);
      if (world.twoPlayer && p2 && kb2Fire) weapons.tryFire(p2);
    }

    const humans = humanCount();
    for (let i = 0; i < world.tanks.length; i++) {
      const tank = world.tanks[i];
      if (driving && i >= humans) {
        // AI brains produce the same input shape as the player's keyboard
        const d = aiControllers[i - humans].think(dt, world);
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
      if (
        checkBoostPads(track, tank) &&
        (tank === player || (world.twoPlayer && tank === p2))
      ) {
        sfx.boost();
      }
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
    if (driving) {
      // Phase 14: sample P1's line every ~100ms. Lap-relative timing is the
      // recorder's own dt accumulator, reset by completeLap() at each lap
      // event above — immune to progress-reset ordering.
      ghostRecorder.observe(dt, player.position.x, player.position.z, player.heading);
      updateStandings(world);
    }
    // Phase 14: cosmetic replay — advances only while the sim runs, so pause
    // freezes it too. No physics interaction: the mesh is never a TankState.
    ghostPlayer.update(dt);
    updateBoostPads(track, dt);
    // Shell movement/hits + wreck timers → respawn
    weapons.update(world, dt);
    // Dust/sparks/burst particles
    juice.update(dt);
    // Crate animation, pickups, shield bubbles
    powerups.update(world, dt);
    chaseCamera(dt);
    // Keep shadow frustum centered on the action — between both players in 2P
    if (world.twoPlayer && p2) {
      const mx = (player.position.x + p2.position.x) / 2;
      const mz = (player.position.z + p2.position.z) / 2;
      sun.position.set(mx + 60, 90, mz + 40);
      sun.target.position.set(mx, 0, mz);
    } else {
      sun.position.set(player.position.x + 60, 90, player.position.z + 40);
      sun.target.position.copy(player.position);
    }
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
      if (world.phase === "race") {
        setPaused(!paused);
      } else if (world.phase === "podium") {
        // Phase 15: leave the finished series' podium for the title.
        exitSeriesToTitle();
      } else if (world.phase === "results" && champ) {
        // Phase 15: Esc at a championship interstitial abandons the series.
        // Single-race results are untouched — Esc keeps doing nothing there.
        abandonChampionship();
      }
      return;
    }
    // Restart from pause: unfreeze first so the countdown runs on live audio
    if (e.code === "KeyR" && paused) {
      setPaused(false);
      resetRace();
      return;
    }
    // Phase 13/14/15: C toggles 1P/2P, G the ghost replay, V single/champ
    if (e.code === "KeyC" && world.phase === "title") {
      toggleMode();
      return;
    }
    if (e.code === "KeyG" && world.phase === "title") {
      toggleGhost();
      return;
    }
    if (e.code === "KeyV" && world.phase === "title") {
      toggleChampMode();
      return;
    }
    // Title screen: LEFT/RIGHT cycles circuits (Phase 6), UP/DOWN tanks (Phase 7).
    // Phase 15: the track picker is inert in championship mode (fixed order).
    if (world.phase === "title") {
      if (!champMode && e.code === "ArrowLeft") {
        sfx.pickup();
        loadTrack(trackIndex - 1);
        return;
      }
      if (!champMode && e.code === "ArrowRight") {
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
    // Podium: Enter/R returns to the title (Esc handled above)
    if (
      (e.code === "Enter" || e.code === "KeyR") &&
      world.phase === "podium"
    ) {
      exitSeriesToTitle();
    } else if (e.code === "Enter" && world.phase === "title") {
      initAudio(); // first user gesture unlocks WebAudio
      if (champMode) startSeriesRace();
      else beginCountdown();
    } else if (
      world.phase === "results" &&
      (e.code === "KeyR" || e.code === "Enter")
    ) {
      // Phase 15: next race in a series (Enter or R), else the unchanged
      // single-race instant restart (R only — Enter stays inert in 1 race).
      if (e.code === "Enter" && !champ) return;
      continueFromResults();
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
      if (action === "mode") {
        // Phase 13: Y = key C equivalent (1P/2P toggle; blocked with a toast
        // while a gamepad is connected, handled inside toggleMode).
        toggleMode();
      } else if (action === "left") {
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
        if (champMode) startSeriesRace();
        else beginCountdown();
      }
    } else if (world.phase === "podium" && action === "confirm") {
      exitSeriesToTitle(); // A = Enter equivalent on the podium
    } else if (world.phase === "results" && action === "confirm") {
      continueFromResults(); // A = R equivalent on results
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
    const target = e.target as HTMLElement | null;
    if (target?.closest("#touch-controls")) return; // button press, not a screen tap
    // Phase 15: the podium is dismissed by ANY click (spec: key/click → title),
    // not just touch-mode taps.
    if (world.phase === "podium") {
      exitSeriesToTitle();
      return;
    }
    if (!touchInput.enabled) return;
    if (world.phase === "title") {
      initAudio(); // same unlock as the Enter path
      if (champMode) startSeriesRace();
      else beginCountdown();
    } else if (world.phase === "results") {
      continueFromResults();
    }
  };
  window.addEventListener("pointerdown", onPointerDown);

  return {
    world,
    // Dev/debug handle: lets headless smoke tests read race state (not used
    // by the game itself).
    worldRef: world,
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
                  world.twoPlayer ? "P1 VS P2 — GO!" : `${playerTankDef().name} — GO!`,
                ); // Phase 7/13
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
        case "podium":
          // Phase 15: slow orbit behind the final standings card.
          titleCamera(dt);
          break;
      }
    },
    render() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Phase 13: split-screen — P1 left half, P2 right half, one render pass
      // per camera. Title + podium always use the single full-screen orbit cam.
      if (!world.twoPlayer || world.phase === "title" || world.phase === "podium") {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
        renderer.render(scene, camera);
        return;
      }
      // Viewport/scissor are in CSS pixels — the renderer scales them by the
      // pixel ratio internally. With scissor test on, each pass clears only
      // its own half, so no bleed-over between views.
      const half = Math.floor(w / 2);
      renderer.setScissorTest(true);

      renderer.setViewport(0, 0, half, h); // P1
      renderer.setScissor(0, 0, half, h);
      renderer.render(scene, camera);

      renderer.setViewport(half, 0, w - half, h); // P2
      renderer.setScissor(half, 0, w - half, h);
      renderer.render(scene, camera2);

      renderer.setScissorTest(false);
    },
    onResize() {
      updateCameraAspects(); // half-width aspects while in 2P
      renderer.setSize(window.innerWidth, window.innerHeight);
    },
    setOnModeChange(cb) {
      onModeChange = cb;
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
  // Phase 13: second human's position (HUD reads it in 2P only)
  if (world.racers[1]) {
    world.playerPosition2 = sorted.indexOf(world.racers[1]) + 1;
  }
}
