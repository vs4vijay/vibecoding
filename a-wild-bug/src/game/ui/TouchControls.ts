import { LOOP_TUNING } from "../gameplay/ForageLoop";
import type { Game } from "../Game";
import { scheme } from "./Hints";
import "./touch.css";

/**
 * Touch widget layer (design D3): a synthetic input provider feeding the
 * existing Input surface, so the controller, loop and camera stay
 * touch-agnostic.
 *
 * Widgets: left virtual joystick (walk → sprint by deflection), a JUMP +
 * context ACTION cluster bottom-right, and a pause control top-right — clear
 * of the quota plaque (top-left) and the sun track (top-center). Scene
 * gestures bind to the WebGL canvas only: a one-finger drag orbits through
 * Input.dragX/dragY, a two-finger pinch zooms in Input.wheel steps. Widgets
 * stop propagation, which is what keeps "gestures near controls still steer"
 * true — drags that start on a control never reach the canvas.
 *
 * sync() runs once per frame from Game.frame. It toggles visibility (mode
 * playing on a coarse pointer, or forceVisible for the capture scene — pausing
 * hides the layer and zeroes the joystick), mirrors game.pinned into the
 * capture kill-switch class, and refreshes the ACTION verb from the loop's own
 * pickup/throw predicates. All of it is cheap field writes; DOM is touched
 * only when the visible state actually changes.
 */

const TEMPLATE = `
  <div class="tc-stick" id="tc-stick" aria-label="Movement joystick" aria-description="Drag to move; push to the rim to sprint">
    <div class="tc-nub" id="tc-nub"></div>
  </div>
  <button class="tc-btn tc-jump" id="tc-jump" type="button" aria-label="Jump">Jump</button>
  <button class="tc-btn tc-act" id="tc-act" type="button" aria-disabled="true">
    <span id="tc-act-label">Act</span>
  </button>
  <button class="tc-pause tc-mute" id="tc-mute" type="button" aria-label="Mute all sound" aria-pressed="false">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 9.5v5h3.4L12 18.8V5.2L7.4 9.5H4Z" fill="#fff3d9" />
      <path class="snd-wave" d="M14.8 8.9a4.4 4.4 0 0 1 0 6.2" fill="none" stroke="#fff3d9" stroke-width="2.1" stroke-linecap="round" />
      <path class="snd-slash" d="M4.6 4.2 19.8 19.4" fill="none" stroke="#ff9d5c" stroke-width="2.6" stroke-linecap="round" />
    </svg>
  </button>
  <button class="tc-pause" id="tc-pause" type="button" aria-label="Pause">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 5.5v13M16 5.5v13" fill="none" stroke="#fff3d9" stroke-width="3.4" stroke-linecap="round" />
    </svg>
  </button>
`;

/** Fraction of the base radius ignored so a restful thumb never creeps. */
const STICK_DEAD = 0.12;
/** Deflection magnitude that shifts the intent from walk to sprint. */
const STICK_SPRINT = 0.85;
/** Half the base width — deflections normalize against this. */
const STICK_RADIUS = 66;
/** Nub travel clamp inside the base ring. */
const NUB_TRAVEL = 42;
/** Pinch travel (px) per wheel step — matches the mouse-wheel zoom feel. */
const PINCH_STEP = 40;

type ActionVerb = "PICK" | "THROW" | "ACT";

export class TouchControls {
  /**
   * Capture-scene/probe override: widgets visible regardless of pointer kind
   * (the `touch` ShotDirector scene sets this; unpin clears it).
   */
  forceVisible = false;
  readonly root: HTMLElement;

  private readonly coarse: MediaQueryList;
  private shown = false;

  private readonly stick: HTMLElement;
  private readonly nub: HTMLElement;
  private readonly jumpBtn: HTMLButtonElement;
  private readonly actBtn: HTMLButtonElement;
  private readonly actLabel: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;

