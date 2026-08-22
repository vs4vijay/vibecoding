export type FireSide = "left" | "right";

/** Tap classification thresholds: quick enough and small enough. */
const TAP_MAX_MS = 200;
const TAP_MAX_PX = 10;

/** Drag velocity (px/ms) mapped through half-width and this gain to steer. */
const DRAG_STEER_GAIN = 0.01;

/** Keyboard steering magnitude per held key. */
const KEY_STEER = 1;
/** Steer keys mapped to direction; most recently pressed wins. */
const STEER_KEYS: Record<string, number> = {
  ArrowRight: KEY_STEER,
  KeyD: KEY_STEER,
  ArrowLeft: -KEY_STEER,
  KeyA: -KEY_STEER,
};
/** Fire keys: "," fires the left gun, "." the right gun. */
const FIRE_KEYS: Record<string, FireSide> = { ",": "left", ".": "right" };
/** Pause keys: Escape or P. */
const PAUSE_KEYS: Record<string, true> = { Escape: true, KeyP: true };

/**
 * The minimal state surface the controller needs. Satisfied by
 * HTMLCanvasElement and by test doubles (`{ clientWidth }`).
 */
export interface CanvasLike {
  clientWidth: number;
}

/**
 * The live-DOM surface bind() needs: an event target that supports pointer
 * capture (HTMLCanvasElement). Test hooks mode never touches it, so tests
 * construct from `CanvasLike` alone.
 */
type DomCanvas = CanvasLike & EventTarget & { setPointerCapture(id: number): void };

/** Narrow a stored canvas to the DOM surface; valid only outside testHooks mode. */
function domOf(canvas: CanvasLike): DomCanvas {
  return canvas as unknown as DomCanvas;
}

export interface InputControllerOpts {
  /** Skip DOM listeners; expose press/moveTo/release/keyDown test hooks. */
  testHooks?: boolean;
}

/**
 * True iff the gesture is quick (<200 ms) and small (<10 px) — a deliberate
 * tap rather than a drag.
 */
export function classifyTap(durationMs: number, travelPx: number): boolean {
  return durationMs < TAP_MAX_MS && travelPx < TAP_MAX_PX;
}

/**
 * Unified pointer + keyboard input.
 *
 * Real-DOM mode binds pointerdown/pointermove/pointerup on the canvas
 * (setPointerCapture, primary pointer tracked by pointerId) plus
 * keydown/keyup on window. testHooks mode binds nothing and exposes the
 * same gesture entry points as methods for deterministic tests.
 */
export class InputController {
  /** -1 (full left) .. 1 (full right), from drag velocity or held keys. */
  steer = 0;

  private readonly canvas: CanvasLike;
  private readonly testHooks: boolean;
  private readonly fireCbs = new Set<(side: FireSide) => void>();
  private readonly pauseCbs = new Set<() => void>();

  private pointerId: number | null = null;
  private downX = 0;
  private downTime = 0;
  private lastX = 0;
  private lastY = 0;
  private lastTime = 0;
  private travel = 0;
  /** Held steer keys in press order; last entry wins. */
  private readonly heldSteerKeys: string[] = [];

  constructor(canvas: CanvasLike, opts?: InputControllerOpts) {
    this.canvas = canvas;
    this.testHooks = opts?.testHooks === true;
    if (!this.testHooks) this.bind();
  }

  onFire(cb: (side: FireSide) => void): () => void {
    this.fireCbs.add(cb);
    return () => void this.fireCbs.delete(cb);
  }

  onPause(cb: () => void): () => void {
    this.pauseCbs.add(cb);
    return () => void this.pauseCbs.delete(cb);
  }

  dispose(): void {
    if (this.testHooks) return;
    this.unbind();
  }

  // --- Test hooks (present always, active only in testHooks mode). ---

  press(x: number, y: number, t: number): void {
    if (!this.testHooks || this.pointerId !== null) return;
    this.pointerId = 1; // synthetic primary pointer
    this.beginGesture(x, y, t);
  }

  moveTo(x: number, y: number, t: number): void {
    if (!this.testHooks || this.pointerId === null) return;
    this.moveGesture(x, y, t);
  }

