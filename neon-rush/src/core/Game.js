// State machine BOOT→MENU→RUN⇄PAUSE→DEAD→RUN. Restart resets pooled state —
// the scene is never rebuilt. Owns run lifecycle, phase scheduling (RUN first,
// weighted shuffled pool, fever every 3rd phase, 1.5 s transition hook),
// pause, warp(). All gameplay mutates only inside 60 Hz fixed steps.
import { Time } from './Time.js';
import { bus } from './EventBus.js';
import { weightedShuffle } from './RNG.js';
import { Pool } from './Pool.js';
import { Track } from '../world/Track.js';
import { Obstacles } from '../world/Obstacles.js';
import { Player } from '../player/Player.js';
import { CameraRig } from '../player/Camera.js';
import { Scoring } from '../game/Scoring.js';
import { Director } from '../game/Director.js';
import { Feel } from '../game/Feel.js'; // [W1-FEEL] death-cam sampling + box pickups
import { PhaseRegistry } from '../phases/Phase.js';
import { RunPhase } from '../phases/RunPhase.js';
// [W1-PHASES] gameplay phase pool
import { FlightPhase } from '../phases/FlightPhase.js';
import { DriftPhase } from '../phases/DriftPhase.js';
import { HopperPhase } from '../phases/HopperPhase.js';
import { StackPhase } from '../phases/StackPhase.js';
import { OrbPhase } from '../phases/OrbPhase.js';
import { save } from './Save.js';
import { quality } from './Quality.js';
import { sound } from './Sound.js';
import { economy, REVIVE_COST } from '../game/Economy.js';

export const STATE = { BOOT: 'BOOT', MENU: 'MENU', RUN: 'RUN', PAUSE: 'PAUSE', REVIVE: 'REVIVE', DEAD: 'DEAD' };
const TRANSITION_S = 1.5; // cinematic window (FX hooks come with W1-FX)
const RESTART_GUARD = 250; // ms — ignore instant re-trigger from the crash key
export const REVIVE_WINDOW_S = 3.5; // real-time offer window (design D1) — UI drives the bar from it

export class Game {
  constructor({ scene, camera, renderer, input }) {
    this.renderer = renderer;
    this.input = input;
    this.time = new Time();
    this.state = STATE.BOOT;
    this.seed = 0;
    this.seedForced = null; // Photo API ?seed=
    this.warping = false;
    this.deathAt = 0;
    this._lastRestart = 0;
    this.revived = false; // once-per-run revive latch (design D1)
    this.reviveT = 0;     // real-time countdown while state === REVIVE

    this.track = new Track(scene);
    this.player = new Player(scene);
    this.camRig = new CameraRig(camera);
    this.director = new Director();
    this.scoring = new Scoring();
    this.scoring.init(this.director);

    this.ctx = {
      track: this.track,
      player: this.player,
      camera: this.camRig,
      input,
      scoring: this.scoring,
      director: this.director,
      game: this,
      time: this.time,
      speed: 13,
      menuMode: true,
      phase: null,
      fx: null, // registration surface for W1-FX (assigned by main.js)
      rng: null,
    };

    this.track.config = {
      speed: () => this.ctx.speed,
      difficulty: () => this.director.difficulty(),
      fever: () => this.director.fever,
      phaseRemain: () => this.phaseRemain(),
    };

    PhaseRegistry.register(RunPhase);
    // [W1-PHASES] weighted phase pool (RUN stays first + heaviest)
    PhaseRegistry.register(FlightPhase);
    PhaseRegistry.register(DriftPhase);
    PhaseRegistry.register(HopperPhase);
    PhaseRegistry.register(StackPhase);
    PhaseRegistry.register(OrbPhase);
    this.phase = PhaseRegistry.get('run');
    this.ctx.phase = this.phase;
    this.phaseT = 0;
    this.phaseDur = 40;
    this.phaseIndex = 0;
    this.phaseOrder = [];
    this.translating = false;
    this.transT = 0;
    this.pendingPhaseId = null;
    this.fever = false;

    bus.on('death', (p) => this.onDeath(p));
    input.onAction = (a) => this.onAction(a);
    input.onAnyKey = () => this.onAnyKey();
  }

  // ---- state machine ---------------------------------------------------------

