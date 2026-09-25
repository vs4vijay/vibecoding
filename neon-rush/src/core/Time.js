// Fixed-step 60 Hz accumulator. All gameplay mutates state only inside ticks,
// so warp(N) (N*60 ticks, no rendering) is bit-identical to N real seconds.
export class Time {
  constructor() {
    this.step = 1 / 60;
    this.acc = 0;          // seconds since last consumed tick
    this.gameTime = 0;     // simulated seconds this run
    this.scale = 1;        // hitstop / slow-mo hook
    this.maxStep = 0.1;    // clamp dt (tab-switch tunneling guard)
  }

  // Returns number of ticks executed this frame.
  advance(dtReal, tick) {
    const dt = Math.min(dtReal, this.maxStep) * this.scale;
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.step) {
      tick(this.step);
      this.gameTime += this.step;
      this.acc -= this.step;
      if (++n >= 12) { this.acc = 0; break; } // spiral-of-death guard
    }
    return n;
  }

  // Fast-forward logic deterministically without rendering.
  warp(seconds, tick) {
    const n = Math.min(Math.round(seconds / this.step), 60 * 1200);
    for (let i = 0; i < n; i++) {
      tick(this.step);
      this.gameTime += this.step;
    }
  }

  // Fraction [0,1) of the step currently accumulated — render interpolation.
  get fraction() { return this.acc / this.step; }

  reset() { this.acc = 0; this.gameTime = 0; this.scale = 1; }
}
