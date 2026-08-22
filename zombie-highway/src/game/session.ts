import type * as THREE from "three";
import { CONFIG } from "../config";
import { Emitter } from "../core/emitter";
import { createCarMesh, updateCarMesh } from "../render/carMesh";
import type { CarMesh } from "../render/carMesh";
import { Fx } from "../render/fx";
import {
  createObstacleMeshes,
  resetObstacleMeshes,
  syncObstacleMeshes,
} from "../render/obstacleMesh";
import type { ObstacleBindings } from "../render/obstacleMesh";
import {
  createZombieMeshes,
  resetZombieMeshes,
  updateZombieMeshes,
} from "../render/zombieMesh";
import type { ZombieBindings } from "../render/zombieMesh";
import type { CarSide, CarState } from "./car";
import { createCar, stepCar } from "./car";
import { fireGun } from "./combat";
import type { Knobs } from "./difficulty";
import { knobsForLevel, levelForScore } from "./difficulty";
import type { ObstacleKind } from "./obstacles";
import { ObstaclePool, classifyContact } from "./obstacles";
import { Scoring } from "./scoring";
import { Spawner } from "./spawner";
import type { ZombieSide, ZombieUpdateCtx } from "./zombies";
import { ZombiePool } from "./zombies";

export type Phase = "title" | "running" | "paused" | "over";

export type GameEvents = {
  levelUp: [level: number];
  gameOver: [
    stats: {
      score: number;
      distanceM: number;
      kills: number;
      level: number;
      cause: "flip" | "crash";
    },
  ];
  scrape: [side: "left" | "right"];
  shot: [side: "left" | "right"];
  kill: [type: string, viaScrape: boolean];
  /** A leaper landed and latched onto the hull. */
  attach: [side: "left" | "right"];
};

/**
 * Minimal input surface: satisfied by InputController and by headless test
 * doubles ({ steer, onFire, onPause }).
 */
export interface SessionInput {
  steer: number;
  onFire(cb: (side: "left" | "right") => void): () => void;
  onPause(cb: () => void): () => void;
}

/**
 * Render sink: the three.js scene meshes attach to, plus optional camera
 * quaternion for billboarding and a screen-shake sink (CameraRig.shake).
 * Null keeps the whole simulation headless.
 */
export type SceneRenderer = {
  scene: THREE.Scene;
  camera?: THREE.PerspectiveCamera;
  shake?(intensity: number): void;
};

export type SessionDeps = {
  input?: SessionInput | null;
  emitter?: Emitter<GameEvents> | null;
  render?: SceneRenderer | null;
  /** Seed for the spawner RNG; omit for randomized runs. */
  seed?: number;
};

type GunState = { mag: number; reloadT: number };

type RenderView = {
  car: CarMesh;
  zombies: ZombieBindings;
  obstacles: ObstacleBindings;
  fx: Fx;
};

const DEATH_CAM_SCALE = 0.35;
const LEVELUP_SCALE = 0.6;
const LEVELUP_SLOW_S = 0.5;
/** speed01 normalization window for the chase-camera fov kick. */
const SPEED01_MIN = 12;
const SPEED01_MAX = 52;
/** Graze penalty floors at the same speed the rail scrape uses. */
const MIN_SPEED_AFTER_SCRAPE = 12;
/** Contact scan window around the car (covers wreck halfD 2.2 + car length). */
const CONTACT_WINDOW_M = 8;
const FX_RED = 0xa11212;
const FX_GOLD = 0xffd166;

const MAX_STEPS_PER_FRAME = Math.ceil(CONFIG.sim.maxFrameDt / CONFIG.sim.dt);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Fixed-step game orchestrator: wires car, zombies, spawner, obstacles,
 * scoring and guns into a deterministic 60 Hz simulation, and binds pooled
 * meshes + particle fx to the render scene when one is provided.
 *
 * Per fixed step: input -> stepCar -> zombies -> spawner -> obstacle contacts
 * -> weight sync -> gun fire edges -> scoring/level. Deaths stop the rest of
 * the step and drop into a 0.35x death cam.
 */
export class Session {
  phase: Phase = "title";
  car: CarState;
  zombies: ZombiePool;
  obstacles: ObstaclePool;
  scoring = new Scoring();
  spawner: Spawner;
  knobs: Knobs = knobsForLevel(1);
  /** Slow-mo multiplier applied to accumulated sim time this frame. */
  timescale = 1;
  /** Fixed steps executed by the last update() call (test observability). */
  stepsLastFrame = 0;
  gun: { left: GunState; right: GunState } = {
    left: { mag: CONFIG.gun.magSize, reloadT: 0 },
    right: { mag: CONFIG.gun.magSize, reloadT: 0 },
  };

