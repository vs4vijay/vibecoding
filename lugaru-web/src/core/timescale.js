/**
 * Frame-rate-independent time scaling: hitstop (freeze) and slow-motion.
 *
 * update(realDtMs) returns the effective dt multiplier for THIS frame:
 * - hitstop consumes real dt first; a frame that outlasts the remaining
 *   freeze runs its leftover dt through normal scaling;
 * - slow-mo scales that leftover dt and decays linearly back to 1 across
 *   its remaining duration, easing out instead of snapping off.
 */
export class Timescale {
    value = 1;
    hitstopMsLeft = 0;
    slowScale = 1;
    slowDurationMs = 0;
    slowMsLeft = 0;
    /** Freeze sim time for durationMs of real time. */
    hitstop(durationMs) {
        this.hitstopMsLeft = Math.max(this.hitstopMsLeft, 0) + durationMs;
    }
    /** Scale time to `scale` for durationMs of real time, easing back to 1. */
    slowmo(scale, durationMs) {
        this.slowScale = scale;
        this.slowDurationMs = durationMs;
        this.slowMsLeft = durationMs; // a fresh slowmo replaces any carried state
    }
    /** Returns the effective dt multiplier for this frame. */
    update(realDtMs) {
        // Hitstop consumes real dt first; slow-mo decays only across the remainder.
        let dt = realDtMs;
        if (this.hitstopMsLeft > 0) {
            const consumed = Math.min(this.hitstopMsLeft, dt);
            this.hitstopMsLeft -= consumed;
            dt -= consumed;
            if (this.hitstopMsLeft > 0) {
                this.value = 0;
                return 0;
            }
            // Freeze expired mid-frame: frame continues with the leftover dt.
        }
        let multiplier = 1;
        if (this.slowMsLeft > 0) {
            const elapsed = this.slowDurationMs - this.slowMsLeft;
            const t = Math.min(elapsed / this.slowDurationMs, 1);
            multiplier = this.slowScale + (1 - this.slowScale) * t;
            this.slowMsLeft = Math.max(0, this.slowMsLeft - dt);
        }
        this.value = multiplier;
        return multiplier;
    }
}