  release(t: number): void {
    if (!this.testHooks || this.pointerId === null) return;
    this.endGesture(t);
  }

  keyDown(code: string): void {
    if (!this.testHooks) return;
    this.handleKey(code, true);
  }

  keyUp(code: string): void {
    if (!this.testHooks) return;
    this.handleKey(code, false);
  }

  // --- Gesture internals shared by DOM events and test hooks. ---

  private applyDragSteer(dx: number, dt: number): void {
    const vx = dx / dt; // px per ms
    const halfWidth = this.canvas.clientWidth / 2;
    this.steer = Math.max(-1, Math.min(1, vx * halfWidth * DRAG_STEER_GAIN));
  }

  private updateKeySteer(): void {
    if (this.heldSteerKeys.length > 0) {
      const code = this.heldSteerKeys[this.heldSteerKeys.length - 1];
      this.steer = STEER_KEYS[code];
    } else {
      this.steer = 0;
    }
  }

  private handleKey(code: string, down: boolean): void {
    if (code in STEER_KEYS) {
      const idx = this.heldSteerKeys.indexOf(code);
      if (down) {
        if (idx === -1) this.heldSteerKeys.push(code);
      } else if (idx !== -1) {
        this.heldSteerKeys.splice(idx, 1);
      }
      this.updateKeySteer();
      return;
    }
    if (!down) return;
    const side = FIRE_KEYS[code];
    if (side) {
      this.fire(side);
      return;
    }
    if (PAUSE_KEYS[code]) {
      for (const cb of this.pauseCbs) cb();
    }
  }

  private fire(side: FireSide): void {
    for (const cb of this.fireCbs) cb(side);
  }

  // --- Real-DOM bindings. ---

  private boundHandlers: Array<[EventTarget, string, EventListener]> = [];

  private on<T extends Event>(
    target: EventTarget,
    type: string,
    handler: (ev: T) => void,
  ): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener);
    this.boundHandlers.push([target, type, listener]);
  }

  private bind(): void {
    const canvas = domOf(this.canvas);
    this.on(canvas, "pointerdown", (ev: PointerEvent) => {
      if (this.pointerId !== null) return; // single primary pointer only
      this.pointerId = ev.pointerId;
      canvas.setPointerCapture(ev.pointerId);
      this.beginGesture(ev.clientX, ev.clientY, ev.timeStamp);
    });
    this.on(canvas, "pointermove", (ev: PointerEvent) => {
      if (ev.pointerId !== this.pointerId) return;
      this.moveGesture(ev.clientX, ev.clientY, ev.timeStamp);
    });
    this.on(canvas, "pointerup", (ev: PointerEvent) => {
      if (ev.pointerId !== this.pointerId) return;
      this.endGesture(ev.timeStamp);
    });
    this.on(canvas, "pointercancel", (ev: PointerEvent) => {
      if (ev.pointerId !== this.pointerId) return;
      this.endGesture(ev.timeStamp);
    });

    this.on(window, "keydown", (ev: KeyboardEvent) =>
      this.handleKey(ev.code, true),
    );
    this.on(window, "keyup", (ev: KeyboardEvent) => this.handleKey(ev.code, false));
  }

  private unbind(): void {
    for (const [target, type, listener] of this.boundHandlers) {
      target.removeEventListener(type, listener);
    }
    this.boundHandlers = [];
  }

  private beginGesture(x: number, y: number, t: number): void {
    this.downX = x;
    this.downTime = t;
    this.lastX = x;
    this.lastY = y;
    this.lastTime = t;
    this.travel = 0;
  }

  private moveGesture(x: number, y: number, t: number): void {
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    const dt = t - this.lastTime;
    this.travel += Math.hypot(dx, dy);
    this.lastX = x;
    this.lastY = y;
    this.lastTime = t;
    // Zero-dt samples carry no velocity information; skip them.
    if (dt > 0 && dx !== 0) this.applyDragSteer(dx, dt);
  }

  private endGesture(t: number): void {
    this.pointerId = null;
    const durationMs = t - this.downTime;
    if (classifyTap(durationMs, this.travel)) {
      this.fire(this.downX < this.canvas.clientWidth / 2 ? "left" : "right");
      return;
    }
    this.steer = 0;
  }
}