  toMenu() {
    if (this.state === STATE.REVIVE) bus.emit('revive:resolved'); // defensive: never leak the overlay across states
    this.state = STATE.MENU;
    this.ctx.menuMode = true;
    this.player.reset();
    this.player.autopilot = true;
    this.player.ghost = true;
    this.track.reset((Math.random() * 0x7fffffff) | 0);
    bus.emit('ui:screen', 'menu');
    sound('ui');
  }

  startRun(seed) {
    if (seed == null) seed = (Math.random() * 0x7fffffff) | 0;
    if (this.state === STATE.REVIVE) bus.emit('revive:resolved'); // defensive: the overlay must never survive into a new run
    this.seed = seed;
    this.state = STATE.RUN;
    this.ctx.menuMode = false;
    this.revived = false;
    this.reviveT = 0;
    this.time.reset();
    this.player.reset();
    this.player.autopilot = false;
    this.player.ghost = false;
    this.scoring.reset();
    this.director.reset();
    this.track.reset(seed);
    this.input.clear();

    // Arm the run loadout from implants + charges (design D3): after
    // track.reset, before phase.enter, so the head-start teleport re-lays the
    // chunks before patterns spawn relative to the new scroll. x2/headstart
    // charges decrement at arm; shield charges only on absorb (Player.kill).
    const d = save.data;
    this.player.shieldUses = economy.shieldUses();
    this.scoring.comboGuard = economy.has('perk:comboguard');
    let headstart = economy.has('perk:headstart');
    if (!headstart && (d.charges.headstart || 0) > 0) {
      d.charges.headstart--;
      headstart = true;
    }
    let x2 = false;
    if ((d.charges.x2 || 0) > 0) {
      d.charges.x2--;
      d.x2Next = true;
      x2 = true;
    }
    if (headstart) this.track.teleport(300);
    if (headstart || x2 || this.player.shieldUses > 0) save.save();
    // Armed-effects announce (run-feedback: silent when nothing is armed)
    if (headstart) bus.emit('ui:toast', { msg: 'HEAD START — +300 M', kind: 'reward' });
    if (this.player.shieldUses > 0) bus.emit('ui:toast', { msg: 'AEGIS SHIELD ARMED', kind: 'info' });
    if (x2) bus.emit('ui:toast', { msg: '×2 COINS ACTIVE', kind: 'reward' });

    // RUN is always the first phase of a run
    this.phaseIndex = 0;
    this.phaseOrder.length = 0;
    this.fever = false;
    this.director.fever = false;
    this.translating = false;
    this.phase = PhaseRegistry.get('run');
    this.ctx.phase = this.phase;
    this.phaseT = 0;
    this.phaseDur = this.rollDuration(this.phase);
    this.phase.enter(this.ctx);

    bus.emit('run:start', { seed });
    bus.emit('phase:start', { id: 'run' });
    sound('start');
  }

  rollDuration(phase) {
    const d = phase.duration * (0.85 + 0.3 * this.track.rng());
    return Math.min(60, Math.max(30, d));
  }

  pause() {
    if (this.state !== STATE.RUN) return;
    this.state = STATE.PAUSE;
    this.input.clear();
    bus.emit('ui:screen', 'pause');
    sound('ui');
  }

  resume() {
    if (this.state !== STATE.PAUSE) return;
    this.state = STATE.RUN;
    this.input.clear();
    bus.emit('ui:screen', 'hud');
    sound('ui');
  }

  onDeath() {
    if (this.state !== STATE.RUN) return;
    // Revive intercept (design D1): the offer opens BEFORE endRun banks
    // anything — banking must stay atomic behind the offer's resolution.
    if (!this.revived && save.data.coins >= REVIVE_COST) {
      this.state = STATE.REVIVE;
      this.reviveT = REVIVE_WINDOW_S;
      bus.emit('revive:offer', { score: this.scoring.score });
      return;
    }
    this.finishDeath();
  }

  finishDeath() {
    this.state = STATE.DEAD;
    this.deathAt = performance.now();
    this.endRun();
    bus.emit('ui:screen', 'death');
  }

  acceptRevive() { this.resolveOffer(true); }
  declineRevive() { this.resolveOffer(false); }

