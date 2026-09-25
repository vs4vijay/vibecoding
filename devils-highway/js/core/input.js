/**
 * @file core/input.js — keyboard + pointer for the shell. Menu input
 * (1/2/3 select, confirm, back) flows through onAction as before; gameplay
 * bindings emit the action strings left/right/jump/slide/pause (+ touch
 * swipe/tap) on the same channel — main.js routes actions by state
 * (run-core-loop design decision 6), so input itself stays state-agnostic.
 */
import { CONFIG } from "./config.js";

const KEY_ACTIONS = {
  Digit1: "mode-1", Numpad1: "mode-1",
  Digit2: "mode-2", Numpad2: "mode-2",
  Digit3: "mode-3", Numpad3: "mode-3",
  Enter: "confirm", NumpadEnter: "confirm",
  Escape: "back",
};

// Gameplay keys, edge-triggered (keydown drops e.repeat = one emission per
// physical press). Escape is deliberately dual: "pause" AND the unchanged
// menu "back" — which of the two means anything is main.js's call by state.
const GAME_KEYS = {
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  KeyW: "jump", ArrowUp: "jump", Space: "jump",
  KeyS: "slide", ArrowDown: "slide",
  Escape: "pause",
};

export class InputManager {
  /** @param {{onAction?: (action: string, code: string) => void}} handlers */
  constructor(handlers = {}) {
    this.onAction = handlers.onAction || (() => {});
    this.enabled = true;
    this._keys = new Set();
    this._swipe = { id: null, x: 0, y: 0 }; // in-flight touch gesture
    this._onKeyDown = (e) => {
      if (!this.enabled || e.repeat) return;
      this._keys.add(e.code);
      const game = GAME_KEYS[e.code];
      if (game) {
        e.preventDefault(); // arrows/Space must never scroll or re-click UI
        this._emit(game, e.code);
        if (e.code === "Escape") this._emit(KEY_ACTIONS.Escape, e.code);
        return;
      }
      const action = KEY_ACTIONS[e.code];
      if (action) {
        e.preventDefault();
        this._emit(action, e.code);
      }
    };
    this._onKeyUp = (e) => this._keys.delete(e.code);
    this._onPointerDown = (e) => {
      if (!this.enabled) return;
      this.onAction("pointer", "");
      if (this._swipe.id !== null) return; // one gesture at a time
      this._swipe.id = e.pointerId;
      this._swipe.x = e.clientX;
      this._swipe.y = e.clientY;
    };
    this._onPointerUp = (e) => {
      if (!this.enabled || e.pointerId !== this._swipe.id) return;
      this._swipe.id = null;
      const dx = e.clientX - this._swipe.x;
      const dy = e.clientY - this._swipe.y;
      const t = CONFIG.INPUT.swipePx;
      if (Math.abs(dx) < t && Math.abs(dy) < t) {
        this._emit("tap", "touch", dx, dy); // zone consumption lands later
      } else if (Math.abs(dx) >= Math.abs(dy)) {
        this._emit(dx > 0 ? "right" : "left", "touch", dx, dy);
      } else {
        this._emit(dy > 0 ? "slide" : "jump", "touch", dx, dy);
      }
    };
    this._onPointerCancel = (e) => {
      if (e.pointerId === this._swipe.id) this._swipe.id = null;
    };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("pointerdown", this._onPointerDown, { passive: true });
    window.addEventListener("pointerup", this._onPointerUp, { passive: true });
    window.addEventListener("pointercancel", this._onPointerCancel, { passive: true });
  }

  /** Single emission point; QA-only trace mirrors it (see qa/hooks.js). */
  _emit(action, code, dx, dy) {
    const trace = window.__QA_ACTIONS;
    if (trace) {
      trace.push({ t: performance.now() | 0, action, code, dx: dx || 0, dy: dy || 0 });
    }
    this.onAction(action, code);
  }

  isDown(code) {
    return this._keys.has(code);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this._keys.clear();
      this._swipe.id = null;
    }
  }

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("pointerdown", this._onPointerDown);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("pointercancel", this._onPointerCancel);
  }
}
