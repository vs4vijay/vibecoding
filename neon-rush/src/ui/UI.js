// DOM screen manager (W1-UI AAA pass): show('menu'|'hud'|'death'|'pause'|
// 'shop'|'missions'|'settings'). Bus-driven; heavy screens live in per-screen
// builders (ShopScreen/MissionsScreen/SettingsScreen). Meta screens push onto
// a back-stack; any game-forced screen (menu/hud/pause/death) clears it.
import { bus } from '../core/EventBus.js';
import { save } from '../core/Save.js';
import { el, fmt } from './dom.js';
import { economy, xpForLevel, REVIVE_COST } from '../game/Economy.js';
import { REVIVE_WINDOW_S } from '../core/Game.js';
import { daily } from '../game/Daily.js';
import { buildShop, refreshShop as refreshShopPanel } from './ShopScreen.js';
import { buildMissions, refreshMissions as refreshMissionsPanel } from './MissionsScreen.js';
import { buildSettings, refreshSettings as refreshSettingsPanel } from './SettingsScreen.js';

const SCREEN_IDS = {
  menu: 's-menu', hud: 's-hud', death: 's-death', pause: 's-pause',
  shop: 's-shop', missions: 's-missions', settings: 's-settings',
};
const GAME_SCREENS = { menu: 1, hud: 1, death: 1, pause: 1 };

const TOAST_ICONS = {
  info: '›', success: '✔', reward: '◆', phase: '»', fever: '✦', system: '·', style: '≈',
};

export class UI {
  constructor(game, save) {
    this.game = game;
    this.save = save;
    this.root = document.getElementById('ui');
    this.lastEnd = null;
    this._hudAcc = 1;
    this._metaBack = null;

    // Input-scheme detection (design D6): coarse pointer guesses touch; the
    // first real touchstart latches touch mode permanently for the session so
    // coarse-pointer desktops with touchscreens self-correct on first contact.
    this.touch = false;
    try { this.touch = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* very old browser: keep keyboard copy */ }
    window.addEventListener('touchstart', () => {
      if (this.touch) return;
      this.touch = true;
      this.applyHints(); // a screen may already be showing when the latch lands
    }, { once: true, passive: true });

    this.root.appendChild(this.buildMenu());
    this.root.appendChild(this.buildHud());
    this.root.appendChild(this.buildDeath());
    this.root.appendChild(this.buildPause());
    this.root.appendChild(buildShop(this));
    this.root.appendChild(buildMissions(this));
    this.root.appendChild(buildSettings(this));
    this.toastsEl = el('div', 'toasts', '');
    this.toastsEl.id = 'toasts';
    this.root.appendChild(this.toastsEl);
    this.root.appendChild(this.buildRevive());
    this._reviveShown = false;
    this._reviveQ = -1;

    bus.on('run:start', () => this.show('hud'));
    bus.on('ui:screen', (name) => this.show(name));
    bus.on('run:end', (p) => { this.lastEnd = p; });
    bus.on('revive:offer', () => this.showRevive());
    bus.on('revive:resolved', () => this.hideRevive());
    bus.on('run:start', () => this.hideRevive()); // defensive: offer never survives a new run
    bus.on('combo:change', ({ tier }) => {
      this.comboEl.textContent = `×${tier}`;
      this.comboEl.dataset.tier = tier;
      this.comboEl.classList.remove('pulse');
      void this.comboEl.offsetWidth; // restart animation
      this.comboEl.classList.add('pulse');
    });
    bus.on('ui:toast', ({ msg, kind }) => this.toast(msg, kind));

    window.addEventListener('keydown', (e) => this.onKey(e), true);

    this.show('menu');
  }

  // ---- screen plumbing ---------------------------------------------------------

