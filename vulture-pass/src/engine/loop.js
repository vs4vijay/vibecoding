// Fixed-timestep simulation with interpolated render (D7).
//
// update(step) runs at exactly `hz` steps per second of accumulated wall
// time; render(dt, alpha) runs once per animation frame with alpha = the
// fraction of the next sim step already elapsed (for transform interpolation).

export function createLoop({ update, render, hz = 60, maxCatchupSteps = 240 }) {
  const step = 1 / hz;
  let running = false;
  let raf = 0;
  let last = 0;
  let acc = 0;

  const stats = {
    steps: 0, // total sim steps executed
    stepsPerSecond: 0,
    fps: 0,
    alpha: 0,
  };

  let stepWindow = 0;
  let stepCount = 0;
  let frameWindow = 0;
  let frameCount = 0;

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);

    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25; // tab-background spike guard

    acc += dt;
    let n = 0;
    while (acc >= step && n < maxCatchupSteps) {
      update(step);
      acc -= step;
      stats.steps++;
      stepCount++;
      n++;
    }
    if (n === maxCatchupSteps) acc = 0; // fell too far behind; drop the debt

    stats.alpha = acc / step;
    render(dt, stats.alpha);

    stepWindow += dt;
    frameWindow += dt;
    frameCount++;
    if (stepWindow >= 0.5) {
      stats.stepsPerSecond = Math.round(stepCount / stepWindow);
      stepCount = 0;
      stepWindow = 0;
    }
    if (frameWindow >= 0.5) {
      stats.fps = Math.round(frameCount / frameWindow);
      frameCount = 0;
      frameWindow = 0;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    get stats() {
      return stats;
    },
    get running() {
      return running;
    },
  };
}