  private readonly emitter: Emitter<GameEvents>;
  private readonly depsInput: SessionInput | null;
  private readonly render: SceneRenderer | null;
  private view: RenderView | null = null;
  private readonly offs: Array<() => void> = [];
  private visibilityHandler: (() => void) | null = null;

  /** World z of the car (CarState only tracks the lateral axis). */
  private carZ = 0;
  private acc = 0;
  private simTime = 0;
  private slowmoT = 0;
  private distAccum = 0;
  /** Debug/test weight injected on top of attached clingers. */
  private bonusWeight = { left: 0, right: 0 };
  private fireCd = { left: 0, right: 0 };
  /** Per-obstacle graze cooldown keyed by pooled obstacle object. */
  private grazeCd = new Map<
    { x: number },
    number
  >();
  private pendingShots: ZombieSide[] = [];

  // Preallocated per-step contexts: zero steady-state allocation.
  private readonly zctx: ZombieUpdateCtx = {
    carX: 0,
    carVx: 0,
    carZ: 0,
    accuracy: 0,
    carSpeed: 0,
    onAttach: (side) => this.emitter.emit("attach", side),
  };
  private readonly sctx = {
    carX: 0,
    carZ: 0,
    knobs: this.knobs,
  };

  constructor(deps: SessionDeps = {}) {
    this.emitter = deps.emitter ?? new Emitter<GameEvents>();
    this.depsInput = deps.input ?? null;
    this.render = deps.render ?? null;
    const rng = mulberry32(deps.seed ?? ((Math.random() * 0x100000000) >>> 0));
    this.car = createCar(this.knobs.cruiseSpeed);
    this.zombies = new ZombiePool();
    this.obstacles = new ObstaclePool();
    this.spawner = new Spawner(this.zombies, this.obstacles, rng);

    if (this.depsInput) {
      this.offs.push(
        this.depsInput.onFire((side) => {
          if (this.phase === "running") this.pendingShots.push(side);
        }),
      );
      this.offs.push(this.depsInput.onPause(() => this.togglePause()));
    }
    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.hidden && this.phase === "running") this.togglePause();
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    if (this.render) this.attachRender(this.render);
  }

  get carZValue(): number {
    return this.carZ;
  }

  get level(): number {
    return this.knobs.level;
  }

  /** Normalized speed for the chase-camera fov kick. */
  get speed01(): number {
    return clamp(
      (this.car.speed - SPEED01_MIN) / (SPEED01_MAX - SPEED01_MIN),
      0,
      1,
    );
  }

  get activeZombieCount(): number {
    let n = 0;
    for (const _z of this.zombies.all()) {
      void _z;
      n++;
    }
    return n;
  }

  get obstacleCount(): number {
    let n = 0;
    this.obstacles.forEachNear(this.carZ - 1000, this.carZ + 1000, () => n++);
    return n;
  }

  /** Full reset into a fresh run; touches only preallocated pools. */
  startRun(): void {
    this.knobs = knobsForLevel(1);
    const c = this.car;
    c.x = 0;
    c.vx = 0;
    c.speed = c.cruiseSpeed * 0.85;
    c.tilt = 0;
    c.leftWeight = 0;
    c.rightWeight = 0;
    c.flipTimer = 0;
    c.alive = true;
    c.scrapeCooldown = 0;
    c.cruiseSpeed = this.knobs.cruiseSpeed;
    this.zombies.reset();
    this.obstacles.reset();
    this.spawner.reset();
    this.scoring.reset();
    for (const side of ["left", "right"] as const) {
      this.gun[side].mag = CONFIG.gun.magSize;
      this.gun[side].reloadT = 0;
      this.fireCd[side] = 0;
    }
    this.pendingShots.length = 0;
    this.grazeCd.clear();
    this.bonusWeight.left = 0;
    this.bonusWeight.right = 0;
    this.carZ = 0;
    this.acc = 0;
    this.simTime = 0;
    this.slowmoT = 0;
    this.distAccum = 0;
    this.timescale = 1;
    this.phase = "running";
    if (this.view) {
      resetZombieMeshes(this.view.zombies);
      resetObstacleMeshes(this.view.obstacles);
      this.view.fx.clear();
    }
  }

  update(dtWall: number): void {
    if (this.phase === "title" || this.phase === "paused") return;
    const dtW = clamp(dtWall, 0, CONFIG.sim.maxFrameDt);

    if (this.slowmoT > 0) {
      this.slowmoT = Math.max(0, this.slowmoT - dtW);
      this.timescale = LEVELUP_SCALE;
    } else {
      this.timescale =
        this.phase === "over" ? DEATH_CAM_SCALE : 1;
    }

    this.acc += dtW * this.timescale;
    let steps = 0;
    while (this.acc >= CONFIG.sim.dt && steps < MAX_STEPS_PER_FRAME) {
      this.acc -= CONFIG.sim.dt;
      steps++;
      this.step(CONFIG.sim.dt);
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0; // anti spiral-of-death
    this.stepsLastFrame = steps;

    this.syncVisuals(dtW * this.timescale);
  }

  togglePause(): void {
    if (this.phase === "running") {
      this.phase = "paused";
      this.acc = 0;
    } else if (this.phase === "paused") {
      this.phase = "running";
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  // --- test/debug hooks ----------------------------------------------------

  /** Injects hull weight that persists on top of attached clingers. */
  addWeight(side: "left" | "right", w: number): void {
    this.bonusWeight[side] += w;
    if (side === "left") this.car.leftWeight += w;
    else this.car.rightWeight += w;
  }

  debugAddScore(points: number): void {
    this.scoring.score += points;
    this.refreshLevel();
  }

  spawnObstacleForTest(kind: ObstacleKind, x: number, z: number): void {
    this.obstacles.spawn(kind, x, z);
  }

  // --- simulation ----------------------------------------------------------

  private step(dt: number): void {
    this.simTime += dt;

    if (this.phase === "over") {
      // Death cam: corpses tumble at 0.35x; the wreck stays put.
      this.zctx.carX = this.car.x;
      this.zctx.carVx = 0;
      this.zctx.carZ = this.carZ;
      this.zctx.accuracy = 0;
      this.zctx.carSpeed = 0;
      this.zombies.update(dt, this.zctx);
      return;
    }

    // 1) car
    const events = stepCar(this.car, this.depsInput?.steer ?? 0, dt);
    for (const ev of events) {
      if (ev.kind === "flipped") {
        this.gameOver("flip");
        return; // stop stepping further this run
      }
      this.emitter.emit("scrape", ev.side);
      this.render?.shake?.(0.15);
      this.view?.fx.burst(
        this.car.x + (ev.side === "left" ? -1 : 1),
        0.5,
        this.carZ,
        FX_GOLD,
        10,
      );
    }
    this.carZ += this.car.speed * dt;

    // 2) zombies
    this.zctx.carX = this.car.x;
    this.zctx.carVx = this.car.vx;
    this.zctx.carZ = this.carZ;
    this.zctx.accuracy = this.knobs.leapAccuracy;
    this.zctx.carSpeed = this.car.speed;
    this.zombies.update(dt, this.zctx);

    // 3) spawner
    this.sctx.carX = this.car.x;
    this.sctx.carZ = this.carZ;
    this.sctx.knobs = this.knobs;
    this.spawner.update(dt, this.sctx);

    // 4) obstacle contacts near the car
    let crashed = false;
    this.obstacles.forEachNear(
      this.carZ - CONTACT_WINDOW_M,
      this.carZ + CONTACT_WINDOW_M,
      (o) => {
        if (crashed) return;
        const contact = classifyContact(o, this.car.x, this.carZ);
        if (contact === "headOn") {
          crashed = true;
          this.gameOver("crash");
          return;
        }
        if (contact === "graze") this.applyGraze(o);
      },
    );
    if (crashed) return;

    // 5) weight sync (absolute set from clingers + injected bonus)
    const w = this.zombies.attachedWeight(this.car.x);
    this.car.leftWeight = w.left + this.bonusWeight.left;
    this.car.rightWeight = w.right + this.bonusWeight.right;
    // Flip surfaces as a stepCar event at the top of the next step.

    // 6) gun fire edges
    this.consumeShotEdges();

    // 7) scoring: floor whole meters so the score stays integral
    this.distAccum += this.car.speed * dt;
    const whole = Math.floor(this.distAccum);
    if (whole >= 1) {
      this.scoring.addDistance(whole);
      this.distAccum -= whole;
    }
    this.scoring.update(dt);
    this.refreshLevel();
  }

  private applyGraze(o: {
    x: number;
  }): void {
    // One scrape tick per obstacle per scrapeTickS — same cadence as car.ts
    // rail scrapes — so a long lateral grind multi-ticks instead of firing
    // every single step.
    if (this.simTime < (this.grazeCd.get(o) ?? 0)) return;
    this.grazeCd.set(o, this.simTime + CONFIG.car.scrapeTickS);
    const side: CarSide = o.x < this.car.x ? "left" : "right";
    this.car.speed = Math.max(
      MIN_SPEED_AFTER_SCRAPE,
      this.car.speed - CONFIG.car.scrapeSpeedLoss,
    );
    this.emitter.emit("scrape", side);
    this.render?.shake?.(0.15);
    this.view?.fx.burst(
      this.car.x + (side === "left" ? -1 : 1),
      0.5,
      this.carZ,
      FX_GOLD,
      10,
    );
    for (const z of this.zombies.scrapeSide(side)) {
      this.registerKill(z.type, true, z.x, z.z);
    }
  }

  private consumeShotEdges(): void {
    for (const side of ["left", "right"] as const) {
      const g = this.gun[side];
      if (g.reloadT > 0) g.reloadT -= CONFIG.sim.dt;
      if (this.fireCd[side] > 0) this.fireCd[side] -= CONFIG.sim.dt;
    }
    while (this.pendingShots.length > 0) {
      const side = this.pendingShots.shift() as ZombieSide;
      const g = this.gun[side];
      // Reload gate first: empty/mid-reload pulls (re)arm the timer, no event.
      if (g.mag <= 0 || g.reloadT > 0) {
        g.reloadT = CONFIG.gun.reloadS;
        continue;
      }
      if (this.fireCd[side] > 0) continue;
      this.fireCd[side] = CONFIG.gun.fireIntervalS;
      this.emitter.emit("shot", side);
      this.view?.fx.muzzleFlash(
        this.car.x + (side === "left" ? -0.75 : 0.75),
        0.7,
        this.carZ + 2.2,
      );
      const res = fireGun(side, this.zombies, this.gun[side], {
        carX: this.car.x,
        carZ: this.carZ,
      });
      if (res.killed) {
        this.registerKill(res.killed.type, false, res.killed.x, res.killed.z);
      }
    }
  }

  private registerKill(
    type: string,
    viaScrape: boolean,
    wx: number,
    wz: number,
  ): void {
    this.scoring.registerKill(
      type as "walker" | "runner" | "brute",
      viaScrape,
    );
    this.emitter.emit("kill", type, viaScrape);
    this.render?.shake?.(0.1);
    this.view?.fx.burst(wx, 0.9, wz, FX_RED, 10);
  }

  private refreshLevel(): void {
    const lvl = levelForScore(this.scoring.score);
    if (lvl === this.knobs.level) return;
    this.knobs = knobsForLevel(lvl);
    this.sctx.knobs = this.knobs;
    this.car.cruiseSpeed = this.knobs.cruiseSpeed;
    this.slowmoT = LEVELUP_SLOW_S;
    this.timescale = LEVELUP_SCALE;
    this.emitter.emit("levelUp", lvl);
  }

  private gameOver(cause: "flip" | "crash"): void {
    if (this.phase === "over") return;
    this.car.alive = false;
    this.phase = "over";
    this.timescale = DEATH_CAM_SCALE;
    this.emitter.emit("gameOver", {
      score: this.scoring.score,
      distanceM: this.scoring.distanceM,
      kills: this.scoring.kills,
      level: this.knobs.level,
      cause,
    });
    this.render?.shake?.(0.5);
    this.view?.fx.burst(this.car.x, 0.8, this.carZ, FX_RED, 10);
  }

  // --- rendering -----------------------------------------------------------

  private attachRender(render: SceneRenderer): void {
    const car = createCarMesh(render.scene);
    const zombies = createZombieMeshes(render.scene, this.zombies.slotCount());
    const obstacles = createObstacleMeshes(
      render.scene,
      this.obstacles.slotCount(),
    );
    const fx = new Fx(render.scene, render.camera?.quaternion ?? null);
    this.view = { car, zombies, obstacles, fx };
  }

  private syncVisuals(dt: number): void {
    const v = this.view;
    if (!v) return;
    updateCarMesh(v.car, this.car, this.carZ, dt);
    updateZombieMeshes(v.zombies, this.zombies, this.car.x, this.carZ, this.simTime);
    syncObstacleMeshes(v.obstacles, this.obstacles, this.carZ);
    v.fx.update(dt);
  }
}
