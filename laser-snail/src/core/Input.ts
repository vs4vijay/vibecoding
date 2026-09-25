/**
 * Keyboard + pointer input for desktop play.
 *
 * Lateral steering is polled (`lateral` is a continuous -1..1 axis), while
 * confirmation (Enter / click) is edge-triggered and consumed once — the
 * GameState machine uses it to start runs without re-triggering every frame.
 * Menu navigation (Phase 5 level select) is edge-triggered the same way:
 * up/down (+ left/right) rows move the cursor, Backspace is a "back" edge.
 */

/** Steer axis source, so systems can take any input implementation. */
export interface LateralInput {
  /** -1 = steer left, +1 = steer right, 0 = centered. */
  readonly lateral: number;
}

const LEFT_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS: ReadonlySet<string> = new Set(['ArrowRight', 'KeyD']);
/** Keys we swallow so the page never scrolls mid-race. */
const PREVENT_DEFAULT_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
  'Backspace',
]);
const CONFIRM_KEYS: ReadonlySet<string> = new Set(['Enter', 'NumpadEnter']);
const PAUSE_KEYS: ReadonlySet<string> = new Set(['Escape']);
const MUTE_KEYS: ReadonlySet<string> = new Set(['KeyM']);
/** Fire: Z or Space — polled (autofire while held), gated by weapon cooldown. */
const FIRE_KEYS: ReadonlySet<string> = new Set(['KeyZ', 'Space']);
/** Menu cursor: up/left = previous row, down/right = next row. */
const NAV_UP_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'KeyW', 'ArrowLeft']);
const NAV_DOWN_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'KeyS', 'ArrowRight']);
/** Back out of a submenu (level select → menu). */
const BACK_KEYS: ReadonlySet<string> = new Set(['Backspace']);

type KeyTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export class Input implements LateralInput {
  private readonly target: KeyTarget;
  private readonly pressedKeys = new Set<string>();
  private confirmQueued = false;
  private pauseQueued = false;
  private muteQueued = false;
  private backQueued = false;
  /** Net menu-cursor steps queued since the last consume (-1 up / +1 down). */
  private navigateQueued = 0;
  private readonly onKeyDown = (event: Event): void => {
    const keyEvent = event as KeyboardEvent;
    if (PREVENT_DEFAULT_KEYS.has(keyEvent.code)) keyEvent.preventDefault();
    if (keyEvent.repeat) return;
    this.pressedKeys.add(keyEvent.code);
    if (CONFIRM_KEYS.has(keyEvent.code)) this.confirmQueued = true;
    if (PAUSE_KEYS.has(keyEvent.code)) this.pauseQueued = true;
    if (MUTE_KEYS.has(keyEvent.code)) this.muteQueued = true;
    if (BACK_KEYS.has(keyEvent.code)) this.backQueued = true;
    if (NAV_UP_KEYS.has(keyEvent.code)) this.navigateQueued -= 1;
    else if (NAV_DOWN_KEYS.has(keyEvent.code)) this.navigateQueued += 1;
  };
  private readonly onKeyUp = (event: Event): void => {
    this.pressedKeys.delete((event as KeyboardEvent).code);
  };
  private readonly onPointerDown = (): void => {
    this.confirmQueued = true;
  };

  public constructor(target: KeyTarget = window) {
    this.target = target;
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('pointerdown', this.onPointerDown);
  }

  /** Steering axis: -1 (left) .. +1 (right). Both directions held = 0. */
  public get lateral(): number {
    let axis = 0;
    for (const code of this.pressedKeys) {
      if (LEFT_KEYS.has(code)) axis -= 1;
      else if (RIGHT_KEYS.has(code)) axis += 1;
    }
    return Math.max(-1, Math.min(1, axis));
  }

  /** True while Z or Space is held — the cannon autofires on its cooldown. */
  public get isFireHeld(): boolean {
    for (const code of this.pressedKeys) {
      if (FIRE_KEYS.has(code)) return true;
    }
    return false;
  }

  /**
   * Returns true exactly once per Enter press or pointer click. Call once per
   * simulation step from the state machine.
   */
  public consumeConfirm(): boolean {
    if (!this.confirmQueued) return false;
    this.confirmQueued = false;
    return true;
  }

  /** Returns true exactly once per Escape press (pause toggle / quit). */
  public consumePause(): boolean {
    if (!this.pauseQueued) return false;
    this.pauseQueued = false;
    return true;
  }

  /** Returns true exactly once per M press (mute toggle). */
  public consumeMute(): boolean {
    if (!this.muteQueued) return false;
    this.muteQueued = false;
    return true;
  }

  /**
   * Net menu-cursor steps queued since the last call: negative = up/left,
   * positive = down/right, 0 = nothing. Call once per simulation step from
   * the menu states (level select). Held keys do not repeat — one press is
   * one row (matches the confirm edge model).
   */
  public consumeNavigate(): number {
    const steps = this.navigateQueued;
    this.navigateQueued = 0;
    return steps;
  }

  /** Returns true exactly once per Backspace press (submenu back edge). */
  public consumeBack(): boolean {
    if (!this.backQueued) return false;
    this.backQueued = false;
    return true;
  }

  /** Detaches all listeners (for hot-reload or teardown). */
  public dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    this.releaseAll();
  }

  /**
   * Drops every held key and queued edge without firing them. Called when the
   * window loses focus: keyup events never arrive for keys released outside
   * the window, so without this Turbo would keep steering (or firing) forever
   * after an alt-tab. Queued confirm/pause edges are dropped too — focus
   * changes must never act as a button press.
   */
  public releaseAll(): void {
    this.pressedKeys.clear();
    this.confirmQueued = false;
    this.pauseQueued = false;
    this.muteQueued = false;
    this.backQueued = false;
    this.navigateQueued = 0;
  }
}
