// Player kinematics per contract: snappy lane lerp (~0.12 s), jump v0 9.2 /
// g 24, slide 0.62 s, 120 ms buffered inputs (a jump pressed just before
// landing still fires), forgiving hitboxes (0.72× visual), near-miss expanded
// pass, death via bus. Collisions are plain-number AABBs — zero allocs.
import { bus } from '../core/EventBus.js';
import { sound } from '../core/Sound.js';
import { Obstacles, HIT_SCALE } from '../world/Obstacles.js';
import { LANE_X } from '../world/Chunk.js';
import { Character } from './Character.js';
import { save } from '../core/Save.js'; // [W1-UI] equipped skin (only exception granted to W1-UI)
import { FX } from '../fx/FX.js';
import { economy } from '../game/Economy.js'; // AEGIS SHIELD absorb policy (design D4)

const PHALF_W = 0.3;          // player half-width (hitbox)
const PHALF_D = 0.3;          // player half-depth
const STAND_H = 1.22;         // standing hitbox height (0.72 × ~1.7 visual)
const SLIDE_H = 0.58;         // sliding hitbox height
const JUMP_V = 9.2;
const GRAV = 24;
const FAST_FALL_V = -13;
const SLIDE_TIME = 0.62;
const LANE_SNAP = 22;         // exp approach: ~95% of a lane in ~0.14 s
const JUMP_BUFFER = 0.12;     // s — jump pressed just before landing still fires
const NM_INFLATE = 0.55;      // near-miss box inflation

// module-level scratch for driveAI — zero allocs in update loops
const AI_BLOCK = [Infinity, Infinity, Infinity];
const AI_JUMP = [Infinity, Infinity, Infinity];
const AI_SLIDE = [Infinity, Infinity, Infinity];
const _fxPos = { x: 0, y: 0, z: 0 }; // shield-absorb burst payload (reused)

export class Player {
  constructor(scene) {
    this.character = new Character(save.data.skin || 'cyber'); // [W1-UI] shop EQUIP persists here
    this.group = this.character.group;
    scene.add(this.group);

    this.bus = bus;
    this.laneI = 1;
    this.x = 0;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.slideT = 0;
    this.jumpQueuedAt = -9;
    this.dead = false;
    this.invuln = 0;
    this.shieldUses = 0; // armed per run by Game.startRun (design D3)
    this.autopilot = false; // menu attract / warp
    this.ghost = false;     // collisions off (attract/warp) — near-miss still runs
    this._aiLane = 1;
    this._fastFall = false;
    this._scroll = 0;       // track.scroll cached for kill() (no ctx there)
    this._nmPayload = { type: '' };
    this._speedNorm = 0;
  }

  get height() { return this.slideT > 0 ? SLIDE_H : STAND_H; }

  reset() {
    this.laneI = 1;
    this.x = 0; this.y = 0; this.vy = 0;
    this.grounded = true;
    this.slideT = 0;
    this.jumpQueuedAt = -9;
    this.dead = false;
    this.invuln = 0;
    this.shieldUses = 0;
    this._aiLane = 1;
    this._scroll = 0;
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.character.setBlinkOff();
    this.group.visible = true;
  }

  move(dir) {
    const nl = Math.max(0, Math.min(2, this.laneI + dir));
    if (nl !== this.laneI) {
      this.laneI = nl;
      sound('lane');
    }
  }

  jump() {
    if (this.slideT > 0) this.slideT = 0;
    this.vy = JUMP_V;
    this.grounded = false;
    sound('jump');
  }

  slide() {
    this.slideT = SLIDE_TIME;
    sound('slide');
  }

  kill(cause) {
    if (this.dead || this.invuln > 0 || this.ghost) return;
    // AEGIS SHIELD absorb (design D4): a non-death — no 'death' emit, so the
    // death cam / banking / state machine stay out of this path entirely. The
    // overlapping hazard is passed under invulnerability; releaseAhead opens a
    // survivable pocket for when the window expires.
    if (this.shieldUses > 0) {
      this.shieldUses--;
      economy.spendShieldUse(); // implant use first (once-per-run latch), then a stored charge
      this.invuln = 1.2;
      Obstacles.releaseAhead(this._scroll, -10);
      _fxPos.x = this.x; _fxPos.y = this.y; _fxPos.z = 0;
      FX.burst('crash', _fxPos);
      bus.emit('ui:toast', { msg: 'AEGIS SHIELD ABSORBED', kind: 'info' });
      sound('crash');
      return;
    }
    this.dead = true;
    this.character.play('dead', 0.016, 0);
    bus.emit('death', { cause, position: { x: this.x, y: this.y, z: 0 } });
    sound('crash');
  }

  revive() {
    this.dead = false;
    this.invuln = 1; // 1 s invulnerable flash
    this.vy = 0;
    this.y = Math.max(this.y, 0);
    this.grounded = true;
  }

  update(dt, ctx) {
    const inp = ctx.input;
    this._scroll = ctx.track.scroll; // kill() reads this (releaseAhead pocket)

    if (this.autopilot) this.driveAI(ctx);

    // --- buffered lane changes ---
    if (inp.consume('left')) this.move(-1);
    if (inp.consume('right')) this.move(1);

    // --- jump / slide with buffer ---
    if (this.grounded) {
      if (inp.consume('up')) this.jump();
      else if (inp.consume('down')) this.slide();
    } else {
      // airborne: queue jump for landing, fast-fall on down
      if (inp.consume('up')) this.jumpQueuedAt = ctx.time.gameTime;
      if (inp.consume('down')) {
        this.vy = Math.min(this.vy, FAST_FALL_V);
        this.jumpQueuedAt = -9;
        this._fastFall = true;
      }
    }

    // --- vertical ---
    if (!this.grounded) {
      this.vy -= GRAV * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.grounded = true;
        const buffered = ctx.time.gameTime - this.jumpQueuedAt < JUMP_BUFFER;
        const wantSlide = this._fastFall || inp.consume('down');
        this._fastFall = false;
        this.jumpQueuedAt = -9;
        if (buffered) this.jump();
        else if (wantSlide) this.slide();
      }
    }
    if (this.slideT > 0) this.slideT -= dt;

