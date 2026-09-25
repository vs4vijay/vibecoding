// Default runner rules — always the first phase of a run.
// First-run tips (run-feedback spec, design D8): on the player's very first
// run (save.data.tipsSeen === false, strict — Save.load normalizes pre-tips
// saves to true) emit two one-shot scheme-aware hints when a jumpable /
// slideable hazard first closes inside TIP_RANGE m. Flag is set at run end
// (Game.endRun) so the hints can never repeat after run 1.
//
// Teaching beam: onboarding runs roll easy patterns ONLY (Director.difficulty
// returns 0 while stats.runs < 3) and no easy pattern places a beam — without
// one, the slide hint could never fire on a genuine first run. So this phase
// lays exactly ONE beam via the public Obstacles.spawn, in the player's lane,
// past the hint range, once the opening has played out. One-shot, first run
// only, skipped when a slideable hazard is already inbound.
import { Phase } from './Phase.js';
import { bus } from '../core/EventBus.js';
import { save } from '../core/Save.js';
import { Obstacles, COLLECTED_Z } from '../world/Obstacles.js';

const TIP_RANGE = 35;        // m — close enough to read the hazard, far enough to react
const CHUNK_SPAN = 60;       // m — Track chunk length
const TEACH_AFTER_M = 100;   // m — let the calm opening + easy barriers play first
const TEACH_BEAM_Z = -42;    // world z — spawns outside the hint range, then "arrives"
const TEACH_SCAN_M = 80;     // m — don't double up when a beam is already inbound
const TEACH_MIN_REMAIN = 12; // s — beam must land well inside the current phase

export class RunPhase extends Phase {
  id = 'run';
  title = 'NEON RUN';
  duration = 40;
  weight = 1.6;
  cameraHint = { fov: 60, height: 4.4, dist: 7.6 };

  constructor() {
    super();
    // scratch for nearestAhead — one allocation for the session, never per tick
    this._near = { x: 0, y: 0, z: 0, dist: 0, type: '', jumpable: false, slideable: false };
    this._tipJump = false;
    this._tipSlide = false;
    this._beamSpawned = false;
    // latches are PER-RUN: enter() re-runs on every phase re-entry, so the
    // resets hang off run:start (one-time-ness must survive a flight stint).
    bus.on('run:start', () => {
      this._tipJump = false;
      this._tipSlide = false;
      this._beamSpawned = false;
    });
  }

  enter(ctx) {}

  update(dt, ctx) {
    if (save.data.tipsSeen !== false) return;
    // per-kind nearest: a barrier chain must not shadow an incoming beam
    if (!this._tipJump &&
        Obstacles.nearestAhead(ctx.track.scroll, TIP_RANGE, this._near, 'jump')) {
      this._tipJump = true;
      // scheme copy is read at emit time via the debug API handle (main.js
      // sets window.__NR.ui before any run can start) — no UI import cycle.
      const touch = !!(typeof window !== 'undefined' && window.__NR && window.__NR.ui &&
        window.__NR.ui.touch);
      bus.emit('ui:toast', {
        msg: touch ? 'BARRIER AHEAD — SWIPE ↑ TO JUMP' : 'BARRIER AHEAD — PRESS ↑ TO JUMP',
        kind: 'info',
      });
    }
    if (!this._tipSlide &&
        Obstacles.nearestAhead(ctx.track.scroll, TIP_RANGE, this._near, 'slide')) {
      this._tipSlide = true;
      const touch = !!(typeof window !== 'undefined' && window.__NR && window.__NR.ui &&
        window.__NR.ui.touch);
      bus.emit('ui:toast', {
        msg: touch ? 'BEAM AHEAD — SWIPE ↓ TO SLIDE' : 'BEAM AHEAD — PRESS ↓ TO SLIDE',
        kind: 'info',
      });
    }

    if (!this._beamSpawned && !this._tipSlide && ctx.track.scroll > TEACH_AFTER_M &&
        !(ctx.game && ctx.game.phaseRemain() < TEACH_MIN_REMAIN) &&
        !this._slideableAhead(ctx.track.scroll, TEACH_SCAN_M)) {
      const chunk = this._chunkFor(ctx.track, TEACH_BEAM_Z);
      if (chunk) {
        this._beamSpawned = true;
        const local = TEACH_BEAM_Z - (chunk.baseZ + ctx.track.scroll);
        Obstacles.spawn('beam', chunk, ctx.player.laneI, local);
      }
    }
  }

  // any slideable hazard already ahead of the player plane within range
  _slideableAhead(scroll, range) {
    const act = Obstacles.active;
    for (let i = 0; i < act.length; i++) {
      const o = act[i];
      if (o.type === 'mysterybox' || o.z > COLLECTED_Z) continue;
      const wz = o.chunk.baseZ + scroll + o.z;
      if (wz < 0 && -wz < range && o.def.slideable) return true;
    }
    return false;
  }

  // chunk whose span contains world z (chunks partition the scroll line)
  _chunkFor(track, wz) {
    const cs = track.chunks;
    for (let i = 0; i < cs.length; i++) {
      const local = wz - (cs[i].baseZ + track.scroll);
      if (local <= 0 && local > -CHUNK_SPAN) return cs[i];
    }
    return null;
  }

  exit(ctx) {}
}
