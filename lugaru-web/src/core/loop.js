/** Maximum sim steps executed per advance() call (catch-up clamp). */
const MAX_CATCH_UP = 4;
/**
 * Fixed-timestep accumulator loop.
 *
 * advance(realDtMs) drains the accumulator in whole stepMs increments and
 * calls `update(stepMs)` once per step. Catch-up is clamped to MAX_CATCH_UP
 * steps; any accumulated debt beyond that is dropped so a long freeze
 * (e.g. tab-away) cannot spiral into unbounded catch-up work.
 */
export class FixedLoop {
    stepMs;
    update;
    acc = 0;
    constructor(stepMs, update) {
        this.stepMs = stepMs;
        this.update = update;
    }
    /** Returns the number of steps executed this frame. */
    advance(realDtMs) {
        this.acc += realDtMs;
        let n = Math.floor(this.acc / this.stepMs);
        n = Math.min(n, MAX_CATCH_UP);
        this.acc -= n * this.stepMs;
        if (this.acc > this.stepMs * MAX_CATCH_UP)
            this.acc = 0; // drop debt beyond clamp window
        for (let i = 0; i < n; i++)
            this.update(this.stepMs);
        return n;
    }
}
