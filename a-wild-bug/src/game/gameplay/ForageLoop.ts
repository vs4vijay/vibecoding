import * as THREE from "three";
import { clamp } from "../util/MathX";
import type { SfxName } from "../audio/Audio";
import type { DayCycle } from "../world/DayCycle";
import type { Input } from "../player/Input";
import type { PlayerController } from "../player/PlayerController";
import type { Ant } from "../player/Ant";
import type { FollowCamera } from "../camera/FollowCamera";
import type { GrainField } from "./GrainField";
import type { Anthill } from "./Anthill";
import type { CarriedGrain, CarryContext } from "./CarriedGrain";
import type { Puffs } from "./Puffs";

/**
 * The forage loop: the sinking sun is the timer. Day runs t=0.12 → 1.0 over
 * DAY_SECONDS of real time; deliver QUOTA grains into the anthill hole before
 * sunset to win. Pickup (E near a node/loose seed), throw (F), auto-deposit on
 * the hole trigger. Owns win/lose moments, prompts, toasts and a deterministic
 * staging API the ShotDirector uses to freeze any mid-loop state for captures.
 */

export type LoopPhase = "playing" | "winMoment" | "win" | "lose";

export const LOOP_TUNING = {
  quota: 6,
  dayStartT: 0.12,
  dayEndT: 1.0,
  daySeconds: 360,
  pickupRadius: 0.55,
  depositRadius: 0.62,
  winMomentDuration: 2.8,
  toastDuration: 5,
  spawn: { x: 0, z: 2.4, yaw: 0 },
} as const;

export interface PromptState {
  key: string | null;
  text: string;
  alpha: number;
}

export interface ToastState {
  text: string;
  alpha: number;
}

export interface LoopContext {
  dayCycle: DayCycle;
  controller: PlayerController;
  ant: Ant;
  input: Input;
  followCam: FollowCamera;
  grains: GrainField;
  anthill: Anthill;
  carried: CarriedGrain;
  puffs: Puffs;
  /**
   * Audio bridge (design D4): fired from LIVE event sites only — staging
   * (stage()) never calls it, and Game's bridge drops it while pinned.
   */
  onSfx?: (name: SfxName) => void;
}

const CHAFF = {
  count: 12,
  colorA: 0xffdf8e,
  colorB: 0xc98d3a,
  speed: [0.35, 0.9] as [number, number],
  up: 0.9,
  gravity: 2.6,
  drag: 1.6,
  life: [0.32, 0.5] as [number, number],
  size: [0.012, 0.03] as [number, number],
};

const DUST = {
  count: 14,
  colorA: 0xc7a878,
  colorB: 0x8a6c48,
  speed: [0.25, 0.7] as [number, number],
  up: 0.65,
  gravity: 2.2,
  drag: 2.2,
  life: [0.28, 0.45] as [number, number],
  size: [0.014, 0.034] as [number, number],
};

const GOLD_MOTES = {
  count: 18,
  colorA: 0xffe9a8,
  colorB: 0xf0b452,
  speed: [0.15, 0.55] as [number, number],
  up: 0.85,
  gravity: 0.5,
  drag: 1.2,
  life: [0.9, 1.6] as [number, number],
  size: [0.012, 0.026] as [number, number],
};

/** Small reward puff on every deposit — the plunk pays out gold. */
export const DEPOSIT_MOTES = {
  count: 8,
  colorA: 0xffe9a8,
  colorB: 0xf0b452,
  speed: [0.15, 0.45] as [number, number],
  up: 0.7,
  gravity: 0.9,
  drag: 1.4,
  life: [0.35, 0.55] as [number, number],
  size: [0.012, 0.024] as [number, number],
};

export class ForageLoop {
  phase: LoopPhase = "playing";
  phaseT = 0;
  deposited = 0;
  readonly quota = LOOP_TUNING.quota;
  /** Seconds since startDay; the loop owns the day clock (read-only outside). */
  get dayElapsed(): number {
    return this._dayElapsed;
  }
  private _dayElapsed = 0;
  duskDim = 0;
  readonly prompt: PromptState = { key: null, text: "", alpha: 0 };
  readonly toast: ToastState = { text: "", alpha: 0 };
  /** 0..1 count-pop animation clock (0 = just popped). */
  countPop = 1;
  /** 0..1 urgency drive for HUD pulse + warm grade bias. */
  urgency = 0;
  /** 0..1 screen "sting" pulse on a snatch (drives the GradePass uSting). */
  sting = 0;
  /** Fired whenever a fresh day starts (restarts reset enemies + seeds). */
  onDayStart: (() => void) | null = null;

