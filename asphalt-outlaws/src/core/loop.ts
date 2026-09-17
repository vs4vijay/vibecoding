// Fixed-timestep game loop: update runs at a constant rate, render at rAF.
// The accumulator is clamped so a background tab / stall doesn't fast-forward
// the sim.

export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  constructor(
    private readonly step: number,
    private readonly update: (dt: number) => void,
    private readonly render: (frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    const tick = (now: number): void => {
      if (!this.running) return;
      const frameDt = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      this.acc += frameDt;
      let steps = 0;
      while (this.acc >= this.step && steps < 5) {
        this.update(this.step);
        this.acc -= this.step;
        steps++;
      }
      this.render(frameDt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }
}
