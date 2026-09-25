// Phase contract (ARCHITECTURE.md):
//   class MyPhase extends Phase { id; title; duration; enter(ctx); update(dt,ctx);
//                                 exit(ctx); decorate(chunk,rng); cameraHint }
//   PhaseRegistry.register(MyPhase)
// ctx: { track, player, camera, fx, rng, bus } — fx is a registration surface:
// W1-FX assigns ctx.fx (main.js does it when fx/FX.js lands).
//
// [W1-PHASES] This file also hosts the SHARED PHASE TOOLKIT + the 1.5 s phase
// transition cinematic. Everything here is registration/hook based — no other
// wave's file is edited:
//   pinDirectorSpeed()  — safe accessor patch on Director.speed (hopper cruise,
//                         stack miss penalty, flight scrape slow), restored on
//                         exit; the Director ramp resumes untouched.
//   wrapActions()       — per-phase press routing (hopper hops, orb steering…)
//                         with clobber-safe restore.
//   captureAnim()       — phases own the Character rig while active (Player's
//                         per-tick play() is suppressed so poses don't fight).
//   CoinSet             — pooled phase coins, one InstancedMesh.
//   Cinematic           — bus 'phase:transition' → in-world 3D title card
//                         rushing past the camera + 1.5 s input lock.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { Pool } from '../core/Pool.js';
import { Obstacles } from '../world/Obstacles.js';
import { sound } from '../core/Sound.js';
import { FX } from '../fx/FX.js';
import { coinTokenGeometry, coinTokenMaterial } from '../fx/Textures.js';

export class Phase {
  constructor() {
    this.id = 'phase';
    this.title = 'PHASE';
    this.duration = 40;   // seconds before Director scaling
    this.weight = 1;
    this.cameraHint = null;
    this._active = false;
    this._runStartHook = null;
  }
  enter(ctx) {}
  update(dt, ctx) {}
  exit(ctx) {}
  decorate(chunk, rng) {}

  // [W1-PHASES] Game.startRun() does not call the outgoing phase's exit()
  // (restarts go straight to the RUN phase), so phases arm a bus 'run:start'
  // self-cleanup: pins, input/anim patches and scene mutations can never
  // survive a death→restart.exit() must stay idempotent.
  _armRunStartCleanup(ctx) {
    this._active = true;
    if (this._runStartHook) bus.off('run:start', this._runStartHook);
    this._runStartHook = () => {
      if (!this._active) return;
      try { this.exit(ctx); } catch (e) { /* cleanup must never break the run */ }
    };
    bus.on('run:start', this._runStartHook);
  }
  _disarmRunStartCleanup() {
    this._active = false;
    if (this._runStartHook) { bus.off('run:start', this._runStartHook); this._runStartHook = null; }
  }
}

const registry = new Map();  // id → Cls
const instances = new Map(); // id → singleton instance

export const PhaseRegistry = {
  // register(Cls) or register(id, Cls)
  register(a, b) {
    const Cls = b || a;
    let id = b ? a : Cls.id;
    if (id == null) id = new Cls().id;
    registry.set(id, Cls);
  },
  get(id) {
    let inst = instances.get(id);
    if (!inst) {
      const Cls = registry.get(id);
      if (!Cls) return null;
      inst = new Cls();
      instances.set(id, inst);
    }
    return inst;
  },
  has(id) { return registry.has(id); },
  ids() { return [...registry.keys()]; },
  list() { return [...registry.entries()]; },
};

// ---------------------------------------------------------------------------
// [W1-PHASES] shared helpers
// ---------------------------------------------------------------------------

// Run-phase obstacle suppression: phases own their spawnsets; anything the
// chunk spawner laid down ahead of the player is released the same tick so it
// never reaches the player. Behind-camera leftovers recycle with their chunk.
export function suppressRunObstacles(scroll) {
  Obstacles.releaseAhead(scroll, -2);
}

// Expire leftover score popups at phase entry (they fade in 1 s of realtime,
// but a deterministic warp can freeze them mid-fade into screenshots).
// Uses the W1-FX singleton surface read-only (no FX.js edits).
export function expirePopups() {
  try {
    if (FX && FX.pops) {
      for (const p of FX.pops) { p.t = 1; p.sp.visible = false; }
    }
  } catch (e) { /* cosmetic only */ }
}