  // Single resolve path for accept/decline/timeout — guard makes stray input
  // or double-fires (Enter maps to both confirm and up) harmless no-ops.
  resolveOffer(accepted) {
    if (this.state !== STATE.REVIVE) return;
    bus.emit('revive:resolved');
    if (accepted) {
      this.revived = true;
      save.data.coins -= REVIVE_COST;
      save.save();
      this.player.revive();
      // survivable pocket: clear the corridor ahead of the revived player
      Obstacles.releaseAhead(this.track.scroll, -10);
      this.input.clear();
      this.state = STATE.RUN;
      bus.emit('ui:screen', 'hud');
      sound('ui');
    } else {
      this.finishDeath(); // timeout/decline: no coins deducted, normal banking
    }
  }

  endRun(cause) {
    const s = this.scoring;
    const isBest = s.score > save.data.best;
    const best = Math.max(save.data.best, s.score);
    save.data.best = best;
    save.data.coins += s.runCoins;
    save.data.stats.runs++;
    save.data.stats.totalM += Math.floor(s.dist);
    save.data.stats.totalCoins += s.runCoins;
    if (!save.data.tipsSeen) save.data.tipsSeen = true; // first-run hints end with run 1
    save.save();
    const pct = best > 0 ? Math.min(1, s.score / best) : 0;
    bus.emit('run:end', {
      score: s.score, best, dist: Math.floor(s.dist), coins: s.runCoins,
      isBest, pct, cause: cause || 'crash',
    });
  }

  tryRestart() {
    const now = performance.now();
    if (now - this._lastRestart < RESTART_GUARD) return;
    this._lastRestart = now;
    this.startRun();
  }

  onAction(action) {
    if (this.state === STATE.REVIVE) {
      if (action === 'pause') this.declineRevive();
      else if (action === 'confirm' || action === 'up') this.acceptRevive();
      return; // no menu/restart handling while the offer is open
    }
    if (action === 'pause') {
      if (this.state === STATE.RUN) this.pause();
      else if (this.state === STATE.PAUSE) this.resume();
      return;
    }
    if (action === 'confirm' || action === 'up') {
      if (this.state === STATE.MENU) this.startRun();
      else if (this.state === STATE.DEAD) this.tryRestart();
      else if (this.state === STATE.PAUSE && action === 'confirm') this.resume();
    }
  }

  onAnyKey() {
    // Death screen: ANY key restarts in <1 s (design pillar #3).
    if (this.state === STATE.DEAD) this.tryRestart();
  }

  // ---- phase scheduling ------------------------------------------------------

  phaseRemain() {
    return this.translating ? 0 : Math.max(0, this.phaseDur - this.phaseT);
  }

  nextPhaseId() {
    if (!this.phaseOrder.length) {
      const entries = [];
      for (const [id] of PhaseRegistry.list()) {
        if (id === this.phase.id) continue;
        const ph = PhaseRegistry.get(id);
        entries.push([id, ph && ph.weight != null ? ph.weight : 1]);
      }
      if (!entries.length) entries.push([this.phase.id, 1]); // W0: only RUN registered
      this.phaseOrder = weightedShuffle(this.track.rng, entries);
    }
    return this.phaseOrder.shift();
  }

  beginTransition() {
    const toId = this.nextPhaseId();
    this.pendingPhaseId = toId;
    this.translating = true;
    this.transT = TRANSITION_S;
    bus.emit('phase:transition', { from: this.phase.id, to: toId });
    // [FX R3] no ui:toast here: Phase.js Cinematic already renders the in-world
    // 3D title card on 'phase:transition' — the DOM pill duplicated it.
    this.camRig.phaseDolly();
    sound('phase');
  }

  enterPending() {
    const ph = PhaseRegistry.get(this.pendingPhaseId);
    if (!ph) { this.translating = false; return; }
    this.phase.exit(this.ctx);
    this.phase = ph;
    this.ctx.phase = ph;
    this.phaseT = 0;
    this.phaseDur = this.rollDuration(ph);
    this.translating = false;
    this.phaseIndex++;
    this.fever = this.phaseIndex % 3 === 2; // every 3rd phase is fever
    this.director.fever = this.fever;
    ph.enter(this.ctx);
    if (this.fever) bus.emit('ui:toast', { msg: 'FEVER ZONE — 2× COINS', kind: 'fever' });
    bus.emit('phase:start', { id: ph.id });
  }

  // ---- fixed-step pipeline -----------------------------------------------------

