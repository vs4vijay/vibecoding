// Quality tiers + fps monitor with auto-drop (fps < 50 for 3 s).
// Other modules read `quality.flags` — { bloom, shadows, pixelRatio,
// particleDensity, drawDistance } — never hardcode their own.
import { bus } from './EventBus.js';

// [W1-FX] extended tier defs with post-stack flags (bloomRes = fraction of
// screen res for the bloom mip chain; grain/ca/radial/scan gate parts of the
// final grade pass). Original keys + auto-drop behavior unchanged; MED keeps
// bloom but at half res, LOW renders directly without the composer.
const TIERS = {
  ULTRA: { bloom: true,  shadows: false, pixelRatio: 2,    particleDensity: 1,    drawDistance: 1,
           bloomRes: 1,    grain: true,  ca: true,  radial: true,  scan: true },
  HIGH:  { bloom: true,  shadows: false, pixelRatio: 1.5,  particleDensity: 0.75, drawDistance: 0.9,
           bloomRes: 0.75, grain: true,  ca: true,  radial: false, scan: true },
  MED:   { bloom: true,  shadows: false, pixelRatio: 1.2,  particleDensity: 0.5,  drawDistance: 0.65,
           bloomRes: 0.5,  grain: false, ca: true,  radial: false, scan: false },
  LOW:   { bloom: false, shadows: false, pixelRatio: 1,    particleDensity: 0.3,  drawDistance: 0.65,
           bloomRes: 0,    grain: false, ca: false, radial: false, scan: false },
};
const ORDER = ['LOW', 'MED', 'HIGH', 'ULTRA']; // ascending

class Quality {
  constructor() {
    this.name = 'ULTRA';
    this.adaptive = true;
    this.fps = 60;
    this._slow = 0;
    this.onApply = null; // set by main.js: (flags) => renderer.setPixelRatio(...)
    this.onFlags = null; // [W1-FX] set by PostFX: (flags) => rebuild post stack
  }

  get flags() { return TIERS[this.name]; }

  set(name) {
    if (!TIERS[name] || name === this.name) return;
    this.name = name;
    this.apply();
  }

  drop() {
    const i = ORDER.indexOf(this.name);
    if (i <= 0) return;
    this.name = ORDER[i - 1];
    this.apply();
    bus.emit('ui:toast', { msg: `QUALITY → ${this.name}`, kind: 'system' });
  }

  apply() {
    if (this.onApply) this.onApply(this.flags);
    if (this.onFlags) this.onFlags(this.flags); // [W1-FX]
  }

  // dtReal: raw unclamped frame delta, seconds.
  update(dtReal) {
    const inst = 1 / Math.max(dtReal, 1e-4);
    this.fps += (inst - this.fps) * 0.05;
    if (!this.adaptive) return;
    if (this.fps < 50) {
      this._slow += dtReal;
      if (this._slow > 3) { this.drop(); this._slow = 0; }
    } else {
      this._slow = Math.max(0, this._slow - dtReal * 2);
    }
  }
}

export const quality = new Quality();
