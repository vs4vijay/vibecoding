import * as THREE from 'three';

import { createTrackFrame, type TrackCurve, type TrackFrame } from '../track/TrackCurve';
import type { LateralInput } from '../core/Input';
import type { SpeedModifiers } from '../systems/SpeedMods';
import type { Snail } from './Snail';

/**
 * The player: auto-forward at cruise speed, keyboard steering across the road.
 *
 * All state lives in track coordinates — `s` (distance along the curve) and
 * `x` (lateral offset, positive = right). `update` runs in the fixed-timestep
 * simulation and is the authority; `applyVisual` runs at render time and
 * interpolates between the last two simulation states (alpha from the loop's
 * accumulator) so movement stays smooth on high-refresh displays.
 */

export interface ControllerOptions {
  track: TrackCurve;
  /** The Turbo mesh whose root transform the controller owns. */
  snail: Snail;
  /** Steering axis source (keyboard in Phase 1; replays/AI can reuse this). */
  input: LateralInput;
  /** Auto-forward speed in world units per second. */
  cruiseSpeed: number;
  /** Road half width; `x` is clamped to ±(halfWidth − edgeMargin). */
  roadHalfWidth: number;
  /** Lateral steer speed in world units per second. Defaults to 20. */
  lateralSpeed?: number;
  /** Kept between the snail and the road edge. Defaults to 1.2. */
  edgeMargin?: number;
  /** Max bank roll in radians at full steer. Defaults to 0.5. */
  maxBankRoll?: number;
  /** How fast the bank approaches the steering input (higher = snappier). Defaults to 18. */
  bankRate?: number;
  /**
   * Phase 3 speed mods (asteroid slow-down; red rings in Phase 4). When
   * given, `update` refreshes `speedMultiplier` from it every sim step —
   * the modifier system owns the timing, the Controller owns the motion.
   */
  speedModifiers?: SpeedModifiers;
}

/** Parameters for one jump-pod launch (`launch`). */
export interface LaunchOptions {
  /** Total flight time in seconds (fixed — the pod is a catapult, not a glide). */
  duration?: number;
  /** Parabola peak height above the road, in world units. */
  peakHeight?: number;
}

/** Read-only run state snapshot the rest of the game consumes. */
export interface ControllerState {
  readonly s: number;
  readonly x: number;
  readonly speed: number;
}

const LOCAL_ROLL_AXIS = new THREE.Vector3(0, 0, 1); // local Z; rotation sign handled below
const LOCAL_PITCH_AXIS = new THREE.Vector3(1, 0, 0); // local X: nose up/down along the arc

export class Controller {
  /** Multiplier applied to cruise speed. Driven by `speedModifiers` when present. */
  public speedMultiplier = 1;

  private readonly track: TrackCurve;
  private readonly snail: Snail;
  private readonly input: LateralInput;
  private readonly cruiseSpeed: number;
  private readonly lateralSpeed: number;
  private readonly maxX: number;
  private readonly maxBankRoll: number;
  private readonly bankRate: number;
  private readonly speedModifiers: SpeedModifiers | null;

  // Simulation state (authority). `prev*` pairs feed render interpolation.
  private sValue = 0;
  private xValue = 0;
  private prevS = 0;
  private prevX = 0;
  private steering = 0; // smoothed input in [-1, 1]
  private prevSteering = 0;

  // Airborne state (jump-pod flight): a fixed-duration parabola over the
  // road. `s` and steering advance exactly as when grounded — speed mods
  // still apply, so a red ring mid-flight shortens the arc and the landing
  // point is wherever the speed actually carried Turbo. Air height rides the
  // road normal (visual only — collision stays in pure (s, x)).
  private airTime = 0;
  private airDuration = 0; // 0 = grounded
  private airPeak = 0;
  private airHeightValue = 0;
  private prevAirHeight = 0;
  private airPitchValue = 0;
  private prevAirPitch = 0;

