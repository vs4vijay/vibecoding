// W1-UI daily run: one scored attempt per calendar day on a date-seeded track.
// seedForToday() is a pure hash of the local date string — same day, same track.
// A run counts as the daily attempt only if it was STARTED with today's seed
// (flag set on 'run:start', consumed on 'run:end'). Streak increments when the
// previously marked date was exactly yesterday, otherwise resets to 1.
import { bus } from '../core/EventBus.js';
import { save } from '../core/Save.js';

const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

// FNV-1a 32-bit — stable across sessions, well distributed.
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function dateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + (offsetDays || 0));
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// Escalating streak payout: 50 + 25 × (streak-1), capped at +275.
export const dailyReward = (streak) => 50 + Math.min(10, Math.max(0, streak - 1)) * 25;

class Daily {
  constructor() {
    this._attemptActive = false;
    this._skinned = false;
  }

  // [W1-UI] main.js hookup: Daily.init({ save, bus, economy })
  init(deps) {
    if (this._skinned) return;
    this._skinned = true;
    this.economy = deps.economy;
    bus.on('run:start', (p) => { this._attemptActive = !!(p && p.seed === this.seedForToday()); });
    bus.on('run:end', (p) => this.onRunEnd(p));
  }

  seedForToday() { return hashStr('NEONRUSH-DAILY-' + dateStr(0)); }
  today() { return dateStr(0); }
  yesterday() { return dateStr(-1); }

  isDone() { return save.data.daily.date === this.today(); }
  streak() { return save.data.daily.streak; }
  doneScore() { return this.isDone() ? save.data.daily.score : 0; }

  onRunEnd(p) {
    if (!this._attemptActive) return;
    this._attemptActive = false;
    const d = save.data.daily;
    if (d.date === this.today()) return; // one scored attempt per calendar day
    d.streak = d.date === this.yesterday() ? d.streak + 1 : 1;
    d.date = this.today();
    d.score = p ? p.score : 0;
    const reward = dailyReward(d.streak);
    if (this.economy) this.economy.addCoins(reward);
    bus.emit('ui:toast', { msg: `DAILY RUN LOGGED — STREAK ${d.streak} · +${reward} COINS`, kind: 'reward' });
    save.save();
  }
}

export const daily = new Daily();
