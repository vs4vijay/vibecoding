// Feel (W1-FEEL) — cross-cutting game-feel systems in one module so the
// owner files stay untouched:
//   · near-miss juice: 80 ms hitstop (Time.scale 0) + "+25" popup at the
//     hazard + micro slow-mo (scale 0.35, 120 ms) at speed > 26 + micro-trauma
//   · FOV punch on speed tier-up ('speed:change') and fever start
//   · haptics (navigator.vibrate, guarded; settings.haptics undefined = on)
//   · death cam: 2.0 s cinematic — replays the last ~1.1 s of camera motion
//     from a pre-allocated 30 Hz ring buffer, then dollies in on the fatal
//     hazard and holds the final framing for the WRECKED screen
//   · mystery-box world pickup: proximity sweep each fixed step; the collect
//     zone strictly contains the box's (tiny) kill zone so pickup always wins
//   · fever fanfare: emits 'fever:start' (additive bus event)
//
// Zero allocations in update paths — payloads, vectors and the ring buffer are
// module-scope/pre-allocated. fixedStep() is driven by ONE marked call at the
// end of Game.fixedStep; update() runs per RAF from main.js (after camRig, so
// the death cam wins the camera).
import { bus } from '../core/EventBus.js';
import { save } from '../core/Save.js';
import { FX } from '../fx/FX.js';
import { economy } from './Economy.js';
import { Obstacles } from '../world/Obstacles.js';

const HITSTOP_S = 0.08;         // 80 ms logic freeze (psychology checklist #2)
const SLOWMO_S = 0.12;          // 120 ms ease-back ramp
const SLOWMO_SCALE = 0.35;
const SLOWMO_MIN_SPEED = 26;    // only juicy at high speed (anti-spam)
const FOV_KICK_TIER = 3.5;      // ≤ 4° (brief)
const FOV_KICK_FEVER = 4;
const NEAR_TRAUMA = 0.1;        // subtle shake on crash-adjacent near-miss

const DC_S = 2.0;               // total death-cam length
const DC_REPLAY_S = 1.1;        // buffer replay; rest is dolly-in
const DC_HZ = 30;               // ring sample rate
const DC_STRIDE = 10;           // cam xyz · look xyz · player x/y · scroll · speed
const DC_N = Math.ceil(DC_S * DC_HZ) + 2;
const DC_END_FOV = 55;          // dolly-in punch-in fov

const BOX_COLLECT_Z = 1.5;      // collect zone — strictly contains the kill zone
const BOX_COLLECT_X = 1.4;      // (kill needs |dz| < 0.588 · |dx| < 0.588 · py < 1.19;
const BOX_COLLECT_Y = 1.6;      //  per-step moves are ds ≤ 0.67, dy ≤ 0.22 (fast-fall),
                                //  dx × 0.63 lane-lerp — no trajectory can enter the
                                //  kill zone without the collect zone firing first:
                                //  collect fails at N-1 ⟹ kill geometry fails at N)
const BOX_GONE = 1e4;           // collected marker in record z (out of every test)

const PHOTO_DEATH = typeof location !== 'undefined' &&
  location.search.indexOf('photo=death') >= 0;