  fixedStep(dt) {
    if (this.translating) {
      this.transT -= dt;
      if (this.transT <= 0) this.enterPending();
    } else {
      this.phaseT += dt;
      if (this.phaseT >= this.phaseDur) this.beginTransition();
    }

    this.director.update(dt);
    this.ctx.speed = this.director.speed;
    this.ctx.rng = this.track.rng;

    this.track.update(dt, this.ctx.speed, this.player);
    this.player.update(dt, this.ctx);
    this.scoring.update(dt, this.track.scroll, this.ctx.speed, this.fever);
    this.phase.update(dt, this.ctx);
    this.camRig.update(dt, this.ctx);
    Feel.fixedStep(dt, this.ctx); // [W1-FEEL] 30 Hz ring sample + mystery-box sweep
  }

  // ---- per-RAF update ------------------------------------------------------------

  update(dtReal) {
    quality.update(dtReal);
    switch (this.state) {
      case STATE.RUN:
        this.time.advance(dtReal, (dt) => this.fixedStep(dt));
        this.camRig.apply();
        break;
      case STATE.MENU:
        this.ctx.speed = 13;
        this.time.advance(dtReal, (dt) => {
          this.track.update(dt, this.ctx.speed, null);
          this.player.update(dt, this.ctx);
          this.camRig.update(dt, this.ctx);
        });
        this.camRig.apply();
        break;
      case STATE.PAUSE:
      case STATE.REVIVE:
      case STATE.DEAD:
      case STATE.BOOT:
        // frozen world; renderer still draws. REVIVE counts down in REAL time
        // (design D1) — the offer must expire even with the 60 Hz sim frozen.
        if (this.state === STATE.REVIVE) {
          this.reviveT -= dtReal;
          if (this.reviveT <= 0) this.resolveOffer(false);
        }
        this.camRig.apply();
        break;
    }
  }

  // ---- debug / Photo API ---------------------------------------------------------

  warp(seconds) {
    if (this.state === STATE.MENU || this.state === STATE.BOOT || this.state === STATE.DEAD) {
      this.startRun(this.seedForced != null ? this.seedForced : undefined);
    }
    const wasAuto = this.player.autopilot;
    const wasGhost = this.player.ghost;
    this.player.autopilot = true;
    this.player.ghost = true;
    this.warping = true;
    this.time.warp(seconds, (dt) => this.fixedStep(dt));
    this.warping = false;
    this.player.autopilot = wasAuto;
    this.player.ghost = wasGhost;
    this.camRig.snap(this.ctx);
  }

  forceState(name) {
    switch (name) {
      case 'MENU':
        this.toMenu();
        break;
      case 'RUN':
        if (this.state !== STATE.RUN) this.startRun(this.seedForced != null ? this.seedForced : undefined);
        break;
      case 'PAUSE':
        if (this.state === STATE.RUN) this.pause();
        break;
      case 'DEAD':
        if (this.state === STATE.RUN) this.player.kill('forced');
        else if (this.state !== STATE.DEAD) {
          this.startRun(this.seedForced != null ? this.seedForced : undefined);
          this.player.kill('forced');
        }
        break;
      default:
        break;
    }
  }

  forcePhase(id) {
    if (this.state !== STATE.RUN) this.startRun(this.seedForced != null ? this.seedForced : undefined);
    const ph = PhaseRegistry.get(id);
    if (!ph) return false;
    this.phase.exit(this.ctx);
    this.phase = ph;
    this.ctx.phase = ph;
    this.phaseT = 0;
    this.phaseDur = this.rollDuration(ph);
    this.translating = false;
    this.phaseIndex++;
    this.fever = this.phaseIndex % 3 === 2;
    this.director.fever = this.fever;
    // clean runway: clear everything ahead so the phase starts fresh
    Obstacles.releaseAhead(this.track.scroll, -6);
    ph.enter(this.ctx);
    bus.emit('phase:transition', { from: this.phase.id, to: id });
    bus.emit('phase:start', { id });
    // [FX R3] title toast removed — the 3D Cinematic card is the single title
    // moment (duplicate bottom pill, R2 critic item 3).
    this.camRig.phaseDolly();
    return true;
  }

  teleport(meters) {
    if (this.state !== STATE.RUN) this.startRun(this.seedForced != null ? this.seedForced : undefined);
    this.track.teleport(meters);
  }

  stats() {
    const info = this.renderer.info;
    return {
      fps: Math.round(quality.fps),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      programs: info.programs ? info.programs.length : 0,
      pools: Pool.totalObjects(),
    };
  }
}
