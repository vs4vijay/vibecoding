/**
 * Scheme-aware hint copy (design D5): one lookup table with `key` and `touch`
 * variants for every static control string, plus a small latched scheme
 * detector — the single source of truth for which variant the UI shows.
 *
 * Boot detection is `(pointer: coarse)`; after that the latch follows the last
 * real interaction: a `pointerdown` with pointerType "touch" latches touch,
 * "mouse"/"pen" latches key (window capture listener, observation only — no
 * preventDefault, no interference with Input or the touch widgets). Consumers
 * poll `scheme.get()` (Shell.sync runs per frame and dirty-checks it, Hud
 * reads it with its canvas), so a correction lands on the next screen or
 * frame that shows hints.
 */

/** The two input schemes hints can address. */
export type Scheme = "key" | "touch";

/** One control string in both schemes. */
export interface HintCopy {
  key: string;
  touch: string;
}

/** One row of the how-to control listing (chip label + description). */
export interface HowtoRow {
  label: string;
  text: string;
}

/** The four first-day teaching verbs (HINTS.teach keys, onboarding spec). */
export type TeachHintId = keyof (typeof HINTS)["teach"];

/**
 * The copy table. Every static control string the UI shows lives here — add
 * new control hints here, never inline. Touch variants never name keyboard
 * keys; key variants never say tap/swipe/stick, so no line mixes schemes.
 */
export const HINTS = {
  /** Title screen bottom hint. */
  titleHint: {
    key: "Enter start · H how to play",
    touch: "Tap Start to forage",
  },
  /** Pause panel hint line. */
  pauseHint: {
    key: "Esc / P resume",
    touch: "Tap Resume to continue",
  },
  /** Resume-grace skip chip label (the countdown number sits above it). */
  graceChip: {
    key: "Resuming…",
    touch: "Tap to resume",
  },
  /**
   * The persistent in-run controls line (Hud bottom-left). Empty touch
   * variant = don't draw the line at all: the on-screen widgets already say
   * it, and the line would sit in the joystick zone.
   */
  controlsLine: {
    key: "WASD move · Shift sprint · Space jump · E pick up · F throw · Q/E + drag orbit",
    touch: "",
  },
  /**
   * In-run prompt affordance labels, keyed by the loop's scheme-agnostic
   * prompt key ("E" pickup / "F" throw): the keycap letter on keyboard, the
   * matching ACTION-button verb on touch (labels mirror TouchControls' verbs
   * so the chip reads as "press that button").
   */
  promptAffordance: {
    E: { key: "E", touch: "PICK" },
    F: { key: "F", touch: "THROW" },
  } as Record<string, HintCopy>,
  /**
   * First-day teaching hints (onboarding spec): one per core verb, fired in
   * gameplay order by Teach.ts. Key variants name keyboard controls, touch
   * variants name the on-screen widgets — no scheme mixing (design D5).
   */
  teach: {
    move: { key: "WASD / arrows to move", touch: "Drag the left stick to move" },
    pickup: { key: "Walk close and press E", touch: "Get close, tap PICK" },
    throw: { key: "Press F to throw", touch: "Tap THROW to fling it" },
    jump: { key: "Space to jump", touch: "Tap JUMP to hop" },
  },
  /** How-to control listing (Shell rebuilds the rows when the scheme flips). */
  howtoControls: {
    key: [
      { label: "WASD / ←↑↓→", text: "move" },
      { label: "Shift", text: "sprint" },
      { label: "Space", text: "jump" },
      { label: "E", text: "pick up" },
      { label: "F", text: "throw" },
      { label: "Q / E + drag", text: "orbit camera" },
      { label: "Wheel", text: "zoom" },
      { label: "Esc", text: "pause" },
    ] as HowtoRow[],
    touch: [
      { label: "Left stick", text: "move · push far to sprint" },
      { label: "Drag", text: "orbit the camera" },
      { label: "Pinch", text: "zoom" },
      { label: "ACTION", text: "pick up / throw" },
      { label: "JUMP", text: "jump" },
      { label: "⏸", text: "pause" },
    ] as HowtoRow[],
  },
};

/**
 * The latched scheme detector (design D3/D5): coarse-pointer at boot, then
 * corrected by the pointerType of observed interactions. One instance is
 * imported by Shell (copy), Hud (affordances), TouchControls (widget
 * visibility) and Game (passes it into the HUD render inputs).
 */
class SchemeDetector {
  /** The scheme detected at boot (reset() target for capture staging). */
  readonly boot: Scheme;

  private current: Scheme;
  private readonly listeners: Array<(s: Scheme) => void> = [];

  constructor() {
    this.boot = window.matchMedia("(pointer: coarse)").matches ? "touch" : "key";
    this.current = this.boot;
    window.addEventListener("pointerdown", this.onPointerDown, { capture: true });
  }

  get(): Scheme {
    return this.current;
  }

  /** Subscribe to latch flips (rare — used for screen-level copy swaps). */
  onChange(fn: (s: Scheme) => void): void {
    this.listeners.push(fn);
  }

  /** Staging seam (ShotDirector's touch scene): force the latch explicitly. */
  set(s: Scheme): void {
    this.apply(s);
  }

  /** Back to the boot-detected scheme (ShotDirector.unpin). */
  reset(): void {
    this.apply(this.boot);
  }

  private apply(s: Scheme): void {
    if (s === this.current) return;
    this.current = s;
    for (const fn of this.listeners) fn(s);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "touch") this.apply("touch");
    else if (e.pointerType === "mouse" || e.pointerType === "pen") this.apply("key");
  };
}

/** The shared detector instance — the game's one latched input scheme. */
export const scheme = new SchemeDetector();
