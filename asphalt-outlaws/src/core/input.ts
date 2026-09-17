// Keyboard input: held-state snapshots for the sim plus edge-triggered
// actions for the UI. The sim must never read the DOM directly.

export interface InputState {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  attackL: boolean;
  attackR: boolean;
}

export type UiAction =
  | "confirm"
  | "back"
  | "pause"
  | "mute"
  | "menu-left"
  | "menu-right";

const HELD_KEYS: Record<string, keyof InputState> = {
  ArrowUp: "throttle",
  KeyW: "throttle",
  ArrowDown: "brake",
  KeyS: "brake",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  KeyJ: "attackL",
  KeyZ: "attackL",
  KeyK: "attackR",
  KeyX: "attackR",
};

const ACTION_KEYS: Record<string, UiAction> = {
  Enter: "confirm",
  NumpadEnter: "confirm",
  Space: "confirm",
  Escape: "back",
  Backspace: "back",
  KeyP: "pause",
  KeyM: "mute",
};

export class InputManager {
  private held: InputState = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    attackL: false,
    attackR: false,
  };
  private pressedActions = new Set<UiAction>();
  private keyDown: (e: KeyboardEvent) => void;
  private keyUp: (e: KeyboardEvent) => void;
  private attached = false;

  // Prevent arrow/space scrolling while playing.
  private swallow = (e: KeyboardEvent): void => {
    if (
      e.code in HELD_KEYS ||
      e.code === "Space" ||
      e.code.startsWith("Arrow")
    ) {
      e.preventDefault();
    }
  };

  constructor() {
    this.keyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const held = HELD_KEYS[e.code];
      if (held) this.held[held] = true;
      const action = ACTION_KEYS[e.code];
      if (action) this.pressedActions.add(action);
      // Menu steering via the same keys used to ride.
      if (e.code === "ArrowLeft" || e.code === "KeyA")
        this.pressedActions.add("menu-left");
      if (e.code === "ArrowRight" || e.code === "KeyD")
        this.pressedActions.add("menu-right");
    };
    this.keyUp = (e: KeyboardEvent) => {
      const held = HELD_KEYS[e.code];
      if (held) this.held[held] = false;
    };
  }

  attach(target: Window = window): void {
    if (this.attached) return;
    target.addEventListener("keydown", this.keyDown, { passive: false });
    target.addEventListener("keyup", this.keyUp);
    target.addEventListener("keydown", this.swallow, { passive: false });
    this.attached = true;
  }

  detach(target: Window = window): void {
    if (!this.attached) return;
    target.removeEventListener("keydown", this.keyDown);
    target.removeEventListener("keyup", this.keyUp);
    target.removeEventListener("keydown", this.swallow);
    this.attached = false;
  }

  snapshot(): InputState {
    return { ...this.held };
  }

  /** True once per physical press, until the next consume. */
  wasPressed(action: UiAction): boolean {
    return this.pressedActions.has(action);
  }

  consumeActions(): void {
    this.pressedActions.clear();
  }

  reset(): void {
    this.held = {
      throttle: false,
      brake: false,
      left: false,
      right: false,
      attackL: false,
      attackR: false,
    };
    this.pressedActions.clear();
  }
}