  private readonly ctx: LoopContext;
  private toastT = 0;
  private stingT = 0;
  private promptId = "";
  private prevCarriedMode: CarriedGrain["mode"] = "hidden";
  private firstDeposit = true;

  constructor(ctx: LoopContext) {
    this.ctx = ctx;
    this.ctx.carried.onSettle = (pos, quat, scale) => {
      this.ctx.grains.addLoose(pos, quat, scale);
      this.ctx.puffs.burst(pos, DUST);
    };
    this.ctx.carried.onBounce = (pos, speed) => {
      if (speed > 2) this.ctx.puffs.burst(pos, { ...DUST, count: 6 });
    };
  }

  get dayT(): number {
    const span = LOOP_TUNING.dayEndT - LOOP_TUNING.dayStartT;
    return LOOP_TUNING.dayStartT + span * Math.min(1, this.dayElapsed / LOOP_TUNING.daySeconds);
  }

  get remaining(): number {
    return Math.max(0, LOOP_TUNING.daySeconds - this.dayElapsed);
  }

  /** Starts (or restarts) the day from sunrise. */
  startDay(): void {
    this.phase = "playing";
    this.phaseT = 0;
    this.deposited = 0;
    this._dayElapsed = 0;
    this.duskDim = 0;
    this.urgency = 0;
    this.sting = 0;
    this.stingT = 0;
    this.firstDeposit = true;
    const c = this.ctx;
    c.dayCycle.setTime(LOOP_TUNING.dayStartT);
    c.grains.reset();
    c.anthill.reset();
    c.carried.hide();
    c.ant.setCarrying(false);
    c.controller.teleport(LOOP_TUNING.spawn.x, LOOP_TUNING.spawn.z, LOOP_TUNING.spawn.yaw);
    this.onDayStart?.();
    this.showToast("Meet the quota before sunset");
  }

  update(dt: number): void {
    switch (this.phase) {
      case "playing":
        this.updatePlaying(dt);
        break;
      case "winMoment":
        this.phaseT += dt;
        this.updatePrompt(dt, null);
        if (this.phaseT >= LOOP_TUNING.winMomentDuration) {
          this.phase = "win";
          this.phaseT = 0;
        }
        break;
      case "win":
        this.phaseT += dt;
        if (this.ctx.input.consumeConfirm()) this.startDay();
        break;
      case "lose":
        this.phaseT += dt;
        this.duskDim = clamp(this.phaseT / 2.2, 0, 1);
        if (this.ctx.input.consumeConfirm()) this.startDay();
        break;
    }
    this.carriedWatch();
    this.ctx.carried.update(dt, this.buildCarryCtx());
    // Toast fade (deterministic, fixed-step): fade in over the first 0.5 s of
    // ELAPSED time, hold, fade out over the last 0.8 s. (The old fadeIn decayed
    // with REMAINING time, so a live toast peaked at 37% opacity for a blink
    // ~4.7 s after its event — the snatch/stun beats never actually read.)
    if (this.toastT > 0) {
      this.toastT = Math.max(0, this.toastT - dt);
      const elapsed = LOOP_TUNING.toastDuration - this.toastT;
      const fadeIn = clamp(elapsed / 0.5, 0, 1);
      const fadeOut = clamp(this.toastT / 0.8, 0, 1);
      this.toast.alpha = Math.min(fadeIn, fadeOut);
    } else {
      this.toast.alpha = 0;
    }
    // Sting beat (snatch): fast attack, ~0.85 s decay.
    if (this.stingT > 0) {
      this.stingT = Math.max(0, this.stingT - dt);
      this.sting = clamp(this.stingT / 0.85, 0, 1);
    } else {
      this.sting = 0;
    }
    this.countPop = Math.min(1, this.countPop + dt / 0.32);
  }