    // --- lane x (exp approach, frame-rate independent) ---
    const tx = LANE_X[this.laneI];
    this.x += (tx - this.x) * Math.min(1, LANE_SNAP * dt);

    // --- invulnerable flash ---
    if (this.invuln > 0) {
      this.invuln -= dt;
      this.character.setBlink(true);
      if (this.invuln <= 0) this.character.setBlinkOff();
    }

    // --- collisions + near-miss ---
    if (!this.dead && !ctx.menuMode) this.collide(ctx);

    // --- pose ---
    this._speedNorm = Math.min(1.6, ctx.speed / 14);
    const anim = this.dead ? 'dead' : !this.grounded ? 'jump' : this.slideT > 0 ? 'slide' : 'run';
    this.character.play(anim, dt, this._speedNorm);
    this.group.position.set(this.x, this.y, 0);
    this.group.rotation.z = (tx - this.x) * -0.22; // lean into the lane change
  }

  collide(ctx) {
    const scroll = ctx.track.scroll;
    const px = this.x, py = this.y, ph = this.height;
    const active = Obstacles.active;
    for (let i = 0; i < active.length; i++) {
      const o = active[i];
      const wz = o.chunk.baseZ + scroll + o.z;
      const dh = o.def.halfD * HIT_SCALE + PHALF_D;
      if (wz < -dh - 1 || wz > dh + 1) continue;
      const hw = o.def.halfW * HIT_SCALE;
      const hh = o.def.halfH * HIT_SCALE;
      const hit =
        Math.abs(o.x - px) < hw + PHALF_W &&
        Math.abs(wz) < dh &&
        py < o.y + hh && py + ph > o.y - hh;
      if (hit) {
        this.kill(o.type);
        return;
      }
      // near-miss: expanded pass, evaluated once as the obstacle reaches us
      if (!o.nmDone && wz > -(o.def.halfD * HIT_SCALE + 0.4)) {
        o.nmDone = true;
        const close =
          Math.abs(o.x - px) < hw + PHALF_W + NM_INFLATE &&
          py < o.y + hh + NM_INFLATE && py + ph > o.y - hh - NM_INFLATE;
        if (close) {
          const p = this._nmPayload;
          p.type = o.type;
          bus.emit('near-miss', p);
          bus.emit('style:near-miss');
          sound('near-miss');
        }
      }
    }
  }

  // Deterministic auto-dodge used during warp() and menu attract. Presses go
  // through the normal buffered input path. Ghost mode is the safety net.
  driveAI(ctx) {
    const scroll = ctx.track.scroll;
    const speed = ctx.speed;
    const lookahead = Math.max(16, speed * 1.0);
    const inp = ctx.input;

    // lane classification
    AI_BLOCK[0] = AI_BLOCK[1] = AI_BLOCK[2] = Infinity;
    AI_JUMP[0] = AI_JUMP[1] = AI_JUMP[2] = Infinity;
    AI_SLIDE[0] = AI_SLIDE[1] = AI_SLIDE[2] = Infinity;
    const active = Obstacles.active;
    for (let i = 0; i < active.length; i++) {
      const o = active[i];
      const wz = o.chunk.baseZ + scroll + o.z;
      if (wz > 1 || wz < -lookahead) continue;
      const lane = Math.round(o.x / 2.6) + 1;
      if (lane < 0 || lane > 2) continue;
      const d = -wz;
      if (!o.def.jumpable && !o.def.slideable) {
        if (d < AI_BLOCK[lane]) AI_BLOCK[lane] = d;
      } else if (o.def.jumpable) {
        if (d < AI_JUMP[lane]) AI_JUMP[lane] = d;
      } else {
        if (d < AI_SLIDE[lane]) AI_SLIDE[lane] = d;
      }
    }

    const cur = this.laneI;
    // 1) hard blocks: switch to the clearest neighbouring lane
    if (AI_BLOCK[cur] < lookahead) {
      const best = this._clearestLane(AI_BLOCK, cur, lookahead);
      if (best !== cur && best !== this._aiLane) {
        inp.press(best < cur ? 'left' : 'right');
        this._aiLane = best;
      }
    } else if (this._aiLane !== cur) {
      this._aiLane = cur;
    }

    // 2) jumpable barrier ahead → jump at the right moment
    if (this.grounded && AI_JUMP[cur] < speed * 0.42 && AI_JUMP[cur] > speed * 0.12) {
      inp.press('up');
      return;
    }
    // 3) beam ahead → slide
    if (this.slideT <= 0 && AI_SLIDE[cur] < speed * 0.38 && AI_SLIDE[cur] > speed * 0.1) {
      inp.press('down');
    }
  }

  _clearestLane(blockDist, cur, lookahead) {
    let best = cur, bestD = blockDist[cur];
    for (let l = 0; l < 3; l++) {
      if (Math.abs(l - cur) !== 1) continue; // one-step moves only
      if (blockDist[l] > bestD) { bestD = blockDist[l]; best = l; }
    }
    return bestD > lookahead * 1.1 ? best : cur;
  }
}
