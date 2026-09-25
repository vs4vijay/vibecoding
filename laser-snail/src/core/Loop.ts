/**
 * Fixed-timestep game loop.
 *
 * Simulation advances in discrete `step`-second slices via the accumulator
 * pattern, fully decoupled from rendering: every animation frame the loop
 * drains however many whole steps have accumulated (clamped so a long stall
 * cannot trigger a spiral of death), then renders exactly once.
 */

/** Simulation tick callback. `dt` is always exactly `LoopOptions.step`. */
export type UpdateCallback = (dt: number) => void;

/** Render callback, invoked once per animation frame. */
export type RenderCallback = () => void;

export interface LoopOptions {
  /** Called once per fixed simulation step. */
  update: UpdateCallback;
  /** Called once per rendered frame, after all update steps have run. */
  render: RenderCallback;
  /** Fixed simulation step in seconds. Defaults to 1/60. */
  step?: number;
  /**
   * Largest frame delta that will be simulated, in seconds. A frame reporting
   * a longer stall is clamped to this, capping the catch-up burst.
   * Defaults to 0.25.
   */
  maxFrameTime?: number;
  /**
   * Hard cap on simulation steps executed in a single frame. If whole steps
   * remain in the accumulator after the cap, the backlog is discarded so the
   * loop recovers within one frame. Defaults to 5.
   */
  maxSteps?: number;
}

const DEFAULT_STEP = 1 / 60;
const DEFAULT_MAX_FRAME_TIME = 0.25;
const DEFAULT_MAX_STEPS = 5;

export class Loop {
  /** Fixed simulation step in seconds. */
  public readonly step: number;
  /** Maximum frame delta simulated per frame, in seconds. */
  public readonly maxFrameTime: number;
  /** Maximum update steps executed per frame. */
  public readonly maxSteps: number;

  private readonly updateCallback: UpdateCallback;
  private readonly renderCallback: RenderCallback;

  private accumulator = 0;
  private lastFrameTime = 0;
  private frameHandle: number | null = null;
  private running = false;

  constructor(options: LoopOptions) {
    const step = options.step ?? DEFAULT_STEP;
    const maxFrameTime = options.maxFrameTime ?? DEFAULT_MAX_FRAME_TIME;
    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

    if (!(step > 0) || !Number.isFinite(step)) {
      throw new RangeError(`Loop step must be a positive finite number, got ${String(options.step)}`);
    }
    if (!(maxFrameTime > 0) || !Number.isFinite(maxFrameTime)) {
      throw new RangeError(
        `Loop maxFrameTime must be a positive finite number, got ${String(options.maxFrameTime)}`,
      );
    }
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new RangeError(`Loop maxSteps must be a positive integer, got ${String(options.maxSteps)}`);
    }

    this.step = step;
    this.maxFrameTime = maxFrameTime;
    this.maxSteps = maxSteps;
    this.updateCallback = options.update;
    this.renderCallback = options.render;
  }

  /** Whether the loop is currently scheduling animation frames. */
  public get isRunning(): boolean {
    return this.running;
  }

  /** Time currently banked toward the next update step, in seconds. */
  public get pendingTime(): number {
    return this.accumulator;
  }

  /** Starts scheduling animation frames. No-op if already running. */
  public start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  /** Stops the loop and cancels any pending animation frame. No-op if stopped. */
  public stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  /**
   * Advances the simulation by `deltaSeconds` of wall time, running zero or
   * more fixed update steps. Rendering is intentionally *not* performed here;
   * the frame callback renders once after advancing. Exposed separately so
   * tests (and future frame-capture code) can drive the simulation
   * deterministically.
   *
   * Returns the number of update steps executed.
   */
  public advance(deltaSeconds: number): number {
    if (!(deltaSeconds > 0)) return 0; // also swallows NaN / negative timer glitches
    this.accumulator += Math.min(deltaSeconds, this.maxFrameTime);

    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      this.updateCallback(this.step);
      this.accumulator -= this.step;
      steps += 1;
    }
    if (steps === this.maxSteps && this.accumulator >= this.step) {
      // A backlog remains after the per-frame cap: drop it, so the next frame
      // starts clean instead of spending every future frame catching up.
      this.accumulator = 0;
    }
    return steps;
  }

  private readonly frame = (nowMs: number): void => {
    if (!this.running) return;
    const deltaSeconds = (nowMs - this.lastFrameTime) / 1000;
    this.lastFrameTime = nowMs;
    this.advance(deltaSeconds);
    this.renderCallback();
    this.frameHandle = requestAnimationFrame(this.frame);
  };
}