  private updatePlaying(dt: number): void {
    const c = this.ctx;
    this._dayElapsed += dt;
    c.dayCycle.setTime(this.dayT);
    if (this.dayElapsed >= LOOP_TUNING.daySeconds) {
      this.enterLose();
      return;
    }

    if (c.input.consumeInteract()) this.tryPickup();
    if (c.input.consumeThrow()) this.tryThrow();

    const holeDist = Math.hypot(
      c.controller.position.x - c.anthill.holePos.x,
      c.controller.position.z - c.anthill.holePos.z,
    );
    if (c.carried.mode === "held" && holeDist < LOOP_TUNING.depositRadius) {
      c.ant.setCarrying(false);
      c.carried.startDeposit(c.anthill.holePos, c.carried.position);
    }

    // Prompt priority: deliver > throw > pick up.
    let prompt: { key: string | null; text: string } | null = null;
    if (c.carried.mode === "held") {
      prompt = holeDist < 2.8 ? { key: null, text: "Deliver to the anthill" } : { key: "F", text: "throw" };
    } else if (c.carried.mode === "hidden" && c.grains.pickableAt(c.controller.position, LOOP_TUNING.pickupRadius)) {
      prompt = { key: "E", text: "pick up grain" };
    }
    this.updatePrompt(dt, prompt);

    this.urgency = clamp((60 - this.remaining) / 40, 0, 1);
  }

  private updatePrompt(dt: number, target: { key: string | null; text: string } | null): void {
    const id = target ? `${target.key ?? ""}|${target.text}` : "";
    if (id !== this.promptId) {
      this.promptId = id;
      if (target) {
        this.prompt.key = target.key;
        this.prompt.text = target.text;
      }
    }
    const goal = target ? 1 : 0;
    const rate = dt / 0.28;
    this.prompt.alpha = clamp(this.prompt.alpha + (goal > this.prompt.alpha ? rate : -rate), 0, 1);
    if (target === null && this.prompt.alpha === 0) {
      this.prompt.key = null;
      this.prompt.text = "";
    }
  }

  private showToast(text: string): void {
    this.toast.text = text;
    this.toastT = LOOP_TUNING.toastDuration;
  }

  /** Pickup attempt (E in play; scripted by the motion shot). */
  tryPickup(): void {
    const c = this.ctx;
    if (this.phase !== "playing" || c.carried.mode !== "hidden") return;
    const target = c.grains.pickableAt(c.controller.position, LOOP_TUNING.pickupRadius);
    if (!target) return;
    if (target.kind === "node") c.grains.harvestNode(target.index);
    else c.grains.takeLoose(target.index);
    c.puffs.burst(target.pos, CHAFF);
    c.carried.startCollect(target.pos, 1);
    c.ant.setCarrying(true);
    c.onSfx?.("pickup");
  }

  private tryThrow(): void {
    const c = this.ctx;
    if (this.phase !== "playing" || c.carried.mode !== "held") return;
    c.ant.setCarrying(false);
    c.carried.throw_(c.followCam.yaw);
    c.onSfx?.("throw");
  }

  // --- threat hooks (called by the hopper in the fixed step) ----------------

  /**
   * The grasshopper takes the carried grain. Returns true when a held grain
   * was actually taken (the caller owns what happens to it next).
   */
  stealCarried(): boolean {
    const c = this.ctx;
    if (this.phase !== "playing" || c.carried.mode !== "held") return false;
    c.carried.hide();
    c.ant.setCarrying(false);
    return true;
  }

  /** Screen "sting" beat on a snatch (radial blur pulse via GradePass). */
  triggerSting(): void {
    this.stingT = 0.85;
  }

  /** Public toast for gameplay events (steal / stun / launch beats). */
  announce(text: string): void {
    this.showToast(text);
  }

  /** Deposits finalize when the carried grain finishes its plunk arc. */
  private carriedWatch(): void {
    const c = this.ctx;
    const mode = c.carried.mode;
    if (this.prevCarriedMode === "deposit" && mode === "hidden") {
      this.deposited++;
      this.countPop = 0;
      c.onSfx?.("deposit");
      c.anthill.deposit((pos, preAge) => {
        c.puffs.burst(pos, DUST, preAge);
        // A small gold payout on EVERY delivery — mid-loop plunks feel
        // rewarded, not just the win moment.
        c.puffs.burst(pos, DEPOSIT_MOTES, preAge);
      });
      if (this.firstDeposit) {
        this.firstDeposit = false;
        this.showToast("The pile grows — the colony counts on you");
      }
      if (this.deposited >= this.quota) this.enterWinMoment();
    }
    this.prevCarriedMode = mode;
  }

