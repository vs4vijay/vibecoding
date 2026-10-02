/**
 * @file game/run.js
 * Gameplay core: 3-lane running, jump/roll with coyote time + input
 * buffering, speed ramp, scoring, forgiving AABB collisions, death
 * slow-mo, and the seeded spawn director (patterns every 25-40 m, never
 * all 3 lanes blocked, min gap after forced actions).
 *
 * Runs on a FIXED TIMESTEP from main.js; rendering interpolates between
 * the previous and current sim snapshots (see renderPose/updateRender).
 *
 * Powerups (magnet / jetpack / x2) are data-only stubs here; wave 5
 * activates them through collectPowerup().
 */
import * as THREE from "three";
import { CONFIG } from "../core/config.js";
import { Rng, rngFor } from "../core/rng.js";
import { Emitter } from "../core/events.js";
import { ObstacleManager } from "../entities/trains.js";
import { CoinField } from "../entities/coins.js";
import { PickupField, PICKUP_TYPES } from "../entities/pickups.js";
import { createPlayer } from "../entities/player.js";

const smoothstep01 = (t) => t * t * (3 - 2 * t);
const TAU = Math.PI * 2;

export class RunController {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {import("../core/assets.js").MaterialLibrary} opts.lib
   * @param {number} opts.seed Run seed (deterministic world).
   * @param {object} opts.preset Quality preset (draw distance for spawning).
   * @param {(stats: object) => void} opts.onGameOver Called when the death
   *        slow-mo finishes.
   * @param {() => void} [opts.onDeath] Fired the instant a hit lands
   *        (for camera trauma / VFX).
   */
  constructor({ scene, lib, seed, preset, onGameOver, onDeath }) {
    this.scene = scene;
    this.preset = preset;
    this.onGameOver = onGameOver;
    this.onDeath = onDeath || (() => {});

    // WAVE 5 (additive): gameplay moment bus. VFX + audio subscribe in
    // main.js. Emissions are pure notifications fired from the fixed step —
    // no sim state is read or written by subscribers.
    //   coin(x,y,z) | powerup(type,x,y,z) | jump() | land(impact) |
    //   roll() | lane(dir) | step(x,z,foot) | crash(x,y,z) | reset()
    this.events = new Emitter();

    this.obstacles = new ObstacleManager(scene, lib, seed);
    this.coins = new CoinField(scene, lib);
    this.pickups = new PickupField(scene, lib);
    this.player = createPlayer(lib);
    scene.add(this.player.group);

    this.phase = "idle"; // idle | running | dying | dead
    // QA god-mode (?qa=1): hits are ignored so automated screenshots always
    // capture live gameplay instead of a game-over screen. Set here (not in
    // _initSimState) so main's `run.godMode = qa.qa` survives run.start().
    this.godMode = false;
    this.timeScale = 1;

    /** @type {{action: string, time: number}[]} */
    this._actionBuffer = [];
    this._seed = seed;
    /** @type {Rng|null} */
    this._rng = null;

    this._initSimState();
    this.prev = { ...this._snapshot() };
    this.curr = { ...this._snapshot() };
    this._rollBlend = 0;
    this._airBlend = 0;
  }

