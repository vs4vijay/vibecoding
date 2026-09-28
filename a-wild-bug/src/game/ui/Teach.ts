import { LOOP_TUNING, type ForageLoop } from "../gameplay/ForageLoop";
import { SPRING_SEED_ANCHORS } from "../gameplay/SpringSeeds";
import type { CarriedGrain } from "../gameplay/CarriedGrain";
import type { GrainField } from "../gameplay/GrainField";
import type { PlayerController } from "../player/PlayerController";
import { HINTS, scheme, type TeachHintId } from "./Hints";

/**
 * First-day teaching hints (onboarding spec, tasks 7.1/7.2): on a brand-new
 * save, the very first day presents one non-blocking hint per core verb —
 * move at day start, pickup near a grain node, throw while carrying, jump
 * near a spring seed — each self-dismissing after a few seconds or on the
 * verb's first successful use, never repeating within or across days.
 *
 * Persistence (task 7.1): the tiny self-describing `wb.taught` key is written
 * ONLY when a day actually begins (Game's one beginDay seam calls beginDay();
 * boot and title visits never do). Reading it at boot decides whether the
 * teaching run happens at all: fresh save → armed, so the first day-start
 * consumes the run (restarts and later days never re-teach, matching "exactly
 * once per player across sessions").
 *
 * Determinism: ticks come from Game.stepFixed (fixed-step sim only), so hints
 * freeze with the sim under pause/menus and never run while pinned (captures
 * never step the sim). Rendering reads `display` — one reused object, resolved
 * to scheme copy by the HUD at draw time. No allocation in tick: the pickup
 * query is memoized on the state that feeds it (the TouchControls pattern).
 *
 * Probes/captures: `debug()` snapshots state read-only, `forceShow()` stages a
 * hint for eyes-on captures, `reset()` re-arms between harness scenarios.
 */

const TEACH_TUNING = {
  /** Day-seconds before the move hint fires (the dawn beat plays first). */
  moveDelay: 1.2,
  /** planarSpeed above which the ant counts as "moving" (walk ≈ 1.55). */
  moveSpeed: 0.3,
  /** Cumulative moving seconds that dismiss the move hint. */
  moveUseTime: 0.5,
  /** Distance to a spring-seed anchor that arms the jump hint. */
  seedRadius: 2.1,
  /** Hint fade-in seconds (fixed-step clock). */
  fadeIn: 0.3,
  /** Fade-out tail after use/timeout (fixed-step clock). */
  fadeOut: 0.35,
} as const;

/** How long each hint holds before timing out (plus the fade-out tail). */
const HINT_TIMEOUT: Record<TeachHintId, number> = { move: 6, pickup: 8, throw: 8, jump: 8 };

/** Trigger priority = natural gameplay order; one hint up at a time. */
const HINT_ORDER: TeachHintId[] = ["move", "pickup", "throw", "jump"];

const TAUGHT_KEY = "wb.taught";

/** True when the save already marked teaching done (private-mode safe). */
function readTaught(): boolean {
  try {
    return window.localStorage.getItem(TAUGHT_KEY) !== null;
  } catch {
    return false;
  }
}

/** Marks the save taught (idempotent; private-mode safe — hints stay session-only). */
function writeTaught(): void {
  try {
    window.localStorage.setItem(TAUGHT_KEY, JSON.stringify({ day: true }));
  } catch {
    // Storage unavailable (private mode): the teaching still runs this session.
  }
}

export interface TeachContext {
  controller: PlayerController;
  grains: GrainField;
  carried: CarriedGrain;
  loop: ForageLoop;
}

interface HintState {
  phase: "idle" | "shown" | "done";
  /** Seconds in the current phase (fixed-step clock). */
  t: number;
}

export interface TeachDebug {
  /** The boot-time run is still unconsumed (fresh save, no day started). */
  armed: boolean;
  /** This day is the teaching day. */
  active: boolean;
  /** The hint currently on screen (fading tail included), if any. */
  shown: TeachHintId | null;
  /** Per-hint phase ("idle" | "shown" | "done"). */
  hints: Record<TeachHintId, string>;
  /** The shown hint's copy for the latched scheme (null = nothing up). */
  text: string | null;
}