  /** Last transform computed by `applyVisual` — the chase camera follows this. */
  public readonly visualPosition = new THREE.Vector3();
  /** Last transform computed by `applyVisual` — includes the steering bank. */
  public readonly visualQuaternion = new THREE.Quaternion();

  // Reusable scratch — update/applyVisual are hot paths, no per-call allocs.
  private readonly frame: TrackFrame = createTrackFrame();
  private readonly rollQuat = new THREE.Quaternion();
  private readonly pitchQuat = new THREE.Quaternion();

  public constructor(options: ControllerOptions) {
    this.track = options.track;
    this.snail = options.snail;
    this.input = options.input;
    this.cruiseSpeed = options.cruiseSpeed;
    this.lateralSpeed = options.lateralSpeed ?? 20;
    this.maxX = Math.max(0, options.roadHalfWidth - (options.edgeMargin ?? 1.2));
    this.maxBankRoll = options.maxBankRoll ?? 0.5;
    this.bankRate = options.bankRate ?? 18;
    this.speedModifiers = options.speedModifiers ?? null;
  }

  /** Current arc length along the track (0..length; may overshoot at the gate). */
  public get s(): number {
    return this.sValue;
  }

  /** Current lateral offset from the center line (positive = right). */
  public get x(): number {
    return this.xValue;
  }

  /** Current forward speed in world units per second. */
  public get speed(): number {
    return this.cruiseSpeed * this.speedMultiplier;
  }

  /** Steering axis smoothed toward the input — drives the visual bank. */
  public get smoothedSteering(): number {
    return this.steering;
  }

  /** Run progress as 0..1. */
  public get progress(): number {
    const length = this.track.getCurveLength();
    return length > 0 ? Math.min(1, Math.max(0, this.sValue / length)) : 0;
  }

  /** Read-only snapshot of the authoritative (s, x, speed). */
  public get state(): ControllerState {
    return { s: this.sValue, x: this.xValue, speed: this.speed };
  }

  /** True from launch until the parabola touches back down. */
  public get airborne(): boolean {
    return this.airDuration > 0;
  }

  /** Flight progress 0..1 (0 while grounded). */
  public get airProgress(): number {
    return this.airDuration > 0 ? Math.min(1, this.airTime / this.airDuration) : 0;
  }

  /**
   * Current parabola height above the road, in world units (0 when grounded)
   — the authoritative value the visuals interpolate from.
   */
  public get airHeight(): number {
    return this.airHeightValue;
  }

