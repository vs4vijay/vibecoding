import * as THREE from "three";
import {
  createTankMesh,
  createTankState,
  HULL_COLOR,
  MAX_SPEED,
  MAX_HP,
  updateTankPhysics,
  type TankInput,
  type TankState,
} from "./tank";
import { PlayerInput } from "./player";
import { closestOnSpline } from "./spline";
import {
  checkBoostPads,
  collideWithWalls,
  createTankProgress,
  createTrack,
  placeTankAtGridSlot,
  TOTAL_LAPS,
  updateBoostPads,
  updateTankProgress,
  type ProgressEvent,
  type Track,
} from "./track";
import { createWeapons } from "./weapons";
import { createPowerups } from "./powerups";
import { AI_PERSONALITIES, createAIController, type AIController } from "./ai";
import { createScreens, formatRaceTime } from "./screens";
import { initAudio, sfx, toggleMute, updateEngine } from "./audio";

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
  scene.background = new THREE.Color(0x7ec8f0); // bright desert sky
  scene.fog = new THREE.Fog(0x7ec8f0, 120, 420);

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

  // --- Track: road, walls, dashes, dressing, boost pads ---------------------
  const track = createTrack();
  scene.add(track.group);

  /** Display name + swatch color per racer index (player first) — results UI. */
  const roster = [
    { name: "YOU", color: `#${HULL_COLOR.toString(16).padStart(6, "0")}` },
    ...AI_PERSONALITIES.map((p) => ({
      name: p.name,
      color: `#${p.hullColor.toString(16).padStart(6, "0")}`,
    })),
  ];

  // --- Player tank + input --------------------------------------------------
  const player = createTankState(createTankMesh());
  placeTankAtGridSlot(player, track, GRID[0].t, GRID[0].lateral);
  scene.add(player.mesh.root);

  const input = new PlayerInput();
  input.attach();

  const racers: Racer[] = [{ tank: player, progress: createTankProgress(GRID[0].t), finishTime: null }];
  const world: World = {
    tanks: [player],
    player,
    racers,
    standings: racers.slice(),
    playerPosition: 1,
    track,
    phase: "title",
    raceTime: 0,
  };

  // --- AI opponents ----------------------------------------------------------
  const aiControllers: AIController[] = [];
  for (let i = 1; i < GRID.length && i <= AI_PERSONALITIES.length; i++) {
    const pers = AI_PERSONALITIES[i - 1];
    const slot = GRID[i];
    const mesh = createTankMesh(pers.hullColor, pers.turretColor);
    const ai = createTankState(mesh);
    placeTankAtGridSlot(ai, track, slot.t, slot.lateral);
    scene.add(ai.mesh.root);
    world.tanks.push(ai);
    const racer: Racer = { tank: ai, progress: createTankProgress(slot.t), finishTime: null };
    racers.push(racer);
    aiControllers.push(createAIController(pers, racer, track));
  }

  // --- Weapons + power-up systems (audio/juice hooks wired here) --------------
  const weapons = createWeapons(scene, {
    onShot: () => sfx.shot(),
    onHit: (target) => {
      sfx.hit();
      if (target === player) shake = PLAYER_HIT_SHAKE;
    },
    onWreck: (target) => {
      sfx.explosion();
      if (target === player) shake = PLAYER_WRECK_SHAKE;
    },
  });
  const powerups = createPowerups(scene, track.points, {
    onPickup: (_tank, kind) => {
      if (kind === "boost") sfx.boost();
      else sfx.pickup();
    },
  });

  // --- Screens overlay ---------------------------------------------------------
  const screens = createScreens();
  screens.showTitle();
  setPhase("title"); // hoisted function decl; hides the HUD behind the title card

  // --- Cameras -----------------------------------------------------------------
  let shake = 0;
  let countdownClock = 0;
  let countdownStep = -1;
  let goHideTimer = 0;

  const camera = new THREE.PerspectiveCamera(
    BASE_FOV,
    window.innerWidth / window.innerHeight,
    0.5,
    1000,
  );
  const CAM_DIST = 14;
  const CAM_HEIGHT = 7;

  // Track centroid for the slow title-screen orbit
  let centerX = 0;
  let centerZ = 0;
  for (const p of track.points) {
    centerX += p.x;
    centerZ += p.z;
  }
  centerX /= track.points.length;
  centerZ /= track.points.length;
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
  }

  function beginCountdown(): void {
    countdownClock = 0;
    countdownStep = -1;
    goHideTimer = 0;
    screens.hideResults();
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
    powerups.reset(); // crates back up, bubbles hidden
    world.raceTime = 0;
    updateStandings(world);
    beginCountdown();
  }

  function resetTankCombat(tank: TankState): void {
    tank.hp = MAX_HP;
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
    screens.showResults(buildResultRows());
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
      return {
        name: roster[idx]?.name ?? "???",
        color: roster[idx]?.color ?? "#888888",
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
   * One simulated race frame. `driving=false` freezes everyone's inputs
   * (countdown coast-in / post-finish freeze); physics and FX keep running.
   */
  function simulate(dt: number, driving: boolean): void {
    player.input = driving ? input.read() : NO_INPUT;
    const firePressed = input.consumeFire(); // always drain queued shots
    if (driving && firePressed) weapons.tryFire(player);

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
      updateTankPhysics(tank, dt);
      collideWithWalls(track, tank);
      if (checkBoostPads(track, tank) && tank === player) sfx.boost();
      // Progress: closest point on the centerline drives gates/laps.
      // Frozen once the race is over so times stay exactly as displayed.
      if (driving) {
        const hit = closestT(track, tank);
        handleProgressEvent(
          tank,
          racers[i],
          updateTankProgress(racers[i].progress, hit, dt),
        );
      }
    }
    if (driving) updateStandings(world);
    updateBoostPads(track, dt);
    // Shell movement/hits + wreck timers → respawn
    weapons.update(world, dt);
    // Crate animation, pickups, shield bubbles
    powerups.update(world, dt);
    chaseCamera(dt);
    // Keep shadow frustum centered on the action
    sun.position.set(player.position.x + 60, 90, player.position.z + 40);
    sun.target.position.copy(player.position);
  }

  // --- Global keys: Enter (start), R (restart), M (mute) -----------------------
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === "KeyM") {
      const muted = toggleMute();
      screens.toast(muted ? "SOUND OFF" : "SOUND ON");
      return;
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

  return {
    world,
    update(dt: number) {
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
      input.detach();
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
