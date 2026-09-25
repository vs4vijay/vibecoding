// Basic W0 scoring: score = dist × speedTier + coins × combo (+style points).
// Combo rises on coin / near-miss, decays after 5 s idle, tiers 1–5,
// emits bus 'combo:change'{tier}.
import { bus } from '../core/EventBus.js';
import { sound } from '../core/Sound.js';

const TIER_SPEEDS = [12, 19, 26, 33]; // ≥ index → tier index+1 (40 → tier 5)
const COMBO_IDLE = 5;                 // s without pickup → decay
const COIN_BASE = 10;
const NEAR_MISS_STYLE = 25;
const DRIFT_STYLE = 10;               // per drift link (DriftPhase emits style:drift)
const PERFECT_STYLE = 50;             // perfect stack gate (StackPhase emits style:perfect)

function speedTier(speed) {
  let t = 1;
  for (let i = 0; i < TIER_SPEEDS.length; i++) if (speed >= TIER_SPEEDS[i]) t = i + 1;
  return t;
}

export class Scoring {
  constructor() {
    this._coinPayload = { tier: 1 };
    this.reset();
    // payloads are shared/reused — read synchronously, never retain (see EventBus)
    bus.on('coin', () => this.addCoin());
    bus.on('near-miss', () => this.addStyle(NEAR_MISS_STYLE));
    // [W1-FEEL] phase style events — names matched to the emitters:
    // DriftPhase emits 'style:drift'{chain}, StackPhase emits 'style:perfect'{at}
    bus.on('style:drift', () => this.addStyle(DRIFT_STYLE));
    bus.on('style:perfect', () => this.addStyle(PERFECT_STYLE));
  }

  init(director) { this.director = director; }

  reset() {
    this.score = 0;
    this.coinPoints = 0;
    this.stylePoints = 0;
    this.dist = 0;
    this.runCoins = 0;
    this.combo = 0;
    this.comboTier = 1;
    this.comboTimer = 0;
    this.comboGuard = false; // re-armed from the COMBO GUARD implant by Game.startRun
    this.fever = false;
  }

  // Photo API ?tier=<combo-tier>
  forceTier(tier) {
    this.comboTier = Math.max(1, Math.min(5, tier | 0));
    bus.emit('combo:change', { tier: this.comboTier });
  }

  addCoin() {
    const mult = this.fever ? 2 : 1;
    this.runCoins += mult;
    this.coinPoints += COIN_BASE * this.comboTier * mult;
    this.bumpCombo();
    this.comboTimer = 0;
  }

  addStyle(points) {
    this.stylePoints += points;
    this.bumpCombo();
    this.comboTimer = 0;
  }

  bumpCombo() {
    this.combo++;
    const tier = Math.max(1, Math.min(5, 1 + Math.floor(this.combo / 6)));
    if (tier !== this.comboTier) {
      this.comboTier = tier;
      bus.emit('combo:change', { tier });
      sound('combo', { tier });
    }
  }

  update(dt, dist, speed, fever) {
    this.dist = dist;
    this.fever = fever;
    if (this.combo > 0) {
      this.comboTimer += dt;
      if (this.comboTimer > COMBO_IDLE) {
        // COMBO GUARD: decay at half rate while the implant is armed this run
        this.combo = Math.max(0, this.combo - dt * (this.comboGuard ? 7 : 14));
        const tier = Math.max(1, Math.min(5, 1 + Math.floor(this.combo / 6)));
        if (tier !== this.comboTier) {
          this.comboTier = tier;
          bus.emit('combo:change', { tier });
        }
        if (this.combo === 0) this.comboTimer = 0;
      }
    }
    const tier = speedTier(speed);
    this.score = Math.floor(dist * tier) + this.coinPoints + this.stylePoints;
  }
}