  /**
   * Launches a jump-pod flight: a fixed-duration parabola peaking at
   * `peakHeight`. Forward motion is untouched — the arc covers however far
   * the current speed carries Turbo in `duration`, which is what makes the
   * level invariant ("arc clears the gap at cruise") and the red-ring trap
   * (arc falls short while slowed) two sides of the same rule. Air control
   * is retained: steering and speed mods run exactly as when grounded.
   *
   * Returns false (and does nothing) when already airborne — pods never
   * re-launch mid-flight.
   */
  public launch(options: LaunchOptions = {}): boolean {
    if (this.airborne) return false;
    const duration = options.duration ?? 1.4;
    const peak = options.peakHeight ?? 7;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new RangeError(`launch duration must be a positive finite number, got ${String(duration)}`);
    }
    if (!Number.isFinite(peak) || peak < 0) {
      throw new RangeError(`launch peakHeight must be a non-negative finite number, got ${String(peak)}`);
    }
    this.airTime = 0;
    this.airDuration = duration;
    this.airPeak = peak;
    this.prevAirHeight = 0;
    this.airHeightValue = 0;
    this.prevAirPitch = 0;
    this.airPitchValue = 0;
    return true;
  }

  /** Advances one fixed simulation step: steering, banking, forward motion. */
  public update(dt: number): void {
    this.prevS = this.sValue;
    this.prevX = this.xValue;
    this.prevSteering = this.steering;
    this.prevAirHeight = this.airHeightValue;
    this.prevAirPitch = this.airPitchValue;

    // Speed mods tick with the sim: the asteroid slow-down (and later the
    // red-ring trap) expires exactly here, then `speed` recovers to cruise.
    if (this.speedModifiers) this.speedMultiplier = this.speedModifiers.update(dt);

    const lateral = Math.max(-1, Math.min(1, this.input.lateral));
    // Frame-rate independent exponential approach — immediate but not instant.
    this.steering += (lateral - this.steering) * (1 - Math.exp(-this.bankRate * dt));

    this.sValue += this.speed * dt;
    this.xValue = Math.max(-this.maxX, Math.min(this.maxX, this.xValue + lateral * this.lateralSpeed * dt));

    this.advanceAir(dt);
  }

  /** Advances the flight parabola; grounded steps keep everything at zero. */
  private advanceAir(dt: number): void {
    if (this.airDuration <= 0) {
      this.airHeightValue = 0;
      this.airPitchValue = 0;
      return;
    }
    this.airTime += dt;
    if (this.airTime >= this.airDuration) {
      // Touched down: grounded from this step on (a fall check on the same
      // step sees a grounded snail over open air and drops it).
      this.airDuration = 0;
      this.airTime = 0;
      this.airPeak = 0;
      this.airHeightValue = 0;
      this.airPitchValue = 0;
      return;
    }
    const p = this.airTime / this.airDuration;
    this.airHeightValue = 4 * this.airPeak * p * (1 - p);
    // Pitch along the arc: dy/dt = (4·peak/T)·(1 − 2p), nose up on the rise.
    const climbRate = ((4 * this.airPeak) / this.airDuration) * (1 - 2 * p);
    this.airPitchValue = Math.atan2(climbRate, Math.max(1, this.speed));
  }

  /**
   * Applies the interpolated transform (alpha between the last two sim steps)
   * to the snail mesh and refreshes `visualPosition`/`visualQuaternion`.
   * Called once per rendered frame; allocates nothing.
   */
  public applyVisual(alpha = 1): void {
    const a = Math.min(1, Math.max(0, alpha));
    const s = this.prevS + (this.sValue - this.prevS) * a;
    const x = this.prevX + (this.xValue - this.prevX) * a;
    const steering = this.prevSteering + (this.steering - this.prevSteering) * a;
    const height = this.prevAirHeight + (this.airHeightValue - this.prevAirHeight) * a;
    const pitch = this.prevAirPitch + (this.airPitchValue - this.prevAirPitch) * a;

    this.track.sToWorld(s, x, this.frame);
    this.visualPosition.copy(this.frame.position);
    this.visualQuaternion.copy(this.frame.quaternion);

    // Flight arc: lift along the road normal (pitches with the road) and
    // nose along the parabola — up on the rise, down on the fall. Grounded,
    // both are zero and this is a no-op.
    if (height !== 0 || pitch !== 0) {
      this.visualPosition.addScaledVector(this.frame.normal, height);
      this.pitchQuat.setFromAxisAngle(LOCAL_PITCH_AXIS, pitch);
      this.visualQuaternion.multiply(this.pitchQuat);
    }

    // Bank around the local forward axis: steering right (+1) dips the right
    // side, i.e. negative rotation about local +Z (forward is local -Z).
    this.rollQuat.setFromAxisAngle(LOCAL_ROLL_AXIS, -steering * this.maxBankRoll);
    this.visualQuaternion.multiply(this.rollQuat);

    this.snail.group.position.copy(this.visualPosition);
    this.snail.group.quaternion.copy(this.visualQuaternion);
  }

  /** Places the snail back on the start line, centered, level, at cruise. */
  public reset(s = 0, x = 0): void {
    this.sValue = s;
    this.xValue = x;
    this.prevS = s;
    this.prevX = x;
    this.steering = 0;
    this.prevSteering = 0;
    this.speedMultiplier = 1;
    this.airTime = 0;
    this.airDuration = 0;
    this.airPeak = 0;
    this.airHeightValue = 0;
    this.prevAirHeight = 0;
    this.airPitchValue = 0;
    this.prevAirPitch = 0;
  }
}
