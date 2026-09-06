// src/core/Input.ts
import { PHYSICS, type Action, type InputBuffer, type InputState } from "./types";

const KEY_ACTIONS: Record<string, Action> = {
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  ArrowUp: "jump", KeyW: "jump", Space: "jump",
  ControlLeft: "jetpack", ControlRight: "jetpack",
  AltLeft: "fire", AltRight: "fire", ShiftLeft: "fire", ShiftRight: "fire",
};

/** Minimal structural key event — satisfied by DOM KeyboardEvent in the browser; lets test hooks run without a DOM. */
interface KeyEventLike { code: string; preventDefault(): void; }
export class Input {
  private held: Set<Action> = new Set();
  private frames: InputBuffer = { left: 0, right: 0, jump: 0, jetpack: 0, fire: 0 };
  private fireQueued = false;
  private attached = false;
  private onKeyDown = (e: KeyEventLike) => {
    const action = KEY_ACTIONS[e.code];
    if (action) {
      if (!this.held.has(action)) {
        this.held.add(action);
        this.frames[action] = 0;
        if (action === "fire") this.fireQueued = true;
      }
      e.preventDefault();
    }
  };
  private onKeyUp = (e: KeyEventLike) => {
    const action = KEY_ACTIONS[e.code];
    if (action) { this.held.delete(action); e.preventDefault(); }
  };

  attach(target: Window): void {
    if (this.attached) return;
    this.attached = true;
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
  }
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.held.clear();
    this.frames = { left: 0, right: 0, jump: 0, jetpack: 0, fire: 0 };
    this.fireQueued = false;
  }

  /** called once per physics tick after read() */
  tick(): void {
    for (const a of Object.keys(this.frames) as Action[]) {
      if (this.held.has(a)) this.frames[a]++;
      else this.frames[a] = 0;
    }
  }

  read(): InputState {
    const s: InputState = {
      left: this.held.has("left"),
      right: this.held.has("right"),
      jump: this.held.has("jump"),
      jetpack: this.held.has("jetpack"),
      fire: this.fireQueued,
    };
    this.fireQueued = false;
    return s;
  }

  holdFrames(): InputBuffer {
    return { ...this.frames };
  }

  /** test-only hooks */
  keyDown(code: string): void { this.onKeyDown({ code, preventDefault() {} }); }
  keyUp(code: string): void { this.onKeyUp({ code, preventDefault() {} }); }

  static readonly LOGICAL_TICK = PHYSICS.TILE; // 16px/tile — informational anchor
}
