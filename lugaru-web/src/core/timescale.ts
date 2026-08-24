/**
 * Frame-rate-independent time scaling: hitstop (freeze) and slow-motion.
 *
 * update(realDtMs) returns the effective dt multiplier for THIS frame:
 * - hitstop consumes real dt first; a frame that outlasts the remaining
 *   freeze runs at full speed;
 * - slow-mo then scales the frame and decays linearly back to 1 across its
 *   remaining duration, easing out instead of snapping off.
 */
export class Timescale {
  value = 1;
  private hitstopMsLeft = 0;
  private slowScale = 1;
  private slowDurationMs = 0;
  private slowMsLeft = 0;

  /** Freeze sim time for durationMs of real time. */
  hitstop(durationMs: number): void {
    this.hitstopMsLeft = Math.max(this.hitstopMsLeft, 0) + durationMs;
  }

  /** Scale time to `scale` for durationMs of real time, easing back to 1. */
  slowmo(scale: number, durationMs: number): void {
    this.slowScale = scale;
    this.slowDurationMs = durationMs;
    this.slowMsLeft = Math.max(this.slowMsLeft, durationMs);
  }

  /** Returns the effective dt multiplier for this frame. */
  update(realDtMs: number): number {
    if (this.hitstopMsLeft > 0) {
      this.hitstopMsLeft = Math.max(0, this.hitstopMsLeft - realDtMs);
      if (this.hitstopMsLeft > 0) {
        this.value = 0;
        return 0;
      }
      // Expired mid-frame: this frame runs at full speed.
    }
    let multiplier = 1;
    if (this.slowMsLeft > 0) {
      const elapsed = this.slowDurationMs - this.slowMsLeft;
      const t = Math.min(elapsed / this.slowDurationMs, 1);
      multiplier = this.slowScale + (1 - this.slowScale) * t;
      this.slowMsLeft = Math.max(0, this.slowMsLeft - realDtMs);
    }
    this.value = multiplier;
    return multiplier;
  }
}
