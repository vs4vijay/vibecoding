/**
 * Wall-clock FPS sampler (Midtown Blitz engine, task 6.2).
 *
 * A tiny rolling-window frame-rate meter for the ?debug perf readout: the
 * caller feeds every RENDERED frame's wall-clock timestamp (rAF count over
 * wall time — deliberately independent of the fixed-timestep sim clock, so
 * it measures what the profiler measures), and reads back:
 *
 *  - `avgFps`: frames per second over the whole window (default 5 s) —
 *    the number the "60 s profiler run averages >= 55 fps" check reads.
 *  - `minFps`: the WORST trailing 1 s sub-window within the window — a
 *    stable "worst second" (1%-low style) figure. A single-frame spike
 *    does not collapse it, but a real hitch (stall, shader compile, GC
 *    burst) dents the one-second windows it lands in.
 *
 * Cost: one array push + a bounded trim per frame (splice shifts in place,
 * no allocation), and an O(n) scan per read (n <= a few hundred; reads are
 * throttled to ~4 Hz by the only caller, the ?debug quality panel). Both
 * hot functions are allocation-free — they are covered by the static
 * allocation scan in scripts/perf-audit-test.mjs.
 *
 * Timestamps come from the caller (performance.now() in the app) so the
 * module stays pure and plain-node testable: scripts/perf-audit-test.mjs
 * drives it with synthetic frame times.
 */

/** Rolling window length (ms) for the average reading. */
export const FPS_WINDOW_MS = 5000;

/** Trailing sub-window (ms) for the worst-second reading. */
export const FPS_MIN_WINDOW_MS = 1000;

/**
 * Hard sample cap (240 fps * 5 s window + slack) — bounds memory even if
 * a caller feeds timestamps faster than any real display.
 */
const MAX_SAMPLES = 1300;

/**
 * Handle for a created FPS meter.
 *
 * @typedef {object} FpsMeter
 * @property {(nowMs: number) => void} frame Record one rendered frame at
 *   the given wall-clock millisecond timestamp (non-finite values are
 *   ignored).
 * @property {(out?: FpsReading) => FpsReading} read Compute the current
 *   readings. Pass a reused out object from hot call sites (the module
 *   writes every field); omitting it allocates a fresh result.
 */

/**
 * Readings returned by {@link FpsMeter.read}.
 *
 * @typedef {object} FpsReading
 * @property {number} avgFps Average fps over the window; 0 until at least
 *   two frames are inside it.
 * @property {number} minFps Worst trailing-1 s fps inside the window; 0
 *   until two frames are inside it.
 * @property {number} frames Sample count currently inside the window.
 */

/**
 * Create an FPS meter over a rolling wall-clock window.
 * @param {object} [options] Options.
 * @param {number} [options.windowMs=FPS_WINDOW_MS] Rolling window length.
 * @param {number} [options.minWindowMs=FPS_MIN_WINDOW_MS] Trailing
 *   sub-window length for the worst-second reading.
 * @returns {FpsMeter} The meter.
 */
export function createFpsMeter({ windowMs = FPS_WINDOW_MS, minWindowMs = FPS_MIN_WINDOW_MS } = {}) {
  /** Ascending frame timestamps (ms) currently inside the window. */
  const samples = [];

  /**
   * Record one rendered frame and drop samples that fell out of the window.
   * @param {number} nowMs Wall-clock timestamp (ms).
   * @returns {void}
   */
  function frame(nowMs) {
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return;
    samples.push(nowMs);
    const cutoff = nowMs - windowMs;
    let drop = 0;
    while (drop < samples.length && samples[drop] < cutoff) drop += 1;
    if (drop > 0) samples.splice(0, drop); // in-place shift, no allocation
    if (samples.length > MAX_SAMPLES) {
      samples.splice(0, samples.length - MAX_SAMPLES);
    }
  }

  /**
   * Compute the current readings (see module header for the definitions).
   * @param {FpsReading} [out] Reused result object (every field written).
   * @returns {FpsReading} The filled readings.
   */
  function read(out) {
    const result = out ?? { avgFps: 0, minFps: 0, frames: 0 };
    const n = samples.length;
    result.frames = n;
    if (n < 2) {
      result.avgFps = 0;
      result.minFps = 0;
      return result;
    }

    const first = samples[0];
    const last = samples[n - 1];
    const spanS = (last - first) / 1000;
    result.avgFps = spanS > 0 ? (n - 1) / spanS : 0;

    // Worst trailing sub-window: for every frame-as-end, fps of the frames
    // inside the preceding minWindowMs (two-pointer scan, O(n) total).
    let min = Infinity;
    let s = 0;
    for (let e = 1; e < n; e += 1) {
      const tEnd = samples[e];
      while (tEnd - samples[s] > minWindowMs) s += 1;
      const intervals = e - s;
      const subSpanS = (tEnd - samples[s]) / 1000;
      if (intervals >= 1 && subSpanS > 0) {
        const fps = intervals / subSpanS;
        if (fps < min) min = fps;
      }
    }
    result.minFps = Number.isFinite(min) ? min : result.avgFps;
    return result;
  }

  return { frame, read };
}