  /** Active joystick pointer id; null = at rest. */
  private stickPointer: number | null = null;
  private stickCX = 0;
  private stickCY = 0;

  /** ACTION verb cache — DOM is touched only when the verb actually changes. */
  private verb: ActionVerb = "ACT";
  private verbReady = false;

  /** Active canvas touch pointers (scene gestures). */
  private readonly scene = new Map<number, { x: number; y: number }>();
  private pinchSpan = 0;
  private pinchAcc = 0;

  /** Pickup-predicate memo: re-query only when an input could have changed. */
  private pickX = NaN;
  private pickZ = NaN;
  private pickCarried = "";
  private pickPhase = "";
  private pickHit = false;

  constructor(private readonly game: Game) {
    this.coarse = window.matchMedia("(pointer: coarse)");

    this.root = document.createElement("div");
    this.root.id = "touch";
    this.root.hidden = true;
    this.root.innerHTML = TEMPLATE;
    document.body.appendChild(this.root);

    this.stick = must("tc-stick");
    this.nub = must("tc-nub");
    this.jumpBtn = asButton("tc-jump");
    this.actBtn = asButton("tc-act");
    this.actLabel = must("tc-act-label");

    // The WebGL canvas owns scene gestures; keep browser gestures off it.
    const canvas = game.renderer.domElement;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onSceneDown);
    canvas.addEventListener("pointermove", this.onSceneMove);
    canvas.addEventListener("pointerup", this.onSceneUp);
    canvas.addEventListener("pointercancel", this.onSceneUp);

    this.stick.addEventListener("pointerdown", this.onStickDown);
    this.stick.addEventListener("pointermove", this.onStickMove);
    this.stick.addEventListener("pointerup", this.onStickUp);
    this.stick.addEventListener("pointercancel", this.onStickUp);

    this.jumpBtn.addEventListener("pointerdown", this.onJumpDown);
    this.jumpBtn.addEventListener("pointerup", this.onJumpUp);
    this.jumpBtn.addEventListener("pointercancel", this.onJumpUp);
    this.jumpBtn.addEventListener("click", this.onJumpClick);

    this.actBtn.addEventListener("pointerdown", this.onActDown);
    this.actBtn.addEventListener("pointerup", this.onActUp);
    this.actBtn.addEventListener("pointercancel", this.onActUp);
    this.actBtn.addEventListener("click", this.onActClick);

