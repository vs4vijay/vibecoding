// W1-UI missions: 3 active missions, live progress from bus events, auto-claim
// (coin reward + toast + 'mission:complete') and auto-refill on completion.
// Templates ONLY use events that fire in today's build: coin, near-miss,
// phase:start{id}, combo:change, style:drift, style:perfect, speed:change,
// run:end (distance/score). Persisted in save.data.missions.
import { bus } from '../core/EventBus.js';
import { save } from '../core/Save.js';

// mode: 'sum' accumulates deltas · 'max' tracks the peak payload value.
// reset: 'run' clears progress on run:start (in-one-run missions).
const TEMPLATES = [
  { tpl: 'coins_run', ev: 'coin', mode: 'sum', reset: 'run', goals: [40, 60, 80], reward: 80, desc: (g) => `COLLECT ${g} COINS IN ONE RUN` },
  { tpl: 'coins_tot', ev: 'coin', mode: 'sum', reset: null, goals: [150, 250], reward: 110, desc: (g) => `COLLECT ${g} COINS` },
  { tpl: 'near_run', ev: 'near-miss', mode: 'sum', reset: 'run', goals: [6, 10], reward: 90, desc: (g) => `${g} NEAR MISSES IN ONE RUN` },
  { tpl: 'near_tot', ev: 'near-miss', mode: 'sum', reset: null, goals: [25, 40], reward: 120, desc: (g) => `${g} NEAR MISSES` },
  { tpl: 'drift_tot', ev: 'style:drift', mode: 'sum', reset: null, goals: [8, 15], reward: 100, desc: (g) => `LINK ${g} DRIFT STYLES` },
  { tpl: 'perfect_tot', ev: 'style:perfect', mode: 'sum', reset: null, goals: [6, 12], reward: 100, desc: (g) => `NAIL ${g} PERFECT STYLES` },
  { tpl: 'combo_tier', ev: 'combo:change', mode: 'max', reset: null, goals: [3, 4, 5], reward: 120, desc: (g) => `REACH COMBO ×${g}`, val: (p) => (p && p.tier) || 1 },
  { tpl: 'speed_tier', ev: 'speed:change', mode: 'max', reset: null, goals: [3, 4, 5], reward: 120, desc: (g) => `HIT SPEED TIER ${g}`, val: (p) => (p && p.tier) || 1 },
  { tpl: 'phase_any', ev: 'phase:start', mode: 'sum', reset: null, goals: [5, 9], reward: 100, desc: (g) => `SURVIVE ${g} ZONE TRANSITIONS`, val: (p) => (p && p.id !== 'run' ? 1 : 0) },
  { tpl: 'zone_flight', ev: 'phase:start', mode: 'max', reset: null, goals: [1], reward: 70, desc: () => 'REACH THE FLIGHT ZONE', val: (p) => (p && p.id === 'flight' ? 1 : 0) },
  { tpl: 'score_run', ev: 'run:end', mode: 'max', reset: 'run', goals: [4000, 8000, 15000], reward: 130, desc: (g) => `SCORE ${g.toLocaleString('en-US')} IN ONE RUN`, val: (p) => (p && p.score) || 0 },
  { tpl: 'dist_run', ev: 'run:end', mode: 'max', reset: 'run', goals: [800, 1500, 3000], reward: 120, desc: (g) => `TRAVEL ${g.toLocaleString('en-US')} M IN ONE RUN`, val: (p) => (p && p.dist) || 0 },
  // box:open fires once per opened box (Economy.openBox, design D9). roll()
  // only offers it once stats.boxesOpened ≥ 1 — new players never get a mission
  // for content they haven't met.
  { tpl: 'boxes_tot', ev: 'box:open', mode: 'sum', reset: null, goals: [2, 4], reward: 100, desc: (g) => `OPEN ${g} MYSTERY BOXES` },
];

const BY_TPL = {};
for (const t of TEMPLATES) BY_TPL[t.tpl] = t;

// Live mission description (persisted rows store tpl + goal, not strings).
export const missionDesc = (m) => {
  const t = BY_TPL[m.tpl];
  return t ? t.desc(m.goal) : m.tpl.toUpperCase();
};

class Missions {
  constructor() {
    this.recent = []; // session log for the missions screen header
    this._seq = 0;
    this._skinned = false;
  }

  // [W1-UI] main.js hookup: Missions.init({ save, bus, economy })
  init(deps) {
    if (this._skinned) return;
    this._skinned = true;
    this.economy = deps.economy;
    this.ensureSlots();

    // one listener per distinct template event — hot events reuse payloads,
    // handlers read synchronously and never allocate (see EventBus note).
    const events = new Set();
    for (const t of TEMPLATES) events.add(t.ev);
    for (const ev of events) bus.on(ev, (p) => this.onEvent(ev, p));
    bus.on('run:start', () => this.onRunStart());
  }

  ensureSlots() {
    const ms = save.data.missions;
    let added = false;
    while (ms.length < 3) { ms.push(this.roll(ms)); added = true; }
    if (added) save.save();
  }

  roll(exclude) {
    const used = {};
    for (const m of exclude) used[m.tpl] = 1;
    // box template is gated on lifetime boxes; ≥11 candidates always remain
    const pool = (save.data.stats.boxesOpened || 0) >= 1
      ? TEMPLATES
      : TEMPLATES.filter((t) => t.tpl !== 'boxes_tot');
    let t = pool[Math.floor(Math.random() * pool.length)];
    for (let i = 0; i < 20 && used[t.tpl]; i++) t = pool[Math.floor(Math.random() * pool.length)];
    const gi = Math.floor(Math.random() * t.goals.length);
    const goal = t.goals[gi];
    this._seq++;
    return { id: 'm' + Date.now().toString(36) + this._seq.toString(36), tpl: t.tpl, goal, prog: 0, reward: t.reward + gi * 15 };
  }

  onRunStart() {
    const ms = save.data.missions;
    for (let i = 0; i < ms.length; i++) {
      const t = BY_TPL[ms[i].tpl];
      if (t && t.reset === 'run') ms[i].prog = 0;
    }
  }

  onEvent(ev, p) {
    const ms = save.data.missions;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      const t = BY_TPL[m.tpl];
      if (!t || t.ev !== ev) continue;
      const delta = t.val ? t.val(p) : 1;
      if (t.mode === 'max') { if (delta > m.prog) m.prog = delta; }
      else m.prog += delta;
      if (m.prog >= m.goal) this.complete(i);
    }
  }

  complete(i) {
    const ms = save.data.missions;
    const m = ms[i];
    m.prog = m.goal;
    if (this.economy) this.economy.addCoins(m.reward);
    bus.emit('mission:complete', { id: m.id, tpl: m.tpl, reward: m.reward });
    bus.emit('ui:toast', { msg: `MISSION COMPLETE — ${missionDesc(m)} · +${m.reward}`, kind: 'reward' });
    this.recent.unshift({ desc: missionDesc(m), reward: m.reward });
    if (this.recent.length > 3) this.recent.length = 3;
    ms[i] = this.roll(ms); // auto-refill the slot
    save.save();
  }
}

export const missions = new Missions();
