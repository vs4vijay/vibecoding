import * as THREE from "three";

/**
 * Keyboard + pointer input. Edge-triggered actions (jump) are queued and
 * consumed by the controller; per-frame deltas (mouse orbit, wheel) accumulate
 * and are consumed by the follow camera.
 *
 * Touch never lands here directly: the touch widget layer (design D3) feeds
 * the same surface through the queue* / release* methods and writes move /
 * sprint / drag / wheel itself. This class stays mouse + keyboard only.
 */
export class Input {
  /** Camera-relative move intent; x = strafe right, y = forward. */
  readonly move = new THREE.Vector2();
  sprint = false;
  /** Manual orbit rate: +1 orbits left (Q), -1 orbits right (E); the shared
   * manual-yaw accumulator rotates the view toward screen-right when negative. */
  yawKey = 0;
  /** Accumulated mouse-drag orbit, consumed each frame. */
  dragX = 0;
  dragY = 0;
  /** Accumulated wheel steps, consumed each frame. */
  wheel = 0;
  dragging = false;

  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private jumpHeldState = false;
  private interactQueued = false;
  private throwQueued = false;
  private confirmQueued = false;
  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private readonly dom: HTMLElement;

  /** Pause-request seam (design D3): Esc/P land here; Game wires pause(). */
  onPauseRequested: (() => void) | null = null;

  constructor(dom: HTMLElement) {
    this.dom = dom;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    dom.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    dom.addEventListener("wheel", this.onWheel, { passive: false });
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.dom.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.dom.removeEventListener("wheel", this.onWheel);
  }

  /** True once per physical Space press (jump buffer is the controller's job). */
  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  /** True once per E press (pickup). E still orbits the camera while held. */
  consumeInteract(): boolean {
    const v = this.interactQueued;
    this.interactQueued = false;
    return v;
  }

  /** True once per F press (throw). */
  consumeThrow(): boolean {
    const v = this.throwQueued;
    this.throwQueued = false;
    return v;
  }

  /** True once per Enter press or quick click (restart on win/lose). */
  consumeConfirm(): boolean {
    const v = this.confirmQueued;
    this.confirmQueued = false;
    return v;
  }

  get jumpHeld(): boolean {
    return this.jumpHeldState;
  }

  // --- touch-provider seams (design D3) --------------------------------------
  // The same queues the keyboard feeds; additive only so the widget layer can
  // press the exact buttons a key press would.

  /** Jump press from the touch layer (mirrors a Space keydown). */
  queueJump(): void {
    this.jumpQueued = true;
    this.jumpHeldState = true;
  }

  /** Jump release from the touch layer (mirrors a Space keyup; enables jump-cut). */
  releaseJump(): void {
    this.jumpHeldState = false;
  }

  /** Pickup press from the touch layer (mirrors an E press). */
  queueInteract(): void {
    this.interactQueued = true;
  }

  /** Throw press from the touch layer (mirrors an F press). */
  queueThrow(): void {
    this.throwQueued = true;
  }

  consumeDrag(out: THREE.Vector2): void {
    out.set(this.dragX, this.dragY);
    this.dragX = 0;
    this.dragY = 0;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  private readonly moveKeys: Record<string, [number, number]> = {
    KeyW: [0, 1],
    ArrowUp: [0, 1],
    KeyS: [0, -1],
    ArrowDown: [0, -1],
    KeyA: [-1, 0],
    ArrowLeft: [-1, 0],
    KeyD: [1, 0],
    ArrowRight: [1, 0],
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    // A focused shell control owns Space: the key must activate the button
    // (click on keyup), not queue a jump — preventDefault would kill that.
    if (
      e.code === "Space" &&
      e.target instanceof HTMLElement &&
      e.target.closest("#shell button")
    ) {
      return;
    }
    if (e.code === "Space" && !e.repeat) {
      this.jumpQueued = true;
      this.jumpHeldState = true;
      e.preventDefault();
    }
    if (e.code.startsWith("Arrow")) e.preventDefault();
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.sprint = true;
    // Q orbits left, E orbits right — matching mouse-drag (drag right looks
    // right). The manual-yaw sign is shared, so the keys carry opposite values.
    if (e.code === "KeyQ") this.yawKey = 1;
    if (e.code === "KeyE") {
      this.yawKey = -1;
      if (!e.repeat) this.interactQueued = true;
    }
    if (e.code === "KeyF" && !e.repeat) this.throwQueued = true;
    if (e.code === "Enter" && !e.repeat) this.confirmQueued = true;
    // New mandatory pause binding (task 4.4): the Game-side handler guards on
    // mode, so firing while paused/menus is a no-op — no double-toggle with
    // the shell's own Esc/P handling.
    if ((e.code === "Escape" || e.code === "KeyP") && !e.repeat) this.onPauseRequested?.();
    this.keys.add(e.code);
    this.updateMove();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Space") this.jumpHeldState = false;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.sprint = false;
    if (e.code === "KeyQ" || e.code === "KeyE") this.yawKey = 0;
    this.keys.delete(e.code);
    this.updateMove();
  };

  private updateMove(): void {
    this.move.set(0, 0);
    for (const code of this.keys) {
      const k = this.moveKeys[code];
      if (k) {
        this.move.x += k[0];
        this.move.y += k[1];
      }
    }
    if (this.move.lengthSq() > 1) this.move.normalize();
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return; // scene gestures are TouchControls' (design D3)
    if (e.button !== 0 && e.button !== 2) return;
    this.dragging = true;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downTime = performance.now();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return; // never double-count the touch drag
    if (!this.dragging) return;
    this.dragX += e.movementX;
    this.dragY += e.movementY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return; // touch tap must not confirm; TouchControls owns the lifecycle
    // A quick tap (no drag) confirms dialogs — restart on the win/lose screens.
    if (this.dragging) {
      const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
      if (moved < 6 && performance.now() - this.downTime < 350) this.confirmQueued = true;
    }
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  };
}
