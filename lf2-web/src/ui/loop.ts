export interface LoopOpts {
  tickMs: number;
  maxCatchUpMs: number;
  update: () => void;
  render: (alpha: number) => void;
}

export function createLoop(opts: LoopOpts) {
  let acc = 0;
  let prev: number | null = null;
  let running = false;
  let raf = 0;

  function tick(nowMs: number): void {
    if (prev === null) { prev = nowMs; return; }         // prime
    acc += Math.min(nowMs - prev, opts.maxCatchUpMs);
    prev = nowMs;
    while (acc >= opts.tickMs) { opts.update(); acc -= opts.tickMs; }
    opts.render(acc / opts.tickMs);
  }

  function frame(nowMs: number): void {
    if (!running) return;
    tick(nowMs);
    raf = requestAnimationFrame(frame);
  }

  return {
    start() { if (running) return; running = true; prev = null; acc = 0; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    tick,
  };
}