export class Teach {
  /** What the HUD should draw right now (one reused object; id null = hide). */
  readonly display: { id: TeachHintId | null; alpha: number } = { id: null, alpha: 0 };

  private readonly ctx: TeachContext;
  private readonly hints: Record<TeachHintId, HintState> = {
    move: { phase: "idle", t: 0 },
    pickup: { phase: "idle", t: 0 },
    throw: { phase: "idle", t: 0 },
    jump: { phase: "idle", t: 0 },
  };

  /** The boot-time teaching run: fresh save → armed exactly once. */
  private armed: boolean;
  /** The current day is the teaching day. */
  private active = false;
  /** Which hint occupies the pill (drives display + trigger gating). */
  private shownId: TeachHintId | null = null;
  /** Cumulative moving seconds while the move hint is up. */
  private moveUseT = 0;
  /** controller.jumps when the jump hint appeared (dismiss on the next one). */
  private jumpsAtShow = 0;
  /** Carrying state last tick — detects "carrying ended, throw never taught". */
  private prevHeld = false;

  // Pickup-predicate memo (re-query only when an input could have changed).
  private pickX = NaN;
  private pickZ = NaN;
  private pickY = NaN;
  private pickCarried = "";
  private pickHit = false;

  constructor(ctx: TeachContext) {
    this.ctx = ctx;
    this.armed = !readTaught();
  }

  /**
   * A day actually began (Game's one beginDay seam: title start or restart).
   * Consumes the boot-time run on the first call, resets the per-day state,
   * and persists the flag — a title visit or quit-to-title never lands here.
   */
  beginDay(): void {
    this.active = this.armed;
    this.armed = false;
    this.shownId = null;
    this.moveUseT = 0;
    this.prevHeld = false;
    for (const id of HINT_ORDER) {
      const st = this.hints[id];
      st.phase = "idle";
      st.t = 0;
    }
    this.display.id = null;
    this.display.alpha = 0;
    writeTaught();
  }

  /**
   * One fixed sim step while mode === "playing" && loop.phase === "playing"
   * (Game gates the call). Advances the shown hint, polls the next trigger.
   */
  tick(dt: number): void {
    if (!this.active) return;
    const c = this.ctx;

    // Advance the hint on screen (its fade tail keeps the pill occupied).
    if (this.shownId) {
      const st = this.hints[this.shownId];
      st.t += dt;
      if (st.phase === "shown") this.checkUse(this.shownId, dt);
      if (st.t >= HINT_TIMEOUT[this.shownId] + TEACH_TUNING.fadeOut) {
        st.phase = "done";
        st.t = 0;
        this.shownId = null;
      }
    }

    // Triggers fire in gameplay order while the pill is free; each shows once.
    if (!this.shownId) {
      for (const id of HINT_ORDER) {
        if (this.hints[id].phase !== "idle") continue;
        if (this.trigger(id)) {
          const st = this.hints[id];
          st.phase = "shown";
          st.t = 0;
          this.shownId = id;
          if (id === "jump") this.jumpsAtShow = c.controller.jumps;
          break;
        }
      }
    }

    // Carrying ended while the throw hint never fired: skip it for the day
    // (a delivered/stolen grain already carried the lesson past its moment).
    const held = c.carried.mode === "held";
    if (this.prevHeld && !held && this.hints.throw.phase === "idle") {
      this.hints.throw.phase = "done";
    }
    this.prevHeld = held;

    this.syncDisplay();
  }

  // --- probe / harness seams -------------------------------------------------

  /** Read-only state snapshot for tools/probe-ui.mjs. */
  debug(): TeachDebug {
    const hints = {} as Record<TeachHintId, string>;
    for (const id of HINT_ORDER) hints[id] = this.hints[id].phase;
    return {
      armed: this.armed,
      active: this.active,
      shown: this.shownId,
      hints,
      text: this.shownId ? HINTS.teach[this.shownId][scheme.get()] : null,
    };
  }