  show(name) {
    if (!SCREEN_IDS[name]) return;
    for (const key of Object.values(SCREEN_IDS)) {
      const node = document.getElementById(key);
      if (node) node.classList.toggle('active', SCREEN_IDS[name] === key);
    }
    if (GAME_SCREENS[name]) this._metaBack = null; // game owns navigation now
    if (name === 'menu') this.refreshMenu();
    if (name === 'death') this.refreshDeath();
    if (name === 'pause') this.applyHints(); // pause has no other refresh path
    if (name === 'shop') this.refreshShop();
    if (name === 'missions') this.refreshMissions();
    if (name === 'settings') this.refreshSettings();
    this.screen = name;
  }

  openMeta(name) {
    if (!SCREEN_IDS[name] || GAME_SCREENS[name]) return;
    this._metaBack = GAME_SCREENS[this.screen] ? this.screen : 'menu';
    this.show(name);
  }

  back() {
    const to = this._metaBack && GAME_SCREENS[this._metaBack] ? this._metaBack : 'menu';
    this.show(to);
  }

  // refresh delegates (screen builders call these via the ui handle)
  refreshShop() { refreshShopPanel(this); }
  refreshMissions() { refreshMissionsPanel(this); }
  refreshSettings() { refreshSettingsPanel(this); }

  // ---- scheme-aware hints (design D6) -------------------------------------------
  // Hint copy is set in the refresh paths, not only at build time: the touch
  // latch can fire mid-session (first touch on a coarse-pointer desktop) and
  // must re-word whatever is already on screen.
  hintText(keysText, touchText) { return this.touch ? touchText : keysText; }

  applyHints() {
    this._setHint(this.menuHint, this.hintText(
      '← → MOVE&nbsp;&nbsp;·&nbsp;&nbsp;↑ / SPACE JUMP&nbsp;&nbsp;·&nbsp;&nbsp;↓ SLIDE&nbsp;&nbsp;·&nbsp;&nbsp;P PAUSE',
      'SWIPE ← → MOVE&nbsp;&nbsp;·&nbsp;&nbsp;SWIPE ↑ JUMP&nbsp;&nbsp;·&nbsp;&nbsp;SWIPE ↓ SLIDE&nbsp;&nbsp;·&nbsp;&nbsp;TAP ⏸ PAUSE'));
    this._setHint(this.deathHint, this.hintText('ANY KEY — INSTANT RESTART', 'TAP — INSTANT RESTART'));
    this._setHint(this.pauseHint, this.hintText('ESC / P — BACK TO THE RUN', 'TAP RESUME — BACK TO THE RUN'));
    this._setHint(this.reviveHint, this.hintText('ENTER — REVIVE&nbsp;&nbsp;·&nbsp;&nbsp;P — LET IT END', 'TAP ACCEPT — REVIVE&nbsp;&nbsp;·&nbsp;&nbsp;LET IT END TO DECLINE'));
  }

  _setHint(node, text) { if (node && node.innerHTML !== text) node.innerHTML = text; }

