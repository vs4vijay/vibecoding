/**
 * Fixed-timestep game loop (Midtown Blitz engine, task 1.2).
 *
 * The simulation advances in fixed SIM_DT (1/60 s) steps via an accumulator
 * fed with requestAnimationFrame timestamps; rendering happens once per
 * frame and receives an interpolation alpha in [0, 1) so visual transforms
 * can be lerped between the previous and current simulation states
 * (design Decision 3). This decouples simulation from frame rate: the sim
 * clock tracks wall clock at any rendered frame rate.
 *
 * Catch-up is clamped: a single frame runs at most MAX_TICKS_PER_FRAME
 * ticks; accumulated time beyond that is dropped, so a stalled tab or long
 * hitch can never teleport the simulation (visual time may lag after a
 * stall, but never skips ahead by more than the clamp).
 *
 * The core is a pure timestamp-driven `frame(nowMs)` step so it can be
 * driven from Node with scripted frame times; the browser `start`/`stop`
 * rAF driver is a thin wrapper around it.
 */

/** Fixed simulation step in seconds (60 Hz). */
export const SIM_DT = 1 / 60;

/** Maximum simulation ticks a single rendered frame may catch up before time is dropped. */
export const MAX_TICKS_PER_FRAME = 5;

const MS_TO_S = 1 / 1000;

/**
 * Called once per simulation tick, in order.
 *
 * @callback LoopUpdateFn
 * @param {number} dt Fixed step in seconds (always SIM_DT).
 * @param {number} simTime Simulation clock in seconds, after this tick.
 */

/**
 * Called once per rendered frame, after all of that frame's ticks.
 *
 * @callback LoopRenderFn
 * @param {number} alpha Interpolation fraction in [0, 1): 0 means "exactly
 *   the previous tick's state", values approaching 1 blend toward the
 *   current tick's state. Lerp visual transforms between the two states.
 * @param {LoopFrameInfo} info Diagnostics for the frame being rendered.
 */

/**
 * Per-frame diagnostics returned by {@link FixedTimestepLoop#frame} and
 * passed to the render hook.
 *
 * @typedef {object} LoopFrameInfo
 * @property {number} ticks Simulation ticks executed this frame (at most
 *   MAX_TICKS_PER_FRAME).
 * @property {number} alpha Interpolation fraction in [0, 1).
 * @property {number} simTime Simulation clock in seconds; advances only in
 *   SIM_DT increments, only via ticks.
 * @property {number} visualTime Interpolated visual time in seconds, always
 *   within one tick of simTime (in [simTime - SIM_DT, simTime]): the point
 *   between the previous and current tick state that should be displayed.
 * @property {number} droppedTime Wall-clock seconds discarded this frame
 *   because the catch-up clamp was hit (0 in normal operation).
 * @property {number} frameDelta Wall-clock seconds since the previous frame.
 */

/**
 * Handle for a created fixed-timestep loop.
 *
 * @typedef {object} FixedTimestepLoop
 * @property {(nowMs: number) => LoopFrameInfo} frame Advance the loop to the
 *   given rAF-style millisecond timestamp: accumulates wall time, runs the
 *   clamped catch-up ticks, and returns the frame info for rendering.
 * @property {() => void} start Begin driving the loop from
 *   requestAnimationFrame (browser only). Safe to call twice.
 * @property {() => void} stop Stop the rAF driver.
 * @property {() => number} simTime Current simulation clock in seconds.
 * @property {() => number} alpha Current interpolation fraction in [0, 1).
 */

/**
 * Create a fixed-timestep loop with clamped catch-up and a render
 * interpolation hook.
 *
 * @param {object} options Loop configuration.
 * @param {LoopUpdateFn} options.update Per-tick simulation update (required).
 * @param {LoopRenderFn} [options.render] Per-frame render hook receiving the
 *   interpolation alpha and frame info.
 * @param {number} [options.simDt=SIM_DT] Fixed step in seconds.
 * @param {number} [options.maxTicksPerFrame=MAX_TICKS_PER_FRAME] Catch-up
 *   clamp; accumulated time beyond this many ticks per frame is dropped.
 * @returns {FixedTimestepLoop} The loop handle.
 */