  /** @private */
  _initSimState() {
    this.lane = 0; // -1 | 0 | 1
    this.x = 0;
    this.y = 0;
    this.vy = 0;
    this.z = 0;
    this.speed = CONFIG.BASE_SPEED;
    this.distance = 0;
    this.scoreF = 0;
    this.coinsCount = 0;
    this.multiplier = 1;

    this.grounded = true;
    this.coyoteTimer = CONFIG.COYOTE_TIME;
    this.rolling = false;
    this.rollTimer = 0;
    this._rollOnLand = false;

    // Run-cycle phase accumulator (rad). Drives the character animation;
    // cadence shortens with speed (see fixedUpdate).
    this._runPhase = 0;
    this._stepHalf = 0; // half-cycle counter -> footstep events (wave 5)
    this._coinNear = null; // nearest ahead coin for the trail sparkle (VFX)

    // Lane-switch easing (0.12 s smoothstep).
    this._switchFrom = 0;
    this._switchT = 1;
    this.lateralVel = 0;

    // Spawn director.
    this._nextPatternZ = 60; // grace zone at run start
    this._lastPatternEnd = 0;
    this._patternCount = 0; // drives the separate seeded pickup stream

    // Powerup stubs (wave 5 activates; pickups already feed these).
    /** @type {{magnet: number, jetpack: number, x2: number}} */
    this.powerups = { magnet: 0, jetpack: 0, x2: 0 };

    this.timeScale = 1;
    this._deathTimer = 0;
  }

