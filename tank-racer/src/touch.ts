// Phase 8: touch controls + dynamic touch-mode detection.
//
// Touch mode turns on via `pointer: coarse` or the first touchstart, so a
// desktop flow is never affected. Controls are DOM overlay buttons driven by
// Pointer Events with per-pointer tracking (setPointerCapture per button), so
// steering and firing work simultaneously and a finger sliding off a button
// keeps the hold until it lifts. Input folds into the same TankInput shape
// the keyboard produces — physics/AI/weapons are untouched.

import type { TankInput } from "./tank";

export interface TouchCallbacks {
  /** Called once when touch mode activates (coarse pointer / first touch). */
  onEnable?: () => void;
  /**
   * Gate on the first touchstart (Phase 13): return true to refuse activation.
   * While a 2P race is running, touching the screen must not enable touch
   * controls (auto-throttle would hijack P1 mid-race) — game.ts shows the
   * toast from here. The listener re-arms so a later touch, once back in 1P,
   * can still activate touch mode.
   */
  activationBlocked?: () => boolean;
}

export class TouchInput {
  /** True once touch mode is on; game.ts gates tap-to-start on this. */
  enabled = false;

  private steerLeftPointers = new Set<number>();
  private steerRightPointers = new Set<number>();
  private firePointers = new Set<number>();
  /** Set on each FIRE press, consumed by the game loop (one shot per press). */
  private fireQueued = false;

  private readonly root: HTMLDivElement;
  private readonly btnLeft: HTMLDivElement;
  private readonly btnRight: HTMLDivElement;
  private readonly btnFire: HTMLDivElement;

  private readonly onEnable?: () => void;
  private readonly activationBlocked?: () => boolean;

  constructor(callbacks: TouchCallbacks = {}) {
    this.onEnable = callbacks.onEnable;
    this.activationBlocked = callbacks.activationBlocked;
    this.root = document.createElement("div");
    this.root.id = "touch-controls";

    this.btnLeft = makeButton("◀", "touch-steer-left");
    this.btnRight = makeButton("▶", "touch-steer-right");
    this.btnFire = makeButton("FIRE", "touch-fire");

    this.bindHold(this.btnLeft, this.steerLeftPointers);
    this.bindHold(this.btnRight, this.steerRightPointers);
    this.bindFire(this.btnFire);

    // Long-pressing FIRE must not pop the context menu
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());

    this.root.append(this.btnLeft, this.btnRight, this.btnFire);
    // Hidden until the race starts in touch mode (title/results are tappable)
    this.root.style.display = "none";
    document.body.appendChild(this.root);
  }

  /** Detection: coarse-pointer media query, else first touchstart. */
  attach(): void {
    if (window.matchMedia("(pointer: coarse)").matches) {
      this.enable();
      return;
    }
    const onFirstTouch = () => {
      if (this.activationBlocked?.()) {
        // Blocked (e.g. mid-2P race): stay in keyboard mode and listen for
        // the NEXT first touch instead of consuming the one-shot listener.
        window.addEventListener("touchstart", onFirstTouch, { once: true });
        return;
      }
      this.enable();
      this.onEnable?.();
    };
    window.addEventListener("touchstart", onFirstTouch, { once: true });
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add("touch-mode"); // CSS nudges HUD clear of buttons
    this.onEnable?.();
  }

  /**
   * Current touch input. Auto-throttle: the tank accelerates constantly in
   * touch mode — there is no accelerate button. Steer = right − left holds.
   */
  read(): TankInput {
    if (!this.enabled) return { throttle: 0, steer: 0 };
    return {
      throttle: 1,
      steer:
        (this.steerRightPointers.size > 0 ? 1 : 0) -
        (this.steerLeftPointers.size > 0 ? 1 : 0),
    };
  }

  /** True once per FIRE press; call exactly once per frame. */
  consumeFire(): boolean {
    const f = this.fireQueued;
    this.fireQueued = false;
    return f;
  }

  /** Show/hide the button overlay (only during countdown + race). */
  setControlsVisible(visible: boolean): void {
    this.root.style.display = visible && this.enabled ? "" : "none";
  }

  dispose(): void {
    this.root.remove();
  }

  /**
   * Press-and-hold semantics with per-pointer tracking. Capture keeps events
   * flowing to the button even when the finger slides off it, so a hold ends
   * only when that pointer lifts (or the touch is cancelled by the OS).
   */
  private bindHold(el: HTMLDivElement, pointers: Set<number>): void {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pointers.add(e.pointerId);
      el.classList.add("active");
    });
    const release = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) el.classList.remove("active");
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    // Hiding the overlay (results) drops capture WITHOUT pointerup —
    // this is what clears stale holds so the next press works.
    el.addEventListener("lostpointercapture", release);
  }

  /** FIRE is one-shot per press but still tracks its own pointer set. */
  private bindFire(el: HTMLDivElement): void {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      if (this.firePointers.size === 0) this.fireQueued = true;
      this.firePointers.add(e.pointerId);
      el.classList.add("active");
    });
    const release = (e: PointerEvent): void => {
      this.firePointers.delete(e.pointerId);
      if (this.firePointers.size === 0) el.classList.remove("active");
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release); // see bindHold
  }
}

function makeButton(text: string, id: string): HTMLDivElement {
  const el = document.createElement("div");
  el.id = id;
  el.className = "touch-btn";
  el.textContent = text;
  return el;
}