  /** Capture seam: stages one hint immediately (eyes-on captures, scenarios). */
  forceShow(id: TeachHintId): void {
    // Staging retires whatever was up so the pill never has two tenants.
    if (this.shownId && this.shownId !== id) this.hints[this.shownId].phase = "done";
    const st = this.hints[id];
    st.phase = "shown";
    st.t = 0;
    this.shownId = id;
    if (id === "jump") this.jumpsAtShow = this.ctx.controller.jumps;
    this.display.id = id;
    this.display.alpha = 1;
  }

  /** Harness seam: clear the teaching day; `{ disabled: true }` also disarms. */
  reset(opts: { disabled?: boolean } = {}): void {
    this.active = false;
    this.shownId = null;
    this.moveUseT = 0;
    this.prevHeld = false;
    for (const id of HINT_ORDER) {
      const st = this.hints[id];
      st.phase = "idle";
      st.t = 0;
    }
    this.display.id = null;
    this.display.alpha = 0;
    if (opts.disabled !== undefined) this.armed = !opts.disabled;
  }

  // --- internals ---------------------------------------------------------------

  /** Trigger predicate per verb (cheap, allocation-free). */
  private trigger(id: TeachHintId): boolean {
    const c = this.ctx;
    switch (id) {
      case "move":
        return c.loop.dayElapsed >= TEACH_TUNING.moveDelay;
      case "pickup":
        return this.pickInReach();
      case "throw":
        return c.carried.mode === "held";
      case "jump": {
        const p = c.controller.position;
        const r2 = TEACH_TUNING.seedRadius * TEACH_TUNING.seedRadius;
        for (const a of SPRING_SEED_ANCHORS) {
          const dx = p.x - a[0];
          const dz = p.z - a[1];
          if (dx * dx + dz * dz < r2) return true;
        }
        return false;
      }
    }
  }

  /** Use-dismissal: the verb's first success while its hint is up. */
  private checkUse(id: TeachHintId, dt: number): void {
    const c = this.ctx;
    switch (id) {
      case "move":
        if (c.controller.planarSpeed > TEACH_TUNING.moveSpeed) this.moveUseT += dt;
        if (this.moveUseT >= TEACH_TUNING.moveUseTime) this.finish(id);
        break;
      case "pickup":
        if (c.carried.mode === "held") this.finish(id);
        break;
      case "throw":
        // Any end of carrying counts (throw, delivery, a snatch).
        if (c.carried.mode !== "held") this.finish(id);
        break;
      case "jump":
        if (c.controller.jumps > this.jumpsAtShow) this.finish(id);
        break;
    }
  }

  /** Done + graceful fade-out tail (the pill stays up until it finishes). */
  private finish(id: TeachHintId): void {
    const st = this.hints[id];
    st.phase = "done";
    st.t = Math.max(st.t, HINT_TIMEOUT[id]);
  }

  /** Memoized pickup-predicate (the loop's own radius; TouchControls pattern). */
  private pickInReach(): boolean {
    const c = this.ctx;
    const p = c.controller.position;
    const carried = c.carried.mode;
    if (p.x === this.pickX && p.z === this.pickZ && p.y === this.pickY && carried === this.pickCarried) {
      return this.pickHit;
    }
    this.pickX = p.x;
    this.pickZ = p.z;
    this.pickY = p.y;
    this.pickCarried = carried;
    this.pickHit = c.grains.pickableAt(p, LOOP_TUNING.pickupRadius) !== null;
    return this.pickHit;
  }

  /** Pushes the shown hint's fade state into the display object (no alloc). */
  private syncDisplay(): void {
    if (!this.shownId) {
      this.display.id = null;
      this.display.alpha = 0;
      return;
    }
    const st = this.hints[this.shownId];
    const aIn = Math.min(1, st.t / TEACH_TUNING.fadeIn);
    const aOut = Math.min(1, (HINT_TIMEOUT[this.shownId] + TEACH_TUNING.fadeOut - st.t) / TEACH_TUNING.fadeOut);
    this.display.id = this.shownId;
    this.display.alpha = Math.max(0, Math.min(aIn, aOut));
  }
}