  onKey(e) {
    if (e.repeat) return;
    const meta = this.screen === 'shop' || this.screen === 'missions' || this.screen === 'settings';
    if (!meta) return;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      // consume the key so Input's pause-toggle doesn't also fire (it would
      // resume/repause the game and clobber the back navigation)
      e.stopImmediatePropagation();
      this.back();
    }
  }

  // ---- menu ---------------------------------------------------------------------

  buildMenu() {
    const s = el('div', 'screen', '');
    s.id = 's-menu';
    const inner = el('div', 'menu-inner');
    inner.appendChild(el('div', 'title-kicker', 'HYPERDROME'));
    const title = el('h1', 'title', 'NEON<span> RUSH</span>');
    inner.appendChild(title);

    const xp = el('div', 'xp-row');
    xp.innerHTML =
      `<div class="lv-badge" id="menu-lv">LV 1</div>` +
      `<div class="xp-bar"><i class="xp-fill" id="xp-fill"></i></div>` +
      `<div class="xp-num" id="menu-xp">0 / 150 XP</div>`;
    inner.appendChild(xp);

    const playWrap = el('div', 'play-wrap');
    const play = el('button', 'btn btn-play', 'PLAY');
    play.id = 'btn-play';
    play.addEventListener('click', () => this.game.startRun());
    playWrap.appendChild(play);
    inner.appendChild(playWrap);

    const row = el('div', 'menu-row');
    const dailyBtn = el('button', 'btn btn-sec', 'DAILY RUN<b class="btn-sub" id="daily-sub">NEW STREAK</b>');
    dailyBtn.id = 'btn-daily';
    dailyBtn.addEventListener('click', () => this.game.startRun(daily.seedForToday()));
    const shopBtn = el('button', 'btn btn-sec', 'SHOP');
    shopBtn.id = 'btn-shop';
    shopBtn.addEventListener('click', () => this.openMeta('shop'));
    const missionBtn = el('button', 'btn btn-sec', 'MISSIONS');
    missionBtn.id = 'btn-missions';
    missionBtn.addEventListener('click', () => this.openMeta('missions'));
    row.appendChild(dailyBtn);
    row.appendChild(shopBtn);
    row.appendChild(missionBtn);
    inner.appendChild(row);

    const stats = el('div', 'menu-stats', '');
    stats.id = 'menu-stats';
    inner.appendChild(stats);
    this.menuHint = el('div', 'hint', '← → MOVE&nbsp;&nbsp;·&nbsp;&nbsp;↑ / SPACE JUMP&nbsp;&nbsp;·&nbsp;&nbsp;↓ SLIDE&nbsp;&nbsp;·&nbsp;&nbsp;P PAUSE');
    inner.appendChild(this.menuHint);
    s.appendChild(inner);

    const gear = el('button', 'btn btn-gear', '⚙ SETTINGS');
    gear.id = 'btn-settings';
    gear.addEventListener('click', () => this.openMeta('settings'));
    s.appendChild(gear);

    this.menuStats = stats;
    return s;
  }

  refreshMenu() {
    const d = this.save.data;
    const need = xpForLevel(d.level);
    const frac = Math.max(0, Math.min(1, d.xp / need));
    const lv = document.getElementById('menu-lv');
    const fill = document.getElementById('xp-fill');
    const num = document.getElementById('menu-xp');
    if (lv) lv.textContent = 'LV ' + d.level;
    if (fill) fill.style.transform = `scaleX(${frac.toFixed(3)})`;
    if (num) num.textContent = `${fmt(d.xp)} / ${fmt(need)} XP`;
    const sub = document.getElementById('daily-sub');
    if (sub) {
      sub.textContent = daily.isDone()
        ? `✓ TODAY · STREAK ${daily.streak()}`
        : (daily.streak() > 0 ? `STREAK ${daily.streak()}` : 'NEW TRACK DAILY');
      sub.dataset.done = daily.isDone() ? '1' : '';
    }
    this.menuStats.innerHTML =
      `<span class="stat"><em>BEST</em><b>${fmt(d.best)}</b></span>` +
      `<span class="stat"><em>COINS</em><b><span class="coin-dot"></span>${fmt(d.coins)}</b></span>` +
      `<span class="stat"><em>RUNS</em><b>${fmt(d.stats.runs)}</b></span>`;
    this.applyHints();
  }

  // ---- hud ------------------------------------------------------------------------

  buildHud() {
    const s = el('div', 'screen', '');
    s.id = 's-hud';
    const left = el('div', 'hud-left');
    left.appendChild(el('div', 'hud-label', 'SCORE'));
    this.scoreEl = el('div', 'hud-score', '0');
    left.appendChild(this.scoreEl);
    const combo = el('div', 'hud-combo', '×1');
    combo.dataset.tier = '1';
    this.comboEl = combo;
    left.appendChild(combo);
    s.appendChild(left);

    const right = el('div', 'hud-right');
    this.coinsEl = el('div', 'hud-coins', '<span class="coin-dot"></span>0');
    right.appendChild(this.coinsEl);
    this.speedEl = el('div', 'hud-speed', '12 M/S');
    right.appendChild(this.speedEl);
    this.tiersEl = el('div', 'hud-tiers', '<i></i><i></i><i></i><i></i><i></i>');
    right.appendChild(this.tiersEl);
    s.appendChild(right);

    // Phase progress bar (run-feedback spec, design D7): top-center, fed from
    // Game.phaseRemain()/phaseDur in the 10 Hz throttle below. Empty through
    // transitions (phaseRemain() is 0 while translating).
    const phase = el('div', 'hud-phase');
    phase.appendChild(el('div', 'hud-phase-label', 'ZONE'));
    const phaseBar = el('div', 'hud-phase-bar');
    this.phaseFill = el('i', 'hud-phase-fill');
    phaseBar.appendChild(this.phaseFill);
    phase.appendChild(phaseBar);
    s.appendChild(phase);

    // On-screen pause (player-input spec): single-touch reachable, ≥44×44 px,
    // lives inside #s-hud so it only exists while the hud is active. pointerdown
    // for zero-latency tap; stopPropagation keeps it out of every other handler.
    const pauseBtn = el('button', 'hud-pause', '');
    pauseBtn.id = 'btn-hud-pause';
    pauseBtn.setAttribute('aria-label', 'PAUSE');
    pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.game.pause();
    });
    s.appendChild(pauseBtn);
    return s;
  }

  // ---- death ------------------------------------------------------------------------

  buildDeath() {
    const s = el('div', 'screen', '');
    s.id = 's-death';
    const inner = el('div', 'death-inner');
    inner.appendChild(el('div', 'death-title', 'WRECKED'));
    this.deathSo = el('div', 'death-so', '');
    inner.appendChild(this.deathSo);

    const ghost = el('div', 'ghost-wrap');
    ghost.innerHTML =
      `<div class="ghost-labels"><span>YOU <b id="ghost-you">0</b></span><span>BEST <b id="ghost-best">0</b></span></div>` +
      `<div class="ghost-bar"><i class="ghost-fill"></i><i class="ghost-mark"></i></div>`;
    inner.appendChild(ghost);

    const row = el('div', 'death-stats', '');
    row.id = 'death-stats';
    inner.appendChild(row);
    const retry = el('button', 'btn btn-retry', 'RETRY');
    retry.id = 'btn-retry';
    retry.addEventListener('click', (e) => { e.stopPropagation(); this.game.tryRestart(); });
    inner.appendChild(retry);
    this.deathHint = el('div', 'hint', 'ANY KEY — INSTANT RESTART');
    inner.appendChild(this.deathHint);
    s.appendChild(inner);
    // design pillar: tap anywhere on the death screen restarts
    s.addEventListener('click', () => this.game.tryRestart());
    this.deathStats = row;
    this.deathInner = inner;
    return s;
  }

  refreshDeath() {
    const p = this.lastEnd;
    const d = this.save.data;
    this.applyHints();
    const fill = this.deathInner.querySelector('.ghost-fill');
    const you = this.deathInner.querySelector('#ghost-you');
    const best = this.deathInner.querySelector('#ghost-best');
    if (!p) {
      this.deathStats.innerHTML = '';
      this.deathSo.textContent = '';
      if (fill) fill.style.transform = 'scaleX(0)';
      return;
    }
    this.deathStats.innerHTML =
      `<span class="stat"><em>SCORE</em><b>${fmt(p.score)}</b></span>` +
      `<span class="stat"><em>BEST</em><b>${fmt(p.best)}</b></span>` +
      `<span class="stat"><em>DIST</em><b>${fmt(p.dist)} M</b></span>` +
      `<span class="stat"><em>COINS</em><b><span class="coin-dot"></span>${fmt(p.coins)}</b></span>`;
    // bug fix: score === best (pct 1) with isBest false used to print
    // "SO CLOSE — 100.0% OF YOUR RECORD!" — it's a tie, not a near-miss.
    this.deathSo.textContent =
      p.isBest ? 'NEW RECORD!' :
      (p.pct >= 0.999 ? 'RECORD TIED — ONE MORE RUN' :
       p.pct >= 0.9 ? `SO CLOSE — ${(p.pct * 100).toFixed(1)}% OF YOUR RECORD!` :
       'THE GRID ALWAYS TAKES ANOTHER RUN');
    if (you) you.textContent = fmt(p.score);
    if (best) best.textContent = fmt(Math.max(p.best, p.score));
    if (fill) {
      const frac = p.best > 0 || p.score > 0
        ? Math.max(0, Math.min(1, p.score / Math.max(1, Math.max(p.best, p.score))))
        : 0;
      fill.style.transform = `scaleX(${frac.toFixed(3)})`;
      fill.dataset.record = p.isBest ? '1' : '';
    }
    void this.deathInner.offsetWidth; // replay entrance animation
    this.deathInner.classList.remove('enter');
    this.deathInner.classList.add('enter');
  }

  // ---- pause ------------------------------------------------------------------------

  buildPause() {
    const s = el('div', 'screen', '');
    s.id = 's-pause';
    const inner = el('div', 'pause-inner');
    inner.appendChild(el('div', 'pause-title', 'PAUSED'));
    const col = el('div', 'pause-col');
    const resume = el('button', 'btn btn-primary', 'RESUME');
    resume.id = 'btn-resume';
    resume.addEventListener('click', () => this.game.resume());
    const restart = el('button', 'btn', 'RESTART');
    restart.id = 'btn-restart';
    restart.addEventListener('click', () => this.game.tryRestart());
    const settings = el('button', 'btn', 'SETTINGS');
    settings.id = 'btn-pause-settings';
    settings.addEventListener('click', () => this.openMeta('settings'));
    const quit = el('button', 'btn btn-ghost', 'QUIT TO MENU');
    quit.id = 'btn-quit';
    quit.addEventListener('click', () => this.game.toMenu());
    col.appendChild(resume);
    col.appendChild(restart);
    col.appendChild(settings);
    col.appendChild(quit);
    inner.appendChild(col);
    this.pauseHint = el('div', 'hint', 'ESC / P — BACK TO THE RUN');
    inner.appendChild(this.pauseHint);
    s.appendChild(inner);
    return s;
  }

  // ---- revive offer -----------------------------------------------------------------
  // Sibling of the screens (like #toasts), NOT a screen: it must overlay the
  // frozen game view while the hud screen stays active underneath (REVIVE
  // state). Shown/hidden purely via bus events from Game's offer lifecycle.

  buildRevive() {
    const o = el('div', 'revive', '');
    o.id = 'revive';
    const inner = el('div', 'revive-inner');
    inner.appendChild(el('div', 'revive-kicker', 'SECOND CHANCE'));
    inner.appendChild(el('div', 'revive-title', 'REVIVE?'));
    const cost = el('div', 'revive-cost',
      `<span class="coin-dot"></span>${fmt(REVIVE_COST)}<em>COINS</em>`);
    cost.id = 'revive-cost';
    inner.appendChild(cost);
    const bar = el('div', 'revive-bar');
    this.reviveBarEl = el('i', 'revive-fill');
    bar.appendChild(this.reviveBarEl);
    inner.appendChild(bar);
    const row = el('div', 'revive-row');
    const accept = el('button', 'btn btn-revive', 'ACCEPT');
    accept.id = 'btn-revive-accept';
    accept.addEventListener('click', (e) => { e.stopPropagation(); this.game.acceptRevive(); });
    const decline = el('button', 'btn btn-ghost', 'LET IT END');
    decline.id = 'btn-revive-decline';
    decline.addEventListener('click', (e) => { e.stopPropagation(); this.game.declineRevive(); });
    row.appendChild(accept);
    row.appendChild(decline);
    inner.appendChild(row);
    this.reviveHint = el('div', 'hint', this.hintText('ENTER — REVIVE&nbsp;&nbsp;·&nbsp;&nbsp;P — LET IT END', 'TAP ACCEPT — REVIVE&nbsp;&nbsp;·&nbsp;&nbsp;LET IT END TO DECLINE'));
    inner.appendChild(this.reviveHint);
    o.appendChild(inner);
    this.reviveEl = o;
    return o;
  }

  showRevive() {
    if (this._reviveShown) return;
    this._reviveShown = true;
    this._reviveQ = -1;
    this.reviveEl.classList.add('show');
    this.reviveBarEl.style.transform = 'scaleX(1)';
    delete this.reviveBarEl.dataset.low;
  }

  hideRevive() {
    if (!this._reviveShown) return;
    this._reviveShown = false;
    this.reviveEl.classList.remove('show');
  }

  // ---- toasts (queue, kinds, icons; slide+fade transforms only) ----------------------
  // [W1-FX r2] narrow allowance (debts #3/#4, queue-side fixes diagnosed here):
  //  · dedupe — emitters like FlightPhase's fuel latch legitimately re-warn
  //    ("FUEL LOW" re-arms once fuel recovers), and the queue used to stack the
  //    identical message twice while the first copy was still alive. The queue
  //    is the one layer that sees all emitters, so it owns dedupe.
  //  · ordering — newest toast now goes on TOP (prepend; old code appended and
  //    let "DRIFT ×9" surface under a stale "×3").
  toast(msg, kind) {
    for (let i = 0; i < this.toastsEl.children.length; i++) {
      if (this.toastsEl.children[i].dataset.msg === msg) return; // already showing
    }
    const t = el('div', 'toast', '');
    t.dataset.kind = kind || 'info';
    t.dataset.msg = msg;
    t.innerHTML = `<span class="t-icon">${TOAST_ICONS[t.dataset.kind] || '›'}</span><span>${msg}</span>`;
    this.toastsEl.prepend(t);
    while (this.toastsEl.children.length > 3) this.toastsEl.removeChild(this.toastsEl.lastChild);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      t.classList.add('hide');
      setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 240);
    }, 2400);
  }

  // throttled HUD refresh (transform/opacity friendly, no layout thrash)
  update(dt) {
    // revive countdown: per-RAF but quantized to 1% so the transform string is
    // only written when it changes; runs regardless of the hud throttle below.
    if (this._reviveShown) {
      const f = Math.max(0, this.game.reviveT / REVIVE_WINDOW_S);
      const q = (f * 100) | 0;
      if (q !== this._reviveQ) {
        this._reviveQ = q;
        this.reviveBarEl.style.transform = `scaleX(${(q / 100).toFixed(2)})`;
        if (q < 25) this.reviveBarEl.dataset.low = '1';
        else delete this.reviveBarEl.dataset.low;
      }
    }
    if (this.screen !== 'hud') return;
    this._hudAcc += dt;
    if (this._hudAcc < 0.1) return;
    this._hudAcc = 0;
    const s = this.game.scoring;
    const v = this.game.director;
    this.scoreEl.textContent = fmt(s.score);
    this.coinsEl.innerHTML = `<span class="coin-dot"></span>${fmt(s.runCoins)}`;
    this.speedEl.textContent = `${Math.round(v.speed)} M/S`;
    const pips = this.tiersEl.children;
    for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < v.tier);
    if (s.fever) this.comboEl.dataset.fever = '1';
    else delete this.comboEl.dataset.fever;
    // phase clock → slim bar; data-low marks the final 20% (CSS pulse)
    const frac = this.game.phaseDur > 0
      ? Math.max(0, Math.min(1, this.game.phaseRemain() / this.game.phaseDur))
      : 0;
    this.phaseFill.style.transform = `scaleX(${frac.toFixed(3)})`;
    if (frac < 0.2) this.phaseFill.dataset.low = '1';
    else delete this.phaseFill.dataset.low;
  }
}