  private enterWinMoment(): void {
    this.phase = "winMoment";
    this.phaseT = 0;
    this.urgency = 0;
    this.ctx.onSfx?.("win");
    this.ctx.anthill.glint();
    this.ctx.puffs.burst(this.ctx.anthill.holePos, GOLD_MOTES);
  }

  private enterLose(): void {
    this.phase = "lose";
    this.phaseT = 0;
    this.updatePrompt(1, null);
    this.ctx.onSfx?.("lose");
  }

  /** Carry-bob inputs from the current ant/controller state. */
  buildCarryCtx(): CarryContext {
    const c = this.ctx;
    const anchor = c.ant.carryAnchor;
    anchor.getWorldPosition(_anchorPos);
    anchor.getWorldQuaternion(_anchorQuat);
    return {
      anchorPos: _anchorPos,
      anchorQuat: _anchorQuat,
      throwYaw: c.followCam.yaw,
      gaitPhase: c.ant.gaitPhase,
      antTime: c.ant.clock,
      speedFactor: clamp(c.controller.planarSpeed / 2.2, 0, 1),
      forwardAccel: c.controller.forwardAccel,
    };
  }

  // --- staging API (ShotDirector only) ------------------------------------

  /**
   * Freezes an arbitrary mid-loop state deterministically. `dayElapsed` sets
   * the HUD clock WITHOUT touching the DayCycle (the shot pins t). `urgency`
   * overrides the derived sun-timer urgency (M1 framings pin it to 0 so the
   * certified grade is untouched). Always resets toast/pop feedback so no
   * live-boot state leaks into a pinned frame.
   */
  stage(opts: {
    deposited?: number;
    carryHeld?: boolean;
    depositFrac?: number;
    dayElapsed?: number;
    phase?: LoopPhase;
    phaseT?: number;
    duskDim?: number;
    urgency?: number;
    prompt?: { key: string | null; text: string } | null;
    toast?: string | null;
  }): void {
    const c = this.ctx;
    if (opts.phase) {
      this.phase = opts.phase;
      this.phaseT = opts.phaseT ?? 0;
    }
    if (opts.prompt !== undefined) {
      this.promptId = opts.prompt ? `${opts.prompt.key ?? ""}|${opts.prompt.text}` : "";
      this.prompt.key = opts.prompt?.key ?? null;
      this.prompt.text = opts.prompt?.text ?? "";
    }
    this.prompt.alpha = opts.prompt ? 1 : 0;
    this.toast.alpha = 0;
    this.toastT = 0;
    if (opts.toast) {
      this.toast.text = opts.toast;
      this.toastT = 3.4;
      this.toast.alpha = 1;
    }
    this.sting = 0;
    this.stingT = 0;
    this.countPop = 1;
    this.duskDim = opts.duskDim ?? 0;
    if (opts.dayElapsed !== undefined) this._dayElapsed = opts.dayElapsed;
    this.urgency = opts.urgency ?? clamp((60 - this.remaining) / 40, 0, 1);

    if (opts.deposited !== undefined) {
      this.deposited = opts.deposited;
      c.anthill.stagePile(opts.deposited);
    }
    if (opts.depositFrac !== undefined) {
      c.anthill.stagePile(this.deposited);
      c.anthill.stageFlash(opts.depositFrac);
      c.ant.carryAnchor.getWorldPosition(_v1);
      c.carried.stageDeposit(c.anthill.holePos, _v1, opts.depositFrac);
    } else if (opts.carryHeld) {
      c.ant.setCarrying(true);
      c.carried.snapHeld();
      c.carried.update(0, this.buildCarryCtx());
    } else {
      c.carried.hide();
    }
    this.prevCarriedMode = c.carried.mode;
  }

  /** Returns the loop to a fresh morning (used when leaving staged shots). */
  stageResetToPlaying(): void {
    this.startDay();
  }
}

const _anchorPos = new THREE.Vector3();
const _anchorQuat = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
