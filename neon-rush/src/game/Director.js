// Dynamic difficulty: speed ramp 12→40 m/s over ~10 min, never drops.
// First 3 runs (Save.stats) are ~20% slower and sparser — silent onboarding.
//
// [W1-FEEL] flow channel: a rolling performance window (near-miss rate, coin
// rate, time spent at combo ×2+) nudges difficulty WITHIN the caps —
//   · the speed ramp itself is untouched (still 12→40 over ~10 min, monotonic)
//   · the difficulty() rating gate stays; flow only shifts its speed
//     thresholds by ≤ ±1.5 m/s (cruising players meet hard patterns sooner,
//     struggling players get a longer on-ramp)
//   · density (exported via `flow`, consumed by Patterns as a hazard keep-rate)
//     never exceeds 1 and never drops below 0.7
// Fever itself is scheduled by Game (every 3rd phase → director.fever).
import { save } from '../core/Save.js';
import { bus } from '../core/EventBus.js';

const V_MIN = 12, V_MAX = 40, RAMP_S = 600;
const ONBOARD_FACTOR = 0.8;
const FLOW_TICK = 1;      // s between flow-window updates
const FLOW_SMOOTH = 0.35; // EMA weight of the newest 1 s window
const DENSITY_MIN = 0.7;

// Shared flow state (read by Patterns during populate — one reused object,
// never reallocated). perf ∈ [0,1]; density = hazard keep-rate.
export const flow = { perf: 0.5, density: 1 };

export class Director {
  constructor() {
    this.reset();
    this._nmS = 0.5;  // smoothed near-miss score [0..1]
    this._coinS = 0.5;
    this._hotS = 0.5;
    this._comboTier = 1;
    // flow event counters (impulses drained by the 1 s tick; hot accumulates time)
    this._nm = 0;
    this._coins = 0;
    this._hotAcc = 0;
    this._tickAcc = 0;
    bus.on('near-miss', () => { this._nm++; });
    bus.on('coin', () => { this._coins++; });
    bus.on('combo:change', (p) => { if (p && p.tier) this._comboTier = p.tier; });
  }

  reset() {
    this.elapsed = 0;
    this.onboard = save.onboard;
    const v0 = V_MIN * (this.onboard ? ONBOARD_FACTOR : 1);
    this.speed = v0;
    this.tier = 1;
    this.fever = false;
    this.perf = 0.5;
    this._nm = 0;
    this._coins = 0;
    this._hotAcc = 0;
    this._tickAcc = 0;
    this._comboTier = 1;
  }

  update(dt) {
    this.elapsed += dt;
    let target = V_MIN + (V_MAX - V_MIN) * Math.min(1, this.elapsed / RAMP_S);
    if (this.onboard) target *= ONBOARD_FACTOR;
    if (target > this.speed) this.speed = target; // never drops mid-run
    const t = this.difficulty() + 1;
    if (t !== this.tier) {
      this.tier = t;
      bus.emit('speed:change', { v: this.speed, tier: t });
    }

    // flow window (1 s ticks — off the hot path)
    if (this._comboTier >= 2) this._hotAcc += dt;
    this._tickAcc += dt;
    if (this._tickAcc >= FLOW_TICK) {
      this._tickAcc -= FLOW_TICK;
      const nmS = Math.min(1, this._nm / 0.4);     // 0.4 near-misses/s ≈ flowing
      const coinS = Math.min(1, this._coins / 2.5); // 2.5 coins/s ≈ collecting lines
      const hotS = Math.min(1, this._hotAcc);
      this._nmS += (nmS - this._nmS) * FLOW_SMOOTH;
      this._coinS += (coinS - this._coinS) * FLOW_SMOOTH;
      this._hotS += (hotS - this._hotS) * FLOW_SMOOTH;
      this._nm = 0;
      this._coins = 0;
      this._hotAcc = 0;
      this.perf = this._nmS * 0.4 + this._hotS * 0.3 + this._coinS * 0.3;
    }
    flow.perf = this.perf;
    flow.density = this.onboard ? 0.65
      : Math.max(DENSITY_MIN, Math.min(1, 1 - (0.45 - this.perf) * 0.6));
  }

  // Pattern rating gate: 0 easy / 1 med / 2 hard.
  // [W1-FEEL] thresholds shift ≤ ±1.5 m/s with the flow window; the gate and
  // the speed ramp are otherwise exactly as contracted.
  difficulty() {
    if (this.onboard) return 0;
    const nudge = (this.perf - 0.5) * 3;
    if (this.speed < 20 - nudge) return 0;
    if (this.speed < 30 - nudge) return 1;
    return 2;
  }

  // Sparser spawns while onboarding; flow-modulated otherwise (consumed via
  // `flow.density` in Patterns).
  density() {
    return flow.density;
  }
}