// Pin Director.speed to a phase-owned value (or value function) for the phase
// duration. The Director keeps ramping underneath; on unpin the ramp resumes
// (speed never drops mid-run). Clobber-safe: idempotent unpin.
export function pinDirectorSpeed(director, valueFn) {
  if (director.__nrSpeedPin) {
    director.__nrSpeedPin.fn = valueFn;
    return director.__nrSpeedPin.unpin;
  }
  const desc = Object.getOwnPropertyDescriptor(director, 'speed');
  const pin = { fn: valueFn };
  Object.defineProperty(director, 'speed', {
    configurable: true,
    enumerable: true,
    get() { return typeof pin.fn === 'function' ? pin.fn() : pin.fn; },
    set() {}, // absorb the Director's ramp writes while pinned
  });
  pin.unpin = () => {
    if (pin.done || director.__nrSpeedPin !== pin) return;
    pin.done = true;
    delete director.__nrSpeedPin;
    Object.defineProperty(director, 'speed', desc);
  };
  director.__nrSpeedPin = pin;
  return pin.unpin;
}

// Route raw action presses to the phase BEFORE the buffered-input consumers
// (Player lane/jump logic) see them. handler(action) returns true when the
// phase consumed the press (it is then drained from the buffer so the default
// kinematics can never double-handle it). Returns a clobber-safe restore.
export function wrapActions(input, handler) {
  const prev = input.onAction;
  const mine = (a) => {
    let eaten = false;
    try { eaten = !!handler(a); } catch (e) { eaten = false; }
    if (eaten) { input.consume(a); return; }
    if (prev) prev(a);
  };
  input.onAction = mine;
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (input.onAction === mine) input.onAction = prev;
  };
}

// Phases that own player kinematics also own the Character rig: Player's
// per-tick play() is suppressed while captured, the phase drives poses through
// the returned handle. Prevents two play() calls per tick from resetting the
// pose state machines.
export function captureAnim(ctx) {
  const ch = ctx.player.character;
  const real = ch.play;
  ch.play = () => {};
  let restored = false;
  return {
    play(anim, dt, sn) { real.call(ch, anim, dt, sn); },
    restore() {
      if (restored) return;
      restored = true;
      ch.play = real;
    },
  };
}