const easeInOut = (t) => t * t * (3 - 2 * t);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class FeelSystems {
  constructor() {
    this.game = null;
    this.hitstopT = 0;
    this.slowmoT = 0;
    this.lastComboTier = 1;
    this.feverWas = false;

    // death cam
    this.dcActive = false;
    this.dcT = 0;
    this.dcSkip = false;
    this._buf = new Float32Array(DC_N * DC_STRIDE); // pre-allocated ring
    this._head = 0;       // next write slot
    this._count = 0;      // valid samples
    this._sampleAcc = 0;
    this._dcFromPos = { x: 0, y: 0, z: 0 };
    this._dcFromLook = { x: 0, y: 0, z: 0 };
    this._dcFromFov = 60;
    this._haz = { x: 0, y: 0.8, z: 0 };
    this._burstPos = { x: 0, y: 0, z: 0 };
    this._feverPayload = {};
    this._bobT = 0;
    this._boxMat = null;
    // Chromium blocks navigator.vibrate before the first user gesture (and
    // logs a console error that trips the QA harness) — latch on first input.
    this._gestured = false;
    if (typeof window !== 'undefined') {
      const gesture = () => { this._gestured = true; };
      window.addEventListener('pointerdown', gesture, { once: true, passive: true });
      window.addEventListener('touchstart', gesture, { once: true, passive: true });
      window.addEventListener('keydown', gesture, { once: true, passive: true });
    }

    // QA surface (plain object, mutated in place — see tools probes)
    this.debug = {
      hitstops: 0, slowmos: 0, fovKicks: 0, haptics: 0, popups: 0,
      boxOpens: 0, deathCamActive: false, deathCamT: 0, scaleDips: 0,
    };
  }

  // [W1-FEEL] main.js hookup: Feel.init(game) — one line next to FX/Audio.
  init(game) {
    if (this.game) return;
    this.game = game;
    if (typeof window !== 'undefined') window.__NR_FEEL_DEBUG = this.debug;

    bus.on('near-miss', () => this.onNearMiss());
    bus.on('speed:change', () => this.onSpeedChange());
    bus.on('combo:change', (p) => this.onCombo(p));
    bus.on('phase:start', () => this.onPhaseStart());
    bus.on('death', (p) => this.startDeathCam(p));
    bus.on('run:start', () => this.onRunStart());
    bus.on('ui:screen', (s) => { if (s === 'menu') this.endDeathCam(false); });
  }

  // ---- bus handlers -----------------------------------------------------------

  onRunStart() {
    this.hitstopT = 0;
    this.slowmoT = 0;
    this.lastComboTier = 1;
    this.feverWas = false;
    this.debug.deathCamT = 0;
    this.endDeathCam(false);
    this._head = 0;
    this._count = 0;
    this._sampleAcc = 0;
  }

  onNearMiss() {
    const g = this.game;
    if (!g || g.warping) return; // warp/menu spawns its own noise via FX
    this.debug.hitstops++;
    this.debug.scaleDips++;
    this.hitstopT = Math.max(this.hitstopT, HITSTOP_S);
    if (g.ctx.speed > SLOWMO_MIN_SPEED) {
      this.slowmoT = Math.max(this.slowmoT, SLOWMO_S);
      this.debug.slowmos++;
    }
    // "+25" popup pinned to the hazard we just grazed (FX already pops
    // CLOSE!/NEAR MISS at the player). 6.5 m: trains evaluate their near-miss
    // pass early (halfD 7), so the trigger plane sits further out.
    // r2 (critic #3): FX pops its near popup from the SAME 'near-miss' emit
    // and combo:change can add a third — a '+25' here triple-prints one
    // airspace, so it is suppressed when a near-family popup spawned this
    // frame (FX.nearPopFrame). Popup-spawn call site only; hitstop / slow-mo /
    // shake below stay untouched.
    if (this.findHazard(6.5, this._haz) && FX.nearPopFrame !== FX.frame) {
      const pl = g.player;
      FX.spawnPop('gain', 25, this._haz.x - pl.x, Math.max(0.9, this._haz.y + 0.7 - pl.y));
      this.debug.popups++;
    }
    g.camRig.shake(NEAR_TRAUMA);
    this.haptic(15);
  }

  onSpeedChange() {
    const rig = this.game && this.game.camRig;
    if (!rig) return;
    rig.fovKick = Math.max(rig.fovKick, FOV_KICK_TIER);
    this.debug.fovKicks++;
  }

  onCombo(p) {
    const tier = p && p.tier ? p.tier : 1;
    if (tier > this.lastComboTier) this.haptic(20); // rising tiers only
    this.lastComboTier = tier;
  }

  onPhaseStart() {
    const g = this.game;
    if (!g) return;
    if (g.fever && !this.feverWas) {
      this.feverWas = true;
      g.camRig.fovKick = Math.max(g.camRig.fovKick, FOV_KICK_FEVER);
      this.debug.fovKicks++;
      bus.emit('fever:start', this._feverPayload);
    } else if (!g.fever) {
      this.feverWas = false;
    }
  }

  haptic(ms) {
    if (!this._gestured) return; // pre-gesture calls are blocked + log errors
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
    const s = save.data.settings;
    if (s && s.haptics === false) return; // undefined → on (UI adds toggle later)
    try { navigator.vibrate(ms); this.debug.haptics++; } catch (e) { /* never break */ }
  }

  // ---- fixed step (called from Game.fixedStep) ---------------------------------

  fixedStep(dt) {
    const g = this.game;
    if (!g) return;

    // 30 Hz ring sample for the death cam
    this._sampleAcc += dt;
    if (this._sampleAcc >= 1 / DC_HZ) {
      this._sampleAcc -= 1 / DC_HZ;
      this.sample();
    }

    this.collectBoxes();
  }

  sample() {
    const g = this.game;
    const rig = g.camRig;
    const o = this._head * DC_STRIDE;
    const b = this._buf;
    b[o] = rig.pos.x; b[o + 1] = rig.pos.y; b[o + 2] = rig.pos.z;
    b[o + 3] = rig.look.x; b[o + 4] = rig.look.y; b[o + 5] = rig.look.z;
    b[o + 6] = g.player.x; b[o + 7] = g.player.y;
    b[o + 8] = g.track.scroll; b[o + 9] = g.ctx.speed;
    this._head = (this._head + 1) % DC_N;
    if (this._count < DC_N) this._count++;
  }

  // Proximity pickup for mystery boxes. Runs AFTER player.update in the same
  // step: the collect zone (z 1.5 / x 1.4 / y ±1.3) strictly contains the box
  // hitbox (0.588³ around the lane center), so pickup always happens at least
  // one step before the lethal overlap could. During warp() pickups are silent
  // (no economy/randomness) to keep warp deterministic for the Photo API.
  collectBoxes() {
    const g = this.game;
    const pl = g.player;
    if (pl.dead || g.ctx.menuMode) return;
    const scroll = g.track.scroll;
    const active = Obstacles.active;
    for (let i = 0; i < active.length; i++) {
      const o = active[i];
      if (o.type !== 'mysterybox' || o.z > BOX_GONE) continue;
      const wz = o.chunk.baseZ + scroll + o.z;
      if (wz > BOX_COLLECT_Z || wz < -BOX_COLLECT_Z) continue;
      if (Math.abs(o.x - pl.x) > BOX_COLLECT_X) continue;
      if (Math.abs(o.y - (pl.y + 0.8)) > BOX_COLLECT_Y) continue;
      // neutralize the record (z marker skips every future test incl. AI and
      // near-miss) and drop the mesh below the floor — pool-safe, no release
      o.z += BOX_GONE;
      o.nmDone = true;
      o.obj.position.y = -50;
      if (g.warping) continue; // deterministic warp: consume silently
      this._burstPos.x = o.x; this._burstPos.y = o.y; this._burstPos.z = 0;
      FX.burst('coin', this._burstPos); // world-position sparkle; Economy emits
      economy.openBox();                // 'box:open' itself (reward toast/sfx)
      this.debug.boxOpens++;
    }
  }

  // Nearest hazard record around the player plane → out {x,y,z}. Zero alloc.
  findHazard(maxZ, out) {
    const g = this.game;
    const scroll = g.track.scroll;
    const active = Obstacles.active;
    let best = maxZ;
    let found = false;
    for (let i = 0; i < active.length; i++) {
      const o = active[i];
      if (o.type === 'mysterybox' || o.z > BOX_GONE) continue;
      const wz = o.chunk.baseZ + scroll + o.z;
      const d = Math.abs(wz);
      if (d < best) {
        best = d;
        out.x = o.x; out.y = o.y; out.z = wz;
        found = true;
      }
    }
    return found;
  }

  // ---- death cam -----------------------------------------------------------------

  startDeathCam(payload) {
    const g = this.game;
    if (!g) return;
    this._count = Math.min(this._count, DC_N);
    // fatal hazard: nearest live obstacle, else the death payload position
    if (!this.findHazard(4.5, this._haz)) {
      this._haz.x = payload && payload.position ? payload.position.x : 0;
      this._haz.y = payload && payload.position ? payload.position.y + 0.8 : 0.8;
      this._haz.z = 0;
    }
    // dolly start = the pose the camera had at death (replay overwrites it
    // sample-by-sample; the photo-skip path dollies straight from here)
    const rig = g.camRig;
    this._dcFromPos.x = rig.pos.x; this._dcFromPos.y = rig.pos.y; this._dcFromPos.z = rig.pos.z;
    this._dcFromLook.x = rig.look.x; this._dcFromLook.y = rig.look.y; this._dcFromLook.z = rig.look.z;
    this._dcFromFov = rig.fov;
    this.dcT = 0;
    this.dcSkip = PHOTO_DEATH; // deterministic photo: snap to final framing
    this.dcActive = true;
    this.debug.deathCamActive = true;
  }

  endDeathCam(snapRig) {
    if (!this.dcActive) return;
    this.dcActive = false;
    this.debug.deathCamActive = false;
    if (snapRig) this.holdFraming();
  }

  // Copy the final framing into the rig so camRig.apply() keeps rendering it
  // after the death cam hands the camera back.
  holdFraming() {
    const g = this.game;
    const rig = g.camRig;
    rig.pos.set(this._dcFromPos.x, this._dcFromPos.y, this._dcFromPos.z);
    rig.look.set(this._dcFromLook.x, this._dcFromLook.y, this._dcFromLook.z);
    rig.fov = DC_END_FOV;
    rig.fovKick = 0;
  }

  // Ring read: i ∈ [0, count) → stride-offset of the i-th oldest sample.
  ringIdx(i) {
    return ((this._head - this._count + i + DC_N * 2) % DC_N) * DC_STRIDE;
  }

  updateDeathCam(dtRaw) {
    const g = this.game;
    const cam = g.camRig.cam;
    // clamp so a tab stall can't skip the whole cinematic
    const dt = Math.min(dtRaw, 0.1);
    this.dcT += dt;
    this.debug.deathCamT = this.dcT;
    const b = this._buf;

    if (this.dcT < DC_REPLAY_S && !this.dcSkip) {
      // replay the recorded camera path over the frozen world
      const n = Math.max(1, Math.min(this._count, Math.round(DC_REPLAY_S * DC_HZ)));
      const f = Math.min(this._count - 1, (this.dcT / DC_REPLAY_S) * (n - 1));
      const i0 = Math.floor(f);
      const fr = f - i0;
      const a = this.ringIdx(i0);
      const c = this.ringIdx(Math.min(this._count - 1, i0 + 1));
      const px = b[a] + (b[c] - b[a]) * fr;
      const py = b[a + 1] + (b[c + 1] - b[a + 1]) * fr;
      const pz = b[a + 2] + (b[c + 2] - b[a + 2]) * fr;
      const lx = b[a + 3] + (b[c + 3] - b[a + 3]) * fr;
      const ly = b[a + 4] + (b[c + 4] - b[a + 4]) * fr;
      const lz = b[a + 5] + (b[c + 5] - b[a + 5]) * fr;
      cam.position.set(px, py, pz);
      cam.lookAt(lx, ly, lz);
      if (Math.abs(cam.fov - g.camRig.fov) > 0.01) {
        cam.fov = g.camRig.fov;
        cam.updateProjectionMatrix();
      }
      if (this.dcT + dt >= DC_REPLAY_S) {
        this._dcFromPos.x = px; this._dcFromPos.y = py; this._dcFromPos.z = pz;
        this._dcFromLook.x = lx; this._dcFromLook.y = ly; this._dcFromLook.z = lz;
        this._dcFromFov = cam.fov;
      }
      return;
    }

    // dolly-in toward the fatal hazard, then hold (final framing). The look
    // target aims past the wreck so it settles off-center (rule of thirds) —
    // the WRECKED UI owns the screen center.
    const p = this.dcSkip ? 1 : clamp((this.dcT - DC_REPLAY_S) / (DC_S - DC_REPLAY_S), 0, 1);
    const e = easeInOut(p);
    const fx = this._dcFromPos.x, fy = this._dcFromPos.y, fz = this._dcFromPos.z;
    const tx = this._haz.x * 0.55 + 2.4, ty = 1.7, tz = this._haz.z + 3.4;
    const lx0 = this._dcFromLook.x, ly0 = this._dcFromLook.y, lz0 = this._dcFromLook.z;
    const ltx = this._haz.x - 0.9, lty = 0.75, ltz = this._haz.z - 2.0;
    cam.position.set(fx + (tx - fx) * e, fy + (ty - fy) * e, fz + (tz - fz) * e);
    cam.lookAt(lx0 + (ltx - lx0) * e, ly0 + (lty - ly0) * e, lz0 + (ltz - lz0) * e);
    const fov = this._dcFromFov + (DC_END_FOV - this._dcFromFov) * e;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    if (p >= 1) {
      // preserve the dolly end pose as the "from" pose so holdFraming keeps it
      this._dcFromPos.x = tx; this._dcFromPos.y = ty; this._dcFromPos.z = tz;
      this._dcFromLook.x = ltx; this._dcFromLook.y = lty; this._dcFromLook.z = ltz;
      this.endDeathCam(true); // deathCamActive → false; rig holds the framing
    }
  }

  // ---- per-RAF --------------------------------------------------------------------

  update(dtReal) {
    const g = this.game;
    if (!g) return;

    // Time.scale driver (Time.advance already multiplies dt by scale). Only
    // meaningful while RUN; any other state gets a clean 1.
    const t = g.time;
    if (g.state !== 'RUN') {
      if (t.scale !== 1) t.scale = 1;
      this.hitstopT = 0;
      this.slowmoT = 0;
    } else if (this.hitstopT > 0) {
      this.hitstopT -= dtReal;
      t.scale = 0; // hard freeze
    } else if (this.slowmoT > 0) {
      this.slowmoT -= dtReal;
      t.scale = SLOWMO_SCALE + (1 - SLOWMO_SCALE) * (1 - this.slowmoT / SLOWMO_S);
      if (t.scale > 1) t.scale = 1;
    } else if (t.scale !== 1) {
      t.scale = 1;
    }

    if (this.dcActive) {
      if (g.state !== 'DEAD') {
        this.endDeathCam(false);
      } else {
        this.updateDeathCam(dtReal);
      }
    }

    this.bobBoxes(dtReal);
  }

  // Mystery-box bob/spin/emissive pulse — ≤ 2 boxes alive, a few ops each.
  bobBoxes(dtReal) {
    this._bobT += dtReal;
    const t = this._bobT;
    const active = Obstacles.active;
    for (let i = 0; i < active.length; i++) {
      const o = active[i];
      if (o.type !== 'mysterybox' || o.z > BOX_GONE) continue;
      if (!this._boxMat && o.obj.children[0] && o.obj.children[0].material) {
        this._boxMat = o.obj.children[0].material; // shared by the pool
      }
      o.obj.position.y = o.def.y + Math.sin(t * 3 + o.x * 1.7) * 0.12;
      o.obj.rotation.y = t * 1.4 + o.x;
    }
    if (this._boxMat && this._boxMat.emissive) {
      this._boxMat.emissiveIntensity = 1.7 + Math.sin(t * 5.2) * 0.5;
    }
  }
}

export const Feel = new FeelSystems();
