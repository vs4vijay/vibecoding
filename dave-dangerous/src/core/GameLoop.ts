// src/core/GameLoop.ts
export interface LoopCallbacks {
  update(dt: number): void;
  render(alpha: number): void;
}

export class GameLoop {
  private readonly dt: number;
  private readonly maxAccum: number;
  private readonly cb: LoopCallbacks;
  private accum = 0;
  private last: number | null = null;
  private rafId: number | null = null;

  constructor(cb: LoopCallbacks, dt = 1 / 60) {
    this.cb = cb;
    this.dt = dt;
    this.maxAccum = dt * 5; // spiral-of-death guard
  }

  attach(raf: (f: () => void) => void): void {
    this.last = null;
    this.accum = 0;
    const tick = () => { raf(tick); this.frame(performance.now()); };
    tick();
  }

  frame(nowMs: number): void {
    if (this.last === null) { this.last = nowMs; return; }
    const delta = Math.min((nowMs - this.last) / 1000, this.maxAccum);
    this.last = nowMs;
    this.accum += delta;
    while (this.accum >= this.dt) {
      this.cb.update(this.dt);
      this.accum -= this.dt;
    }
    const alpha = this.accum / this.dt;
    this.cb.render(alpha);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.last = null;
  }
}
