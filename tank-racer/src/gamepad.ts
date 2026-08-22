// Phase 10: gamepad support (Standard Gamepad mapping).
//
// Polls navigator.getGamepads() once per frame via update(); the first
// connected standard-mapped pad drives the player. Racing input folds into the
// same TankInput shape the keyboard and touch controls produce, so physics /
// weapons need no special cases. Menu navigation (dpad / left stick / A) is
// edge-triggered with a repeat cooldown, so one stick flick cycles exactly one
// option — holding the stick repeats slowly instead of spinning through them.

import type { TankInput } from "./tank";

/** Menu-direction / confirm actions the game layer reacts to. */
export type GamepadMenuAction =
  | "left"
  | "right"
  | "up"
  | "down"
  | "confirm"
  | "pause"
  | "mode"; // Phase 13: Y toggles 1P/2P on the title screen (like key C)

export interface GamepadCallbacks {
  /** Fired on every `gamepadconnected` event (for the 🎓/🎮 toast). */
  onConnect?: () => void;
  /** Fired on every `gamepaddisconnected` event. */
  onDisconnect?: () => void;
}

// --- Tuning -----------------------------------------------------------------
const DEADZONE = 0.15; // raw stick magnitude below this reads as centered
const STEER_CURVE = 1.5; // response exponent: gentle near center, sharp at edges
const TRIGGER_THRESHOLD = 0.5; // analog trigger / button value counts as held
const MENU_STICK_THRESHOLD = 0.5; // left-stick deflection for menu directions
const MENU_REPEAT_DELAY = 0.35; // hold time before a direction starts repeating
const MENU_REPEAT_RATE = 0.18; // seconds between repeats once repeating

/**
 * Signed menu direction: ±1 = horizontal (left/right), ±2 = vertical
 * (up/down). Two magnitudes so a diagonal never looks like "no change".
 */
type MenuDir = -2 | -1 | 0 | 1 | 2;

export class GamepadInput {
  /** True while any gamepad is connected (debug/HUD visibility). */
  connected = false;

  private readonly onConnect?: () => void;
  private readonly onDisconnect?: () => void;

  /** Index (into navigator.getGamepads()) of the pad we drive with. */
  private padIndex: number | null = null;

  // Live snapshots of the active pad, refreshed by update(). Empty when no pad.
  private buttons: readonly GamepadButton[] = [];
  private axes: readonly number[] = [];

  // Edge trackers — previous-frame button states for one-shot semantics.
  private prevFire = false;
  private prevStart = false;
  private prevConfirm = false;
  private prevMode = false;
  private prevDir: MenuDir = 0;

  /** Queued on each new FIRE press; consumed by the game loop. */
  private fireQueued = false;

  /** Seconds until a held menu direction may repeat. Ticked by update(). */
  private repeatClock = 0;

  constructor(callbacks: GamepadCallbacks = {}) {
    this.onConnect = callbacks.onConnect;
    this.onDisconnect = callbacks.onDisconnect;
  }

  attach(): void {
    window.addEventListener("gamepadconnected", this.onConnected);
    window.addEventListener("gamepaddisconnected", this.onDisconnected);
    // Pads already paired before the page loaded don't fire connect events in
    // every browser until first input — probe once up front.
    this.probe();
  }

  dispose(): void {
    window.removeEventListener("gamepadconnected", this.onConnected);
    window.removeEventListener("gamepaddisconnected", this.onDisconnected);
  }

  /**
   * Refresh the pad snapshot and edge trackers. Call exactly once per frame,
   * before read()/consumeFire()/drainMenuActions().
   */
  update(dt: number): void {
    this.repeatClock = Math.max(0, this.repeatClock - dt);

    const pad = this.activePad();
    if (!pad) {
      // Disconnected mid-race: everything reads neutral until a new pad is
      // picked (connect/disconnect events re-probe the pad list).
      this.buttons = [];
      this.axes = [];
      this.prevFire = false;
      this.prevStart = false;
      this.prevConfirm = false;
      this.prevMode = false;
      this.prevDir = 0;
      return;
    }
    this.buttons = pad.buttons;
    this.axes = pad.axes;

    // FIRE is one-shot per press, matching the Space / FIRE-button pattern.
    const fire = this.fireHeld();
    if (fire && !this.prevFire) this.fireQueued = true;
    this.prevFire = fire;
  }

  /**
   * Current racing input from the active pad. Throttle: A or RT. Brake/reverse:
   * B or LT. Steer: left-stick X with deadzone + curved response.
   */
  read(): TankInput {
    if (this.padIndex === null) return { throttle: 0, steer: 0 };
    const b = this.buttons;
    const accel =
      held(b, 0) ||
      valueOver(b, 7, TRIGGER_THRESHOLD) ||
      axisOver(this.axes, 7, TRIGGER_THRESHOLD);
    const brake =
      held(b, 1) ||
      valueOver(b, 6, TRIGGER_THRESHOLD) ||
      axisOver(this.axes, 6, TRIGGER_THRESHOLD);
    return {
      throttle: accel ? 1 : brake ? -1 : 0,
      steer: curveSteer(this.axes[0] ?? 0),
    };
  }

  /** True once per FIRE press (X or RB); call exactly once per frame. */
  consumeFire(): boolean {
    const f = this.fireQueued;
    this.fireQueued = false;
    return f;
  }

