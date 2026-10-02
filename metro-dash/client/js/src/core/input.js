/**
 * @file core/input.js
 * Keyboard + touch input producing semantic gameplay actions.
 *
 * Emits: "left" | "right" | "jump" | "roll" | "pause".
 * Events are timestamped with performance.now(); input buffering (120 ms)
 * is applied by game/run.js using those timestamps. Touch supports swipe
 * detection with a threshold and swipe-vs-tap disambiguation (tap top half
 * = jump, bottom half = roll). Gestures starting on an element marked
 * data-input-exclude (interactive HUD controls) are ignored entirely.
 */

/** Swipe/ tap thresholds. */
const SWIPE_MIN_DISTANCE = 24; // px
const TAP_MAX_DURATION = 300; // ms

/**
 * True when a gesture starts on (or inside) an interactive HUD control.
 * Every such control carries the data-input-exclude attribute, and
 * InputManager must never turn its taps/swipes into gameplay actions
 * (ui-ux-pass design D2). The target check is order-independent — it does
 * not rely on the control's own listeners running first. Null targets and
 * environments without Element.closest degrade to "not excluded" so
 * gameplay input stays intact.
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
function startedOnExcludedControl(target) {
  if (!target || typeof target.closest !== "function") return false;
  try {
    return !!target.closest("[data-input-exclude]");
  } catch {
    return false;
  }
}

export class InputManager {
  /**
   * @param {(action: string) => void} onAction Called for each semantic action.
   */
  constructor(onAction) {
    this.onAction = onAction;
    this._touchStart = null; // { x, y, time, consumed }
    this._enabled = true;

    this._onKeyDown = (e) => {
      if (!this._enabled) return;
      // Never swallow typing in form fields.
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      let action = null;
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          action = "left";
          break;
        case "ArrowRight":
        case "KeyD":
          action = "right";
          break;
        case "ArrowUp":
        case "KeyW":
        case "Space":
          action = "jump";
          break;
        case "ArrowDown":
        case "KeyS":
          action = "roll";
          break;
        case "Escape":
        case "KeyP":
          action = "pause";
          break;
        default:
          return;
      }
      e.preventDefault();
      if (!e.repeat) this.onAction(action);
    };

    this._onTouchStart = (e) => {
      if (!this._enabled || e.touches.length === 0) return;
      // Gestures born on a HUD control (data-input-exclude) are UI taps,
      // not gameplay input — drop the whole gesture without recording a
      // start point, so neither the later swipe nor the tap fires (D2).
      if (startedOnExcludedControl(e.target)) return;
      const t = e.touches[0];
      this._touchStart = { x: t.clientX, y: t.clientY, time: performance.now(), consumed: false };
    };

    this._onTouchMove = (e) => {
      if (!this._enabled || !this._touchStart || this._touchStart.consumed) return;
      const t = e.touches[0];
      const dx = t.clientX - this._touchStart.x;
      const dy = t.clientY - this._touchStart.y;
      if (Math.abs(dx) < SWIPE_MIN_DISTANCE && Math.abs(dy) < SWIPE_MIN_DISTANCE) return;
      this._touchStart.consumed = true; // it is a swipe, not a tap
      if (Math.abs(dx) >= Math.abs(dy)) {
        this.onAction(dx > 0 ? "right" : "left");
      } else {
        this.onAction(dy > 0 ? "roll" : "jump");
      }
    };

    this._onTouchEnd = (e) => {
      if (!this._enabled) return;
      const start = this._touchStart;
      this._touchStart = null;
      if (!start || start.consumed) return; // was a swipe
      const dur = performance.now() - start.time;
      if (dur > TAP_MAX_DURATION) return;
      // Tap disambiguation: top half jumps, bottom half rolls.
      this.onAction(e.changedTouches[0].clientY < window.innerHeight / 2 ? "jump" : "roll");
    };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("touchstart", this._onTouchStart, { passive: true });
    window.addEventListener("touchmove", this._onTouchMove, { passive: true });
    window.addEventListener("touchend", this._onTouchEnd, { passive: true });
  }

  /** Ignore input (e.g. while paused or in menus). */
  disable() {
    this._enabled = false;
  }

  /** Re-enable input. */
  enable() {
    this._enabled = true;
  }

  /** Remove all listeners. */
  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("touchstart", this._onTouchStart);
    window.removeEventListener("touchmove", this._onTouchMove);
    window.removeEventListener("touchend", this._onTouchEnd);
  }
}