// ---------------------------------------------------------------------------
// [W1-PHASES] CoinSet — pooled phase coins (drift roadlines, hopper rows).
// One InstancedMesh, ring-recycled by track distance u (world z = scroll − u).
// Collection mirrors Track's coin rules: ±0.95 x, ±1.05 y around player chest.
// ---------------------------------------------------------------------------
export class CoinSet {
  constructor(scene, max = 96, name = 'phase-coins') {
    this.max = max;
    this.t = 0;
    this.pool = new Pool(() => ({ u: 0, x: 0, y: 0, ph: 0 }), null, name);
    this.live = [];
    // r8: the octahedron gem minified to the weakest asset on screen (flat
    // pale-yellow card, stepped edges). All phase coins now share the faceted
    // gold token family (baked unlit facets — reads from every angle).
    this.mesh = new THREE.InstancedMesh(coinTokenGeometry(0.34), coinTokenMaterial(), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3(1, 1, 1);
    this._p = new THREE.Vector3();
    this._payload = { x: 0, y: 0, z: 0, value: 1 };
  }

  add(u, x, y, ph) {
    if (this.live.length >= this.max) return;
    const c = this.pool.get();
    c.u = u; c.x = x; c.y = y; c.ph = ph;
    this.live.push(c);
  }

  clear() {
    for (let i = 0; i < this.live.length; i++) this.pool.release(this.live[i]);
    this.live.length = 0;
  }

  update(dt, scroll, player) {
    this.t += dt;
    const m = this._m, q = this._q, e = this._e, s = this._s, p = this._p;
    const live = this.live;
    let n = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const c = live[i];
      const wz = scroll - c.u;
      if (wz > 14) {
        live[i] = live[live.length - 1]; live.pop();
        this.pool.release(c);
        continue;
      }
      if (player && Math.abs(wz) < 1.0 &&
          Math.abs(c.x - player.x) < 0.95 &&
          Math.abs(c.y - (player.y + 0.8)) < 1.05) {
        const pl = this._payload;
        pl.x = c.x; pl.y = c.y; pl.z = 0; pl.value = 1;
        bus.emit('coin', pl);
        sound('coin');
        live[i] = live[live.length - 1]; live.pop();
        this.pool.release(c);
        continue;
      }
      e.set(0, this.t * 3.5 + c.ph, 0);
      q.setFromEuler(e);
      p.set(c.x, c.y, wz);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(n, m);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// [W1-PHASES] Cinematic — the 1.5 s phase-transition moment. In-world 3D title
// card (canvas texture plane) accelerating past the camera + input lock; the
// warp-tunnel streaks / camera kick / spawn calm already exist upstream
// (FX 'warp' burst + camRig.phaseDolly + Track calm gate).
// Self-wires to the bus; game/input refs come from the debug API contract.
// ---------------------------------------------------------------------------
const PHASE_ACCENT = {
  flight: '#00f0ff', drift: '#ff2bd6', hopper: '#ffd24a',
  stack: '#ffd24a', orb: '#00f0ff', run: '#ff2bd6',
};

function neonTitleTexture(text, accent) {
  const W = 1024, H = 300;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // kicker
  g.font = '600 30px Rajdhani, sans-serif';
  g.shadowColor = accent; g.shadowBlur = 14;
  g.fillStyle = accent;
  g.fillText('P H A S E   S H I F T', W / 2, 52);
  // main title
  g.font = '800 112px Orbitron, Rajdhani, sans-serif';
  g.shadowColor = accent; g.shadowBlur = 46;
  g.fillStyle = '#ffffff';
  g.fillText(text, W / 2, H / 2 + 26);
  g.shadowBlur = 10;
  g.fillStyle = accent;
  g.globalAlpha = 0.55;
  g.fillText(text, W / 2, H / 2 + 26);
  g.globalAlpha = 1;
  // rule
  g.shadowBlur = 18;
  g.strokeStyle = accent;
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(140, H - 42); g.lineTo(W - 140, H - 42); g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const CINE_DUR = 1.5; // s — matches Game.TRANSITION_S
const Cinematic = {
  active: false,
  _raf: 0, _plane: null, _scene: null, _t0: 0,
  _prevAction: null, _myAction: null, _input: null,
  _geo: null,

  begin(toId) {
    this.cancel();
    const nr = (typeof window !== 'undefined' && window.__NR) || null;
    const game = nr && nr.game;
    const scene = nr && nr.scene;
    if (!game || !scene || game.state !== 'RUN') return;
    const ph = PhaseRegistry.get(toId);
    const title = ph ? ph.title : String(toId || '').toUpperCase();
    const accent = PHASE_ACCENT[toId] || '#00f0ff';

    // ---- input lock (movement presses eaten for the window) ----
    const input = game.input;
    this._input = input;
    this._prevAction = input.onAction;
    input.clear();
    const mine = (a) => {
      if (a === 'pause' || a === 'confirm') {
        const p = this._prevAction;
        if (p) p(a);
        return;
      }
      input.consume(a); // locked
    };
    this._myAction = mine;
    input.onAction = mine;

    // ---- title card ----
    if (!this._geo) this._geo = new THREE.PlaneGeometry(11, 3.22);
    const mat = new THREE.MeshBasicMaterial({
      map: neonTitleTexture(`→ ${title}`, accent),
      transparent: true, depthTest: false, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(this._geo, mat);
    plane.position.set(0, 2.6, -30);
    plane.renderOrder = 60;
    plane.frustumCulled = false;
    plane.userData.cinematic = true;
    scene.add(plane);
    this._plane = plane;
    this._scene = scene;
    this.active = true;
    this._t0 = performance.now();

    const tick = () => {
      if (!this.active || !this._plane) return;
      const p = (performance.now() - this._t0) / (CINE_DUR * 1000);
      if (p >= 1) { this.cancel(); return; }
      const e = p * p; // rushes in, punches past
      const plane2 = this._plane;
      plane2.position.z = -30 + 45 * e;
      plane2.position.x = Math.sin(p * 6.0) * 0.5;
      plane2.position.y = 2.6 + Math.sin(p * 3.1) * 0.2;
      plane2.rotation.z = Math.sin(p * 4.4) * 0.035;
      const s = 1.3 + e * 1.1;
      plane2.scale.set(s, s, 1);
      plane2.material.opacity = p < 0.12 ? p / 0.12 : p > 0.74 ? Math.max(0, (1 - p) / 0.26) : 1;
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  },

  cancel() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    if (this._plane) {
      this._scene.remove(this._plane);
      if (this._plane.material) {
        if (this._plane.material.map) this._plane.material.map.dispose();
        this._plane.material.dispose();
      }
      this._plane = null;
    }
    if (this._input && this._myAction) {
      if (this._input.onAction === this._myAction) this._input.onAction = this._prevAction;
    }
    this._input = null; this._myAction = null; this._prevAction = null;
    this.active = false;
  },
};

bus.on('phase:transition', (p) => Cinematic.begin(p && p.to));
bus.on('death', () => Cinematic.cancel());
bus.on('run:start', () => Cinematic.cancel());
bus.on('ui:screen', (s) => { if (s === 'menu' || s === 'pause') Cinematic.cancel(); });