  /**
   * Menu actions triggered this frame, drained once per frame by the game loop:
   * - Start (button 9) edge → "pause" (routes through the P/Esc toggle)
   * - dpad / left-stick direction edge → immediate action, then slow repeats
   *   while held (cooldown prevents cycling several options per flick)
   * - A (button 0) edge → "confirm" (= Enter on title, R on results)
   * - Y (button 3) edge → "mode" (Phase 13: 1P/2P toggle on title)
   */
  drainMenuActions(): GamepadMenuAction[] {
    const actions: GamepadMenuAction[] = [];

    const start = held(this.buttons, 9);
    if (start && !this.prevStart) actions.push("pause");
    this.prevStart = start;

    const dir = this.menuDir();
    if (dir !== 0 && dir !== this.prevDir) {
      // Fresh press (or switch straight to another direction): act at once,
      // then arm the repeat delay.
      actions.push(dirAction(dir));
      this.repeatClock = MENU_REPEAT_DELAY;
    } else if (dir !== 0 && this.repeatClock <= 0) {
      // Still held after the delay: repeat at the slower rate.
      actions.push(dirAction(dir));
      this.repeatClock = MENU_REPEAT_RATE;
    }
    this.prevDir = dir;

    const confirm = held(this.buttons, 0);
    if (confirm && !this.prevConfirm) actions.push("confirm");
    this.prevConfirm = confirm;

    // Phase 13: Y (button 3) = mode toggle on the title screen.
    const y = held(this.buttons, 3);
    if (y && !this.prevMode) actions.push("mode");
    this.prevMode = y;

    return actions;
  }

  /** Left-stick + dpad direction currently held, or 0. Horizontal wins ties. */
  private menuDir(): MenuDir {
    const b = this.buttons;
    let dx = (held(b, 15) ? 1 : 0) - (held(b, 14) ? 1 : 0);
    let dy = (held(b, 13) ? 1 : 0) - (held(b, 12) ? 1 : 0);
    const ax = this.axes[0] ?? 0;
    const ay = this.axes[1] ?? 0; // standard mapping: up is negative
    if (Math.abs(ax) > MENU_STICK_THRESHOLD) dx = ax > 0 ? 1 : -1;
    if (Math.abs(ay) > MENU_STICK_THRESHOLD) dy = ay > 0 ? 2 : -2;
    if (dx !== 0) return dx as MenuDir;
    if (dy !== 0) return dy as MenuDir;
    return 0;
  }

  /** The pad we drive: our indexed pad while it stays connected. */
  private activePad(): Gamepad | null {
    if (typeof navigator.getGamepads !== "function") return null;
    if (this.padIndex === null) return null;
    const pad = navigator.getGamepads()[this.padIndex];
    if (pad && pad.connected) return pad;
    // Vanished mid-race — stay padless until a connect/disconnect event
    // triggers a fresh probe.
    this.padIndex = null;
    return null;
  }

  private fireHeld(): boolean {
    return (
      held(this.buttons, 2) || // X
      held(this.buttons, 5) || // RB
      valueOver(this.buttons, 7, TRIGGER_THRESHOLD)
    );
  }

  /**
   * Pick the driving pad: prefer the first standard-mapped pad, else fall back
   * to the first connected one. Also syncs `connected`.
   */
  private probe(): void {
    if (typeof navigator.getGamepads !== "function") return;
    const pads = navigator.getGamepads();
    let fallback: Gamepad | null = null;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      if (pad.mapping === "standard") {
        this.padIndex = pad.index;
        this.connected = true;
        return;
      }
      if (fallback === null) fallback = pad;
    }
    if (fallback) {
      this.padIndex = fallback.index;
    } else {
      this.padIndex = null;
    }
    this.connected = fallback !== null;
  }

  private readonly onConnected = (): void => {
    this.probe();
    this.onConnect?.();
  };

  private readonly onDisconnected = (): void => {
    this.probe();
    this.onDisconnect?.();
  };
}

// --- Helpers ------------------------------------------------------------------

/** Digital button held? */
function held(buttons: readonly GamepadButton[], i: number): boolean {
  return buttons[i]?.pressed ?? false;
}

/** Analog button past a threshold (covers trigger-as-button browsers). */
function valueOver(
  buttons: readonly GamepadButton[],
  i: number,
  t: number,
): boolean {
  return (buttons[i]?.value ?? 0) > t;
}

/** Axis past a threshold in either direction (trigger-as-axis browsers). */
function axisOver(axes: readonly number[], i: number, t: number): boolean {
  const v = axes[i] ?? 0;
  // Standard mapping rests triggers at -1 when exposed as axes.
  return Math.abs(v) > t && Math.sign(v) > 0;
}

/**
 * Deadzone + curved steering response. The zone is re-centered first
 * (0 → deadzone edge maps smoothly onto 0 → full output) so there's no jump
 * crossing the deadzone boundary, then a power curve softens the center for
 * fine control while keeping full lock at the extremes.
 */
function curveSteer(x: number): number {
  const mag = Math.abs(x);
  if (mag < DEADZONE) return 0;
  const normalized = (mag - DEADZONE) / (1 - DEADZONE);
  return Math.sign(x) * Math.pow(normalized, STEER_CURVE);
}

function dirAction(dir: -2 | -1 | 1 | 2): GamepadMenuAction {
  switch (dir) {
    case -1:
      return "left";
    case 1:
      return "right";
    case -2:
      return "up";
    case 2:
      return "down";
  }
}