export function createFixedTimestepLoop({
  update,
  render,
  simDt = SIM_DT,
  maxTicksPerFrame = MAX_TICKS_PER_FRAME,
} = {}) {
  if (typeof update !== 'function') {
    throw new TypeError('createFixedTimestepLoop: an update callback is required');
  }

  let lastNowMs = null; // Previous frame timestamp (ms); null until the first frame.
  let accS = 0; // Accumulated, not-yet-simulated wall time in seconds.
  let simTimeS = 0; // Simulation clock in seconds.
  let alpha = 0; // Current interpolation fraction in [0, 1).
  let rafId = 0;
  let running = false;

  /**
   * Advance the loop to `nowMs` and return the info needed to render.
   * Deterministic in the timestamp stream, so test harnesses can drive it
   * with scripted frame times instead of requestAnimationFrame.
   *
   * @param {number} nowMs rAF-style millisecond timestamp.
   * @returns {LoopFrameInfo} Frame info (ticks, alpha, clocks, dropped time).
   */
  function frame(nowMs) {
    let frameDelta = 0;
    if (lastNowMs !== null) {
      frameDelta = Math.max(0, (nowMs - lastNowMs) * MS_TO_S);
      accS += frameDelta;
    }
    lastNowMs = nowMs;

    let ticks = 0;
    while (ticks < maxTicksPerFrame && accS >= simDt) {
      accS -= simDt;
      simTimeS += simDt;
      ticks += 1;
      update(simDt, simTimeS);
    }

    let droppedTime = 0;
    if (accS >= simDt) {
      // Catch-up clamp hit: a severe stall left more backlog than we are
      // willing to simulate in one frame. Drop it (including the partial
      // remainder) so the sim never teleports; the sim clock lags wall
      // clock by exactly this amount from here on.
      droppedTime = accS;
      accS = 0;
    }

    alpha = simDt > 0 ? accS / simDt : 0;
    // The render target sits between the previous tick (alpha = 0) and the
    // current tick (alpha -> 1), i.e. always within one tick of simTime and
    // never ahead of the latest simulated state.
    const visualTime = simTimeS - (1 - alpha) * simDt;

    return { ticks, alpha, simTime: simTimeS, visualTime, droppedTime, frameDelta };
  }

  /**
   * rAF callback: run one frame and hand the info to the render hook.
   * @param {number} nowMs DOMHighResTimeStamp from requestAnimationFrame.
   * @returns {void}
   */
  function onRaf(nowMs) {
    if (!running) return;
    const info = frame(nowMs);
    if (typeof render === 'function') render(info.alpha, info);
    rafId = requestAnimationFrame(onRaf);
  }

  /**
   * Start the requestAnimationFrame driver (browser only; Node harnesses
   * should call `frame(nowMs)` directly). Ignores any idle time before the
   * first frame so starting never causes a catch-up burst.
   * @returns {void}
   */
  function start() {
    if (typeof requestAnimationFrame !== 'function') {
      throw new Error(
        'FixedTimestepLoop.start: requestAnimationFrame is unavailable; drive frame(nowMs) directly instead'
      );
    }
    if (running) return;
    running = true;
    lastNowMs = null;
    rafId = requestAnimationFrame(onRaf);
  }

  /**
   * Stop the requestAnimationFrame driver.
   * @returns {void}
   */
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  return {
    frame,
    start,
    stop,
    /** @returns {number} Current simulation clock in seconds. */
    get simTime() {
      return simTimeS;
    },
    /** @returns {number} Current interpolation fraction in [0, 1). */
    get alpha() {
      return alpha;
    },
  };
}