    const pauseBtn = asButton("tc-pause");
    this.pauseBtn = pauseBtn;
    pauseBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.game.pause();
    });
    pauseBtn.addEventListener("click", () => {
      // Keyboard activation fallback (detail 0); pause() guards the mode.
      this.game.pause();
    });

    // In-run session mute (design D4): drives the MASTER gain for this session
    // only — the persisted wb.audio.music / wb.audio.sfx choices stay intact.
    this.muteBtn = asButton("tc-mute");
    this.applyMuteState();
    this.muteBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.game.audio.setMuted(!this.game.audio.muted);
      this.applyMuteState();
    });
    this.muteBtn.addEventListener("click", (e) => {
      // Keyboard activation fallback only (detail 0): pointer activation has
      // already toggled on pointerdown — a derived click would double-fire.
      if (e.detail !== 0) return;
      this.game.audio.setMuted(!this.game.audio.muted);
      this.applyMuteState();
    });
  }

  /** Mirrors the session mute into the control's pressed state + slash icon. */
  private applyMuteState(): void {
    const muted = this.game.audio.muted;
    this.muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    this.muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute all sound");
    this.muteBtn.classList.toggle("muted", muted);
  }

  /** Per-frame state pump (called from Game.frame). See class docs. */
  sync(): void {
    const g = this.game;
    // Visibility follows the same latched scheme the hint copy uses (design
    // D5): coarse-pointer boot, a latched touch interaction, or the capture
    // override — one source of truth, so HUD chips never reference buttons
    // that are not on screen.
    const show =
      g.mode === "playing" && (this.coarse.matches || this.forceVisible || scheme.get() === "touch");
    if (show !== this.shown) {
      this.shown = show;
      this.root.hidden = !show;
      if (!show) this.releaseStick(); // pausing zeroes the joystick explicitly
    }
    this.root.classList.toggle("pinned", g.pinned);
    if (show) this.syncAction();
  }

  // --- ACTION verb -------------------------------------------------------------

  /**
   * Probe seam (tools/probe-ui.mjs): CSS-px rects of every widget, read on
   * demand via evaluate — never per-frame. Widgets report their layout rects
   * even while hidden (zeros) — callers gate on #touch.hidden.
   */
  debugRects(): Record<string, { x: number; y: number; w: number; h: number }> {
    const rect = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      stick: rect(this.stick),
      jump: rect(this.jumpBtn),
      act: rect(this.actBtn),
      pause: rect(this.pauseBtn),
      mute: rect(this.muteBtn),
    };
  }

  /**
   * The loop's own pickup/throw predicates, re-derived like the loop does —
   * prompt.key fades and misses the near-hole "deliver" state while carrying,
   * so the button tracks the real conditions instead. Memoized on the state
   * that feeds the pickup query so an idle ant costs zero allocations.
   */
  private syncAction(): void {
    const g = this.game;
    let verb: ActionVerb = "ACT";
    let ready = false;
    if (g.loop.phase === "playing" && g.carried.mode === "held") {
      verb = "THROW";
      ready = true;
    } else if (g.loop.phase === "playing" && g.carried.mode === "hidden" && this.pickInReach()) {
      verb = "PICK";
      ready = true;
    }
    if (verb !== this.verb) {
      this.verb = verb;
      this.actLabel.textContent = verb;
    }
    if (ready !== this.verbReady) {
      this.verbReady = ready;
      this.actBtn.classList.toggle("ready", ready);
      this.actBtn.setAttribute("aria-disabled", ready ? "false" : "true");
    }
  }

  private pickInReach(): boolean {
    const g = this.game;
    const p = g.controller.position;
    const carried = g.carried.mode;
    const phase = g.loop.phase;
    if (p.x === this.pickX && p.z === this.pickZ && carried === this.pickCarried && phase === this.pickPhase) {
      return this.pickHit;
    }
    this.pickX = p.x;
    this.pickZ = p.z;
    this.pickCarried = carried;
    this.pickPhase = phase;
    this.pickHit = g.meadow.grains.pickableAt(p, LOOP_TUNING.pickupRadius) !== null;
    return this.pickHit;
  }

  // --- joystick ----------------------------------------------------------------

  private onStickDown = (e: PointerEvent): void => {
    if (this.stickPointer !== null) return;
    this.stickPointer = e.pointerId;
    const r = this.stick.getBoundingClientRect();
    this.stickCX = r.left + r.width / 2;
    this.stickCY = r.top + r.height / 2;
    try {
      this.stick.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer (probe dispatch): tracking still works via target.
    }
    e.preventDefault();
    e.stopPropagation();
    this.trackStick(e);
  };

  private onStickMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    this.trackStick(e);
  };

  private onStickUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    this.releaseStick();
  };

  private trackStick(e: PointerEvent): void {
    const dx = e.clientX - this.stickCX;
    const dy = e.clientY - this.stickCY;
    const len = Math.hypot(dx, dy);
    const mag = Math.min(len / STICK_RADIUS, 1);
    const clampLen = Math.min(len, NUB_TRAVEL);
    const nx = len > 0 ? (dx / len) * clampLen : 0;
    const ny = len > 0 ? (dy / len) * clampLen : 0;
    this.nub.style.transform = `translate(${nx}px, ${ny}px)`;
    const input = this.game.input;
    if (mag <= STICK_DEAD) {
      input.move.set(0, 0);
      input.sprint = false;
      return;
    }
    // Dead zone remaps linearly to full intent; screen up = forward.
    const t = (mag - STICK_DEAD) / (1 - STICK_DEAD);
    input.move.set((dx / len) * t, -(dy / len) * t);
    input.sprint = mag >= STICK_SPRINT;
  }

  /** Zeroes the joystick — the release path and the pause-path reset. */
  private releaseStick(): void {
    this.stickPointer = null;
    this.nub.style.transform = "";
    const input = this.game.input;
    input.move.set(0, 0);
    input.sprint = false;
  }

  // --- JUMP / ACTION buttons -----------------------------------------------------

  private onJumpDown = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.jumpBtn.classList.add("pressed");
    try {
      this.jumpBtn.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer: the up/cancel handlers still fire on the button.
    }
    this.game.input.queueJump();
  };

  private onJumpUp = (): void => {
    this.jumpBtn.classList.remove("pressed");
    this.game.input.releaseJump();
  };

  private onJumpClick = (e: MouseEvent): void => {
    if (e.detail !== 0) return; // pointer activation already handled on pointerdown
    this.game.input.queueJump();
    this.game.input.releaseJump();
  };

  private onActDown = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.actBtn.classList.add("pressed");
    try {
      this.actBtn.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer: the up/cancel handlers still fire on the button.
    }
    this.fireAction();
  };

  private onActUp = (): void => {
    this.actBtn.classList.remove("pressed");
  };

  private onActClick = (e: MouseEvent): void => {
    if (e.detail !== 0) return; // pointer activation already handled on pointerdown
    this.fireAction();
  };

  private fireAction(): void {
    if (!this.verbReady) return;
    if (this.verb === "PICK") this.game.input.queueInteract();
    else if (this.verb === "THROW") this.game.input.queueThrow();
  }

  // --- scene gestures (orbit drag + pinch zoom) ---------------------------------

  private onSceneDown = (e: PointerEvent): void => {
    if (e.pointerType !== "touch") return; // mouse/pen orbit is Input's
    if (this.game.mode !== "playing") return;
    this.scene.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      this.game.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer: moves still target the canvas in practice.
    }
    if (this.scene.size === 1) {
      this.game.input.dragging = true;
    } else if (this.scene.size === 2) {
      this.pinchSpan = this.sceneSpan();
      this.pinchAcc = 0;
    }
    e.preventDefault();
  };

  private onSceneMove = (e: PointerEvent): void => {
    const p = this.scene.get(e.pointerId);
    if (!p) return;
    if (this.scene.size === 1) {
      // movementX is 0 for touch pointers — deltas come from tracked positions.
      this.game.input.dragX += e.clientX - p.x;
      this.game.input.dragY += e.clientY - p.y;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.scene.size === 2) {
      const span = this.sceneSpan();
      this.pinchAcc += span - this.pinchSpan;
      this.pinchSpan = span;
      const input = this.game.input;
      while (Math.abs(this.pinchAcc) >= PINCH_STEP) {
        // Pinch out (span grows) zooms in — a negative wheel step (wheel + = out).
        const step = Math.sign(this.pinchAcc);
        input.wheel -= step;
        this.pinchAcc -= step * PINCH_STEP;
      }
    }
  };

  private onSceneUp = (e: PointerEvent): void => {
    if (!this.scene.delete(e.pointerId)) return;
    if (this.scene.size === 1) {
      this.pinchAcc = 0; // folded back to one finger: no stale pinch emit
    } else if (this.scene.size === 0) {
      this.game.input.dragging = false;
    }
  };

  /** Distance between the two tracked pinch pointers (size 2 only). */
  private sceneSpan(): number {
    const it = this.scene.values();
    const a = it.next();
    const b = it.next();
    if (a.done || b.done) return 0;
    return Math.hypot(a.value.x - b.value.x, a.value.y - b.value.y);
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`touch: #${id} missing from template`);
  return el;
}

function asButton(id: string): HTMLButtonElement {
  const el = must(id);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`touch: #${id} is not a button`);
  return el;
}