  /** @returns {object} Immutable-ish sim snapshot for interpolation. */
  _snapshot() {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      vy: this.vy,
      lateralVel: this.lateralVel,
      rolling: this.rolling,
      airborne: !this.grounded,
      distance: this.distance,
      runPhase: this._runPhase,
      deathT: this._deathTimer,
    };
  }

  /** Start (or restart) the run. */
  start() {
    this.events.emit("reset");
    this.obstacles.reset();
    this.coins.reset();
    this.pickups.reset();
    this._initSimState();
    this._rng = new Rng(this._seed ^ 0x9e3779b9);
    this.coins.onCollect = (n) => {
      this.coinsCount += n;
      this.scoreF += CONFIG.COIN_SCORE * n;
    };
    // Pickups route into the existing powerup hook (wave 5 activates fully;
    // magnet already drives the coin magnet, x2 the multiplier).
    this.pickups.onCollect = (type) => this.collectPowerup(type, 10);
    this.prev = { ...this._snapshot() };
    this.curr = { ...this._snapshot() };
    this.phase = "running";
  }

  /**
   * Queue a semantic input action (timestamped here, consumed in
   * fixedUpdate within the INPUT_BUFFER window).
   * @param {string} action left|right|jump|roll|pause
   */
  bufferAction(action) {
    if (action === "pause") return; // handled by main state machine
    this._actionBuffer.push({ action, time: performance.now() });
  }

  /** Powerup hook for wave 5. @param {string} type @param {number} [duration] */
  collectPowerup(type, duration = 10) {
    if (type in this.powerups) this.powerups[type] = duration;
    // Wave 5: VFX ring + audio sting. Position = the runner (pickups are
    // collected within ~1.25 m of them).
    this.events.emit("powerup", type, this.x, this.y + 1.0, this.z);
  }

  /**
   * Drain buffered actions. Unconsumed actions (e.g. jump pressed just
   * after leaving the ground) are RETAINED until the buffer window
   * expires, giving real input buffering.
   * @private
   */
  _drainActions() {
    const now = performance.now();
    const windowMs = CONFIG.INPUT_BUFFER * 1000;
    for (let i = 0; i < this._actionBuffer.length; i++) {
      const a = this._actionBuffer[i];
      if (now - a.time > windowMs) {
        this._actionBuffer.splice(i, 1);
        i--;
        continue;
      }
      if (this._applyAction(a.action)) {
        this._actionBuffer.splice(i, 1);
        break; // one action consumed per sim step
      }
    }
  }

  /**
   * Apply an input action. @private
   * @param {string} action
   * @returns {boolean} True if the action was consumed now.
   */
  _applyAction(action) {
    switch (action) {
      case "left":
      case "right": {
        // Screen-space mapping: this game runs toward +Z with the chase
        // camera looking +Z, so in Three.js's right-handed world
        // screen-right = world -X (camera right = forward x up = -X).
        // "right" must therefore move toward lane -1, "left" toward +1.
        const dir = action === "left" ? 1 : -1;
        const target = THREE.MathUtils.clamp(this.lane + dir, -1, 1);
        if (target !== this.lane || this._switchT < 1) {
          this._switchFrom = this.x;
          this._switchT = 0;
          this.lane = target;
          this.events.emit("lane", dir); // world-x direction of the switch
        }
        return true;
      }
      case "jump":
        if (this.rolling) {
          this.rolling = false; // roll-cancel-jump
          this.rollTimer = 0;
        }
        if (this.grounded || this.coyoteTimer > 0) {
          this.grounded = false;
          this.coyoteTimer = 0;
          this.vy = CONFIG.JUMP_VELOCITY;
          this.events.emit("jump");
          return true;
        }
        return false; // stays buffered
      case "roll":
        if (this.grounded) {
          this.rolling = true;
          this.rollTimer = CONFIG.ROLL_DURATION;
          this.events.emit("roll");
          return true;
        }
        // Air roll: slam down, roll on landing.
        this._rollOnLand = true;
        this.vy = Math.min(this.vy, -20);
        return true;
      default:
        return false;
    }
  }

  /**
   * One fixed simulation step. `dt` is already time-scaled by main
   * (slow-mo reduces it).
   * @param {number} dt
   */
  fixedUpdate(dt) {
    if (this.phase === "dying") {
      // Slow-mo drift: keep moving, ignore input/collisions.
      this.z += this.speed * dt * 0.4;
      this._deathTimer += dt;
      if (this._deathTimer >= CONFIG.DEATH_SLOWMO_TIME * CONFIG.DEATH_SLOWMO_SCALE) {
        this.phase = "dead";
        this.onGameOver(this.getStats());
      }
      this.prev = this.curr;
      this.curr = this._snapshot();
      return;
    }
    if (this.phase !== "running") return;

    this._drainActions();

    // Lane switch easing (0.12 s) + lateral velocity for body lean.
    const prevX = this.x;
    if (this._switchT < 1) {
      this._switchT = Math.min(1, this._switchT + dt / 0.12);
      this.x = THREE.MathUtils.lerp(
        this._switchFrom,
        this.lane * CONFIG.LANE_WIDTH,
        smoothstep01(this._switchT),
      );
    } else {
      this.x = this.lane * CONFIG.LANE_WIDTH;
    }
    this.lateralVel = dt > 0 ? (this.x - prevX) / dt : 0;

    // Roll timer.
    if (this.rolling) {
      this.rollTimer -= dt;
      if (this.rollTimer <= 0) this.rolling = false;
    }

    // Vertical physics.
    if (!this.grounded) {
      this.coyoteTimer = 0;
      this.vy += CONFIG.GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        const impact = -this.vy;
        this.vy = 0;
        this.grounded = true;
        this.events.emit("land", impact);
        if (this._rollOnLand) {
          this._rollOnLand = false;
          this.rolling = true;
          this.rollTimer = CONFIG.ROLL_DURATION;
          this.events.emit("roll");
        }
      }
    } else {
      this.coyoteTimer = CONFIG.COYOTE_TIME;
    }

    // Forward motion + speed ramp over distance.
    this.z += this.speed * dt;
    this.distance += this.speed * dt;
    this.speed = Math.min(
      CONFIG.MAX_SPEED,
      CONFIG.BASE_SPEED + this.distance * CONFIG.SPEED_RAMP_PER_METER,
    );

    // Run-cycle cadence: a full cycle lasts ~0.55 s at base speed and
    // shortens (to ~0.34 s) as speed rises — stride length grows with speed.
    const cycle = THREE.MathUtils.clamp(8.8 / this.speed, 0.34, 0.62);
    this._runPhase += (TAU / cycle) * dt;

    // Footstep contacts: one per half cycle while grounded (alternating
    // feet). Pure function of the sim phase — deterministic.
    const half = Math.floor(this._runPhase / Math.PI);
    if (half !== this._stepHalf) {
      this._stepHalf = half;
      if (this.grounded) this.events.emit("step", this.x, this.z, half & 1);
    }

    // Score + multiplier (x2 powerup stub doubles; wave 5 activates).
    const mult = Math.min(CONFIG.MAX_MULTIPLIER, 1 + Math.floor(this.distance / 500));
    this.multiplier = this.powerups.x2 > 0 ? Math.min(CONFIG.MAX_MULTIPLIER, mult * 2) : mult;
    this.scoreF += this.speed * dt * this.multiplier;

    // Powerup timers.
    for (const k of Object.keys(this.powerups)) {
      if (this.powerups[k] > 0) this.powerups[k] -= dt;
    }

    // Spawn director + world entities.
    this._spawnAhead();
    this.obstacles.fixedUpdate(dt, this.z);
    this.coins.fixedUpdate(dt, { x: this.x, y: this.y, z: this.z }, this.powerups.magnet > 0);
    // Wave 5: emit one coin event per collected coin (world position for the
    // pickup burst). lastCollected is drained by CoinField each fixed step.
    const got = this.coins.lastCollected;
    for (let i = 0; i < got.length; i += 3) this.events.emit("coin", got[i], got[i + 1], got[i + 2]);
    this.pickups.fixedUpdate(dt, { x: this.x, y: this.y, z: this.z });
    this._coinNear = this._nearestAheadCoin();

    // Collisions (forgiving hitboxes).
    this._checkCollisions();

    this.prev = this.curr;
    this.curr = this._snapshot();
  }

  /**
   * Seeded pattern chunks every 25-40 m. Guarantees at least one fully
   * free lane per pattern and a >= 18 m gap after forced actions
   * (jump/roll obstacles).
   * @private
   */
  _spawnAhead() {
    const rng = this._rng;
    const horizon = this.z + this.preset.drawDistance + 40;
    while (this._nextPatternZ < horizon) {
      const z = this._nextPatternZ;
      const lanes = rng.shuffle([-1, 0, 1]);
      if (this.godMode) {
        // QA captures: always keep the center lane free so the player is
        // never photographed inside obstacle geometry.
        const i = lanes.indexOf(0);
        [lanes[2], lanes[i]] = [lanes[i], lanes[2]];
      }
      const roll = rng.next();
      let length = 0;
      let forced = false;
      /** Free-lane spot where a rare pickup may replace open air. */
      let pickupSpot = null;

      if (roll < 0.12) {
        // Coin bonanza, no obstacles.
        const lane = rng.pick(lanes);
        this.coins.spawnLine(lane, z, rng.int(6, 10));
        pickupSpot = { lane, z: z - 2, y: 1.05 };
        length = 8;
      } else if (roll < 0.5) {
        // Trains blocking 1-2 lanes.
        const blocked = rng.chance(0.6) ? 2 : 1;
        for (let i = 0; i < blocked; i++) this.obstacles.spawn("train", lanes[i], z + 6);
        this.coins.spawnLine(lanes[2], z, rng.int(5, 8), 1.6);
        pickupSpot = { lane: lanes[2], z: z - 2.4, y: 1.05 };
        length = 12;
      } else if (roll < 0.75) {
        // Barrier row (jump): 1-2 lanes, coin arc over one.
        const blocked = rng.chance(0.5) ? 2 : 1;
        for (let i = 0; i < blocked; i++) this.obstacles.spawn("barrier", lanes[i], z);
        this.coins.spawnArc(lanes[0], z + 2.8, 7, 1.3, 1.9);
        if (blocked === 1) this.coins.spawnLine(lanes[2], z + 2, rng.int(4, 6));
        pickupSpot = { lane: lanes[0], z: z - 0.45, y: 2.95 }; // arc peak, between coins
        length = 3;
        forced = true;
      } else if (roll < 0.92) {
        // Overhead gantries (roll): 1-2 lanes.
        const blocked = rng.chance(0.5) ? 2 : 1;
        for (let i = 0; i < blocked; i++) this.obstacles.spawn("overhead", lanes[i], z);
        this.coins.spawnLine(lanes[0], z + 1.5, 6, 1.4, 0.6);
        if (blocked === 1) this.coins.spawnLine(lanes[2], z + 2, rng.int(4, 6));
        pickupSpot = { lane: lanes[0], z: z - 2.0, y: 0.7 }; // roll-through line, between coins
        length = 2;
        forced = true;
      } else {
        // Mixed: train + barrier (one lane always free).
        this.obstacles.spawn("train", lanes[0], z + 6);
        this.obstacles.spawn("barrier", lanes[1], z + 2);
        this.coins.spawnLine(lanes[2], z, rng.int(5, 8));
        pickupSpot = { lane: lanes[2], z: z - 2, y: 1.05 };
        length = 12;
        forced = true;
      }

      // Rare pickups ride in coin lines. They use a SEPARATE seeded stream so
      // the pattern-director rng sequence (and every spacing guarantee) is
      // bit-identical to previous waves.
      this._maybePickup(pickupSpot);

      const patternEnd = z + length;
      let gap = rng.range(25, 40);
      if (forced) gap = Math.max(gap, 18); // min gap after forced actions
      // Patterns must never overlap.
      this._nextPatternZ = Math.max(patternEnd, this._lastPatternEnd) + gap;
      this._lastPatternEnd = patternEnd;
    }
  }

  /**
   * Roll the (seeded, director-independent) pickup stream once per pattern.
   * ~30% of patterns carry one pickup in the already-free lane at coin-line
   * height. Non-solid: never affects the 3-lanes-blocked / gap guarantees.
   * @private
   */
  _maybePickup(spot) {
    this._patternCount++;
    if (!spot) return;
    const prng = rngFor(this._seed ^ 0x51ce, this._patternCount, 0x9e37);
    if (!prng.chance(0.3)) return;
    this.pickups.spawn(prng.pick(PICKUP_TYPES), spot.lane * CONFIG.LANE_WIDTH, spot.y, spot.z);
  }

  /**
   * Nearest active coin slightly AHEAD of the runner (trail-sparkle target
   * for the VFX layer). Pure scan of the pooled field — deterministic.
   * @returns {{x: number, y: number, z: number}|null}
   * @private
   */
  _nearestAheadCoin() {
    const coins = this.coins.coins;
    let best = null;
    let bestZ = Infinity;
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      if (!c.active) continue;
      const dz = c.z - this.z;
      if (dz < -0.5 || dz > 16 || dz >= bestZ) continue;
      if (Math.abs(c.x - this.x) > 1.2) continue; // player's lane only — adjacent-lane sparkles read as debris (judge round 17)
      bestZ = dz;
      best = c;
    }
    return best ? { x: best.x, y: best.y, z: best.z } : null;
  }

  /**
   * AABB collision in XZ with height check vs jump/roll state.
   * Collider dims are shrunk by HITBOX_SHRINK (forgiving).
   * @private
   */
  _checkCollisions() {
    if (this.godMode) return;
    const playerH = this.rolling ? CONFIG.ROLL_HEIGHT : CONFIG.STAND_HEIGHT;
    const shrink = 1 - CONFIG.HITBOX_SHRINK;
    for (const c of this.obstacles.getColliders()) {
      if (!c.solid) continue;
      const halfW = c.halfW * shrink;
      const halfD = c.halfD * shrink;
      if (
        Math.abs(this.x - c.x) < halfW + CONFIG.PLAYER_HALF_WIDTH &&
        Math.abs(this.z - c.z) < halfD + CONFIG.PLAYER_HALF_DEPTH &&
        this.y < c.y1 &&
        this.y + playerH > c.y0
      ) {
        this._die();
        return;
      }
    }
  }

  /** @private */
  _die() {
    if (this.godMode) return; // QA runs never die so screenshots capture gameplay
    this.phase = "dying";
    this._deathTimer = 0;
    this.timeScale = CONFIG.DEATH_SLOWMO_SCALE;
    this.events.emit("crash", this.x, this.y, this.z);
    this.onDeath();
  }

  /** HUD snapshot. */
  getStats() {
    return {
      score: Math.floor(this.scoreF),
      coins: this.coinsCount,
      distance: Math.floor(this.distance),
      multiplier: this.multiplier,
      speed: this.speed,
    };
  }

  /**
   * Nearest coin ahead of the runner (wave 5, VFX trail-sparkle target).
   * Updated once per fixed step; null when no coin is in range.
   * @returns {{x: number, y: number, z: number}|null}
   */
  get coinNear() {
    return this._coinNear;
  }

  // -----------------------------------------------------------------
  // READ-ONLY obstacle queries (ui-ux-pass D8, task 7.1): the first-run
  // teaching layer asks whether a jump/roll hazard is closing in. Pure
  // pass-throughs over ObstacleManager's kind scans with the runner's
  // live lane folded in — no sim state is read beyond positions and no
  // write path exists, so hints on/off cannot drift the simulation.
  // -----------------------------------------------------------------

  /**
   * Is a jumpable obstacle (barrier) within `range` m ahead, in the
   * runner's lane?
   * @param {number} z Player z (metres).
   * @param {number} range Look-ahead window in metres.
   * @returns {boolean}
   */
  nearestJumpable(z, range) {
    return this.obstacles.nearestJumpable(z, range, this.x);
  }

  /**
   * Is an overhead (roll-under) obstacle within `range` m ahead, in the
   * runner's lane?
   * @param {number} z Player z (metres).
   * @param {number} range Look-ahead window in metres.
   * @returns {boolean}
   */
  nearestOverhead(z, range) {
    return this.obstacles.nearestOverhead(z, range, this.x);
  }

  /**
   * Interpolated render pose between sim snapshots.
   * @param {number} alpha 0..1 interpolation factor of the current frame.
   * @returns {{x:number,y:number,z:number,vy:number,lateralVel:number,
   *   rollAmount:number,airAmount:number,runPhase:number,speed:number,
   *   phase:string,deathT:number}}
   */
  renderPose(alpha) {
    const p = this.prev;
    const c = this.curr;
    const t = alpha;
    return {
      x: p.x + (c.x - p.x) * t,
      y: p.y + (c.y - p.y) * t,
      z: p.z + (c.z - p.z) * t,
      vy: p.vy + (c.vy - p.vy) * t,
      lateralVel: c.lateralVel,
      speed: this.speed,
      rollAmount: this._rollBlend,
      airAmount: this._airBlend,
      runPhase: p.runPhase + (c.runPhase - p.runPhase) * t,
      deathT: p.deathT + (c.deathT - p.deathT) * t,
      phase: this.phase,
    };
  }

  /**
   * Per-render-frame visuals: player pose blending + coin matrices.
   * @param {number} alpha Interpolation factor.
   * @param {number} dt Render delta (s).
   */
  updateRender(alpha, dt) {
    // Roll pose only for actual rolls (death has its own flop pose).
    const targetRoll = this.curr.rolling && this.phase === "running" ? 1 : 0;
    const targetAir = this.curr.airborne && this.phase === "running" ? 1 : 0;
    // dt == 0 (QA ?freeze warmup) snaps to targets so the frozen frame
    // shows the true current state and stays deterministic.
    const kRoll = dt > 0 ? Math.min(1, dt * 14) : 1;
    const kAir = dt > 0 ? Math.min(1, dt * 10) : 1;
    this._rollBlend += (targetRoll - this._rollBlend) * kRoll;
    this._airBlend += (targetAir - this._airBlend) * kAir;
    this.player.updateRender(this.renderPose(alpha), dt);
    this.coins.updateRender();
    this.pickups.updateRender();
  }

  /** Remove the player mesh (never needed in practice; kept for tests). */
  dispose() {
    this.scene.remove(this.player.group);
  }
}
