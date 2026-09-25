// Keyboard + touch + gamepad → actions {left,right,up,down,drift,pause,confirm}.
// 120 ms buffer so a press just before landing still fires — inputs never
// feel eaten. held() for physical state; pressed()/consume() for the buffer.
// Gamepads: main.js calls poll() once per RAF; edges land in the same queues
// so every scheme shares the buffering guarantees (design D5).
import { bus } from './EventBus.js';

const ACTIONS = ['left', 'right', 'up', 'down', 'drift', 'pause', 'confirm'];

const KEYMAP = {
  ArrowLeft: ['left'], KeyA: ['left'],
  ArrowRight: ['right'], KeyD: ['right'],
  ArrowUp: ['up'], KeyW: ['up'], Space: ['up', 'confirm'],
  ArrowDown: ['down'], KeyS: ['down'],
  ShiftLeft: ['drift'], ShiftRight: ['drift'],
  KeyP: ['pause'], Escape: ['pause'],
  Enter: ['confirm'], NumpadEnter: ['confirm'],
};

export class Input {
  constructor(target) {
    this.bufferMs = 120;
    // clock: Time instance (wired by main.js after Game construction). Buffering
    // in GAME time (not wall time) so slow/hiccuping frames can never eat a
    // press — a 300 ms frame advances the clamp-limited sim 100 ms, and the
    // buffered press is still there when the next fixed step runs.
    this.clock = null;
    this.queues = {};
    this.heldMap = {};
    for (const a of ACTIONS) { this.queues[a] = []; this.heldMap[a] = false; }
    // Immediate hooks (bypass the buffer) — used for pause/confirm/any-key UX.
    this.onAction = null;
    this.onAnyKey = null;
    this._touchDir = null;
    this._touchHold = false;
    this._touchTimer = 0;
    // Gamepad previous state — pre-allocated once; poll() runs every RAF and
    // must not allocate. Buttons snapshot into a bitmap; stick axes use
    // crossing latches instead of stored values.
    this._gpOk = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
    this._gpBtns = new Uint8Array(17); // standard mapping button count
    this._gpRx = false; // stick-x right crossing latch
    this._gpLx = false; // stick-x left crossing latch
    this._gpUy = false; // stick-y up crossing latch
    this._gpDy = false; // stick-y down crossing latch
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', () =>
        bus.emit('ui:toast', { msg: 'GAMEPAD CONNECTED', kind: 'info' }));
      window.addEventListener('gamepaddisconnected', () =>
        bus.emit('ui:toast', { msg: 'GAMEPAD DISCONNECTED', kind: 'info' }));
    }
    this._bind(target || window);
  }

  _now() { return this.clock ? this.clock.gameTime : performance.now() / 1000; }

  _bind(target) {
    target.addEventListener('keydown', (e) => this._onKey(e, true));
    target.addEventListener('keyup', (e) => this._onKey(e, false));
    // Touch on the canvas only — DOM UI buttons keep their own hit areas.
    const canvas = document.getElementById('game');
    if (canvas) {
      canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
      canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
      canvas.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
      canvas.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
      // Mouse click on canvas = tap (jump / confirm).
      canvas.addEventListener('click', () => { this.press('up'); this.press('confirm'); });
    }
  }

  _onKey(e, down) {
    const actions = KEYMAP[e.code];
    if (!actions) {
      if (down && !e.repeat && this.onAnyKey) this.onAnyKey(e);
      return;
    }
    e.preventDefault();
    if (e.repeat) return;
    if (down) {
      for (const a of actions) { this.heldMap[a] = true; this.press(a); }
    } else {
      for (const a of actions) this.heldMap[a] = false;
    }
  }

  press(action) {
    const q = this.queues[action];
    if (!q) return;
    if (q.length > 2) q.shift(); // cap queue, newest wins
    q.push(this._now());
    if (this.onAction) this.onAction(action);
  }

  _expire() {
    const now = this._now();
    for (const a of ACTIONS) {
      const q = this.queues[a];
      while (q.length && now - q[0] > this.bufferMs / 1000) q.shift();
    }
  }

  pressed(action) { this._expire(); return this.queues[action].length > 0; }

  consume(action) {
    this._expire();
    const q = this.queues[action];
    if (q.length) { q.shift(); return true; }
    return false;
  }

  held(action) { return !!this.heldMap[action]; }

  clear() {
    for (const a of ACTIONS) this.queues[a].length = 0;
  }

  // --- touch: swipe = direction, tap = jump/confirm, hold = drift ---
  _onTouchStart(e) {
    e.preventDefault();
    const t = e.changedTouches[0];
    this._sx = t.clientX; this._sy = t.clientY;
    this._st = performance.now();
    this._touchDir = null;
    this._touchHold = false;
    clearTimeout(this._touchTimer);
    this._touchTimer = setTimeout(() => {
      if (!this._touchDir) { this._touchHold = true; this.heldMap.drift = true; }
    }, 320);
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (this._touchDir || this._sx === undefined) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this._sx, dy = t.clientY - this._sy;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    clearTimeout(this._touchTimer);
    this._touchDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy < 0 ? 'up' : 'down');
    this.press(this._touchDir);
  }

  _onTouchEnd(e) {
    e.preventDefault();
    clearTimeout(this._touchTimer);
    const quick = performance.now() - this._st < 260;
    if (!this._touchDir && !this._touchHold && quick) {
      this.press('up'); this.press('confirm'); // tap = flap / jump / confirm
    }
    if (this._touchHold) this.heldMap.drift = false;
    this._touchDir = null;
    this._touchHold = false;
  }

  // --- gamepad: standard mapping, edge-detected per RAF (design D5) -----------
  // Face 0 / stick-up → up+confirm; d-pad 14/15 and stick-x → left/right;
  // d-pad 13 / stick-y-down → down; Start (9) → pause. Sticks fire once per
  // crossing: the latch only re-arms once the axis returns under the 0.35
  // deadband, so a held stick can't machine-gun lane changes (one lane change
  // per deliberate flick, like a keyboard tap). Runs 60×/s — zero allocation.
  poll() {
    if (!this._gpOk) return;
    const pads = navigator.getGamepads();
    let pad = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) { pad = p; break; }
    }
    if (!pad) return;
    const prev = this._gpBtns;
    const btns = pad.buttons;
    const n = btns.length < 17 ? btns.length : 17;

    if (n > 0) {
      const b0 = btns[0].pressed || btns[0].value > 0.5 ? 1 : 0;
      if (b0 && !prev[0]) { this.press('up'); this.press('confirm'); }
      prev[0] = b0;
    }
    if (n > 13) {
      const b13 = btns[13].pressed || btns[13].value > 0.5 ? 1 : 0;
      if (b13 && !prev[13]) this.press('down');
      prev[13] = b13;
    }
    if (n > 9) {
      const b9 = btns[9].pressed || btns[9].value > 0.5 ? 1 : 0;
      if (b9 && !prev[9]) this.press('pause');
      prev[9] = b9;
    }
    if (n > 14) {
      const b14 = btns[14].pressed || btns[14].value > 0.5 ? 1 : 0;
      if (b14 && !prev[14]) this.press('left');
      prev[14] = b14;
    }
    if (n > 15) {
      const b15 = btns[15].pressed || btns[15].value > 0.5 ? 1 : 0;
      if (b15 && !prev[15]) this.press('right');
      prev[15] = b15;
    }

    const axes = pad.axes;
    const ax = axes.length > 0 ? axes[0] : 0;
    const ay = axes.length > 1 ? axes[1] : 0;
    // hysteresis: fire past ±0.5, re-arm only under 0.35 from center
    if (ax > 0.5) {
      if (!this._gpRx) { this._gpRx = true; this.press('right'); }
    } else if (ax < 0.35) this._gpRx = false;
    if (ax < -0.5) {
      if (!this._gpLx) { this._gpLx = true; this.press('left'); }
    } else if (ax > -0.35) this._gpLx = false;
    if (ay < -0.5) {
      if (!this._gpUy) { this._gpUy = true; this.press('up'); this.press('confirm'); }
    } else if (ay > -0.35) this._gpUy = false;
    if (ay > 0.5) {
      if (!this._gpDy) { this._gpDy = true; this.press('down'); }
    } else if (ay < 0.35) this._gpDy = false;
  }
}
