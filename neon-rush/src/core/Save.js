// localStorage persistence — key versioned per ARCHITECTURE.md.
const KEY = 'neonrush.save.v1';

// W1-UI additive extension: only fields present here persist (merge whitelist).
// skin: equipped skin id · unlocks: owned skin ids + 'perk:*' ids ·
// shards: mystery-box skin shards (5 → random skin) · x2Next: ×2 coins next run ·
// charges: consumables from mystery boxes (later waves consume via getters) ·
// tipsSeen: first-run hints shown · stats.boxesOpened: lifetime box count (mission gate).
const DEFAULTS = () => ({
  v: 1,
  best: 0,
  coins: 0,
  xp: 0,
  level: 1,
  skin: 'cyber',
  unlocks: [],
  shards: 0,
  x2Next: false,
  tipsSeen: false,
  charges: { x2: 0, shield: 0, headstart: 0 },
  missions: [],
  daily: { date: '', score: 0, streak: 0 },
  settings: { mute: false, quality: 'auto', bloom: true },
  stats: { runs: 0, totalM: 0, totalCoins: 0, boxesOpened: 0 },
});

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function merge(base, patch) {
  if (!isObj(patch)) return base;
  for (const k in patch) {
    if (!(k in base)) continue; // unknown fields from older/newer versions are dropped
    if (isObj(base[k]) && isObj(patch[k])) merge(base[k], patch[k]);
    else base[k] = patch[k];
  }
  return base;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS();
    const blob = JSON.parse(raw);
    const data = merge(DEFAULTS(), blob);
    // A pre-tipsSeen save belongs to an existing player — missing key means 'seen',
    // not first-run (fresh saves keep the DEFAULTS false). No migration write.
    if (isObj(blob) && !('tipsSeen' in blob)) data.tipsSeen = true;
    return data;
  } catch (e) {
    return DEFAULTS();
  }
}

class Save {
  constructor() {
    this.data = load();
    this._timer = 0;
  }

  // Debounced — call freely (per coin, per run).
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 350);
  }

  flush() {
    clearTimeout(this._timer);
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* private mode */ }
  }

  // Silent onboarding: first 3 runs are slower/sparser (read by Director).
  get onboard() { return this.data.stats.runs < 3; }
}

export const save = new Save();

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => save.flush());
  window.addEventListener('beforeunload', () => save.flush());
}
