import { CONFIG } from "../config";
import type { Phase } from "../game/session";
import type { ZombieType } from "../game/difficulty";
import { nextPopupSlot } from "./popups";

/** Everything the HUD renders, gathered once per frame from the Session. */
export type HudState = {
  phase: Phase;
  score: number;
  best: number;
  distanceM: number;
  level: number;
  /** (score - req(lvl)) / (req(lvl+1) - req(lvl)), clamped 0..1. */
  levelProgress: number;
  tilt: number;
  /** (rightWeight - leftWeight) / capacityPerSide. */
  imbalance: number;
  /** Attached weight per side in capacity units (world-space; capacity is CONFIG.car.capacityPerSide per side). */
  weights: { left: number; right: number };
  mag: { left: number; right: number };
  /** 0..1 reload completion; 1 means ready. */
  reload01: { left: number; right: number };
  multiplier: number;
};

/** Imbalance severity bands for the tilt gauge, driven by CONFIG.hud. */
type GaugeSeverity = "neutral" | "warn" | "critical";

/** Screen-edge glow state: which edge (if any) is in the critical band. */
type EdgeSide = "none" | "left" | "right";

/**
 * Severity from the same net-difference metric the danger vignette and the
 * audio tiltDanger signal key on: |right − left| / capacityPerSide (the car
 * flips at |imbalance| ≥ 1, so the bands measure margin to the flip).
 */
function severityOf(imbalance: number): GaugeSeverity {
  const abs = Math.abs(imbalance);
  if (abs >= CONFIG.hud.critAt) return "critical";
  if (abs >= CONFIG.hud.warnAt) return "warn";
  return "neutral";
}

/**
 * Live in-run heads-up display: score/best, distance, level chip with
 * progress bar, tilt gauge, ammo pip rows with reload arcs, streak badge,
 * center toasts, kill-score popups, pause button and the danger vignette.
 * Builds its own DOM under `root` (#hud) once; update() is called every frame.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly distEl: HTMLElement;
  private readonly levelEl: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly gaugeCar: HTMLElement;
  private readonly gauge: HTMLElement;
  private readonly vignette: HTMLElement;
  /** Full-height glow strips hugging the screen edges (critical band). */
  private readonly edges: { left: HTMLElement; right: HTMLElement };
  private readonly pauseBtn: HTMLButtonElement;
  private readonly streakBadge: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly pips: { left: HTMLSpanElement[]; right: HTMLSpanElement[] };
  private readonly arcs: { left: HTMLElement; right: HTMLElement };
  /** Weight pip cells per SCREEN side, mounted inside the gauge flanks. */
  private readonly wPips: { left: HTMLSpanElement[]; right: HTMLSpanElement[] };
  /** Preallocated kill-score popup slots, round-robin reused. */
  private readonly popups: HTMLElement[] = [];
  /** Monotonic spawn counter; drives nextPopupSlot() wrap-around. */
  private popupCursor = 0;
  private readonly pauseCbs = new Set<() => void>();

  private last = {
    score: -1,
    best: -1,
    dist: -1,
    level: -1,
    progress: -1,
    mult: -1,
    magL: -1,
    magR: -1,
    relL: true,
    relR: true,
    sev: "neutral" as GaugeSeverity,
    edge: "none" as EdgeSide,
    wL: -1,
    wR: -1,
    phase: "" as Phase | "",
  };

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = "";

    // Center toasts live OUTSIDE #hud: game-over fires hud.toast("NEW
    // BEST!") then hud.hide(), and display:none must not eat the toast.
    this.toasts = el("div", "toasts");
    document.body.append(this.toasts);

    this.vignette = el("div", "vignette");
    // Edge glow strips: mounted before every readout so HUD text paints
    // above them, and left at z-index auto so they also sit under the
    // coach (z 5), menu card (z 10) and body-level toasts (z 20).
    this.edges = {
      left: el("div", "danger-edge left"),
      right: el("div", "danger-edge right"),
    };
    const topLeft = el("div", "hud-topleft");
    this.distEl = el("div", "hud-dist");
    topLeft.append(this.distEl);

    const topCenter = el("div", "hud-topcenter");
    this.scoreEl = el("div", "hud-score");
    this.bestEl = el("div", "hud-best");
    this.gauge = el("div", "tilt-gauge");
    // Three-column grid: flank | silhouette | flank. The flanks now hold the
    // per-side weight pips (one cell per capacity unit, brute = 2 units);
    // fixed-size cells keep the centered silhouette from shifting.
    const gaugeFlankL = el("div", "tilt-flank tilt-flank-left");
    const gaugeFlankR = el("div", "tilt-flank tilt-flank-right");
    const mkWeightPips = (flank: HTMLElement): HTMLSpanElement[] => {
      const cells: HTMLSpanElement[] = [];
      for (let i = 0; i < CONFIG.car.capacityPerSide; i++) {
        const cell = document.createElement("span");
        cell.className = "wpip";
        flank.append(cell);
        cells.push(cell);
      }
      return cells;
    };
    this.wPips = {
      // Keys are SCREEN sides (same as this.pips): `.tilt-flank-left` is the
      // flank the player sees on the left of the gauge.
      left: mkWeightPips(gaugeFlankL),
      right: mkWeightPips(gaugeFlankR),
    };
    this.gaugeCar = el("div", "tilt-car");
    this.gauge.append(gaugeFlankL, this.gaugeCar, gaugeFlankR);
    topCenter.append(this.scoreEl, this.bestEl, this.gauge);

    const topRight = el("div", "hud-topright");
    this.pauseBtn = document.createElement("button");
    this.pauseBtn.id = "btn-pause";
    this.pauseBtn.textContent = "⏸";
    this.pauseBtn.setAttribute("aria-label", "Pause");
    this.pauseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      for (const cb of this.pauseCbs) cb();
    });
    const chipRow = el("div", "hud-levelchip");
    this.levelEl = el("span", "hud-level");
    const lvLabel = el("span");
    lvLabel.textContent = "LV ";
    chipRow.append(lvLabel, this.levelEl);
    const bar = el("div", "level-progress");
    this.progressFill = el("div", "level-progress-fill");
    bar.append(this.progressFill);
    topRight.append(this.pauseBtn, chipRow, bar);

    const mkAmmo = (
      side: "left" | "right",
    ): { row: HTMLElement; pips: HTMLSpanElement[]; arc: HTMLElement } => {
      const row = el("div", `ammo-row ammo-${side}`);
      const pips: HTMLSpanElement[] = [];
      for (let i = 0; i < CONFIG.gun.magSize; i++) {
        const pip = document.createElement("span");
        pip.className = "pip";
        row.append(pip);
        pips.push(pip);
      }
      const arc = el("span", "reload-arc");
      row.append(arc);
      return { row, pips, arc };
    };
    const leftRow = mkAmmo("left");
    const rightRow = mkAmmo("right");
    this.pips = { left: leftRow.pips, right: rightRow.pips };
    this.arcs = { left: leftRow.arc, right: rightRow.arc };

    this.streakBadge = el("div", "streak-badge");

    const ammoLeftWrap = el("div", "ammo-left-wrap");
    const ammoRightWrap = el("div", "ammo-right-wrap");
    ammoLeftWrap.append(leftRow.row);
    ammoRightWrap.append(rightRow.row);

    this.root.append(
      this.vignette,
      this.edges.left,
      this.edges.right,
      topLeft,
      topCenter,
      topRight,
      ammoLeftWrap,
      ammoRightWrap,
      this.streakBadge,
    );

    // Kill-score popup pool: preallocated at construct, never reallocated
    // (see .score-popup / @popup-rise in style.css). Lifetime is one CSS
    // var set ONCE on the root (popups inherit it), so a spawn only writes
    // text + position — no per-kill duration strings.
    this.root.style.setProperty("--popup-life", `${CONFIG.hud.popupLifeS}s`);
    for (let i = 0; i < CONFIG.hud.popupCount; i++) {
      const d = el("div", "score-popup");
      this.root.append(d);
      this.popups.push(d);
    }
    this.hide();
  }

  /** Subscribe to pause-button presses; returns an off() handle. */
  onPause(cb: () => void): () => void {
    this.pauseCbs.add(cb);
    return () => void this.pauseCbs.delete(cb);
  }

  show(): void {
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  /** Removes the detached toast layer (call on teardown). */
  dispose(): void {
    this.toasts.remove();
  }

  /**
   * Center-screen transient message (LEVEL N / NEW BEST!). With a subtitle
   * (e.g. "RUNNERS UNLOCKED") the main text moves into a .toast-line child
   * and the subtitle renders as a second, smaller line beneath it; without
   * one the DOM is exactly the pre-subtitle text-only toast.
   */
  toast(text: string, subtitle?: string): void {
    const t = el("div", "toast");
    if (subtitle) {
      const line = el("div", "toast-line");
      line.textContent = text;
      const sub = el("div", "toast-sub");
      sub.textContent = subtitle;
      t.append(line, sub);
    } else {
      t.textContent = text;
    }
    this.toasts.append(t);
    window.setTimeout(() => t.remove(), 1200);
  }

  /**
   * Spawns a floating kill-score popup at CSS-px (x, y) — the caller
   * projects the victim's world position (worldToScreen in main.ts keeps
   * this class three.js-free). Event-driven, so the two small string
   * builds here fire per kill, not per frame. Bursts longer than
   * CONFIG.hud.popupCount recycle the oldest slot (nextPopupSlot).
   */
  popup(x: number, y: number, text: string): void {
    const slot = nextPopupSlot(this.popupCursor, this.popups.length);
    this.popupCursor++;
    const d = this.popups[slot];
    d.textContent = text;
    // Anchor via custom props: .popup-rise restates them in every keyframe
    // (the reload arc's --sweep pattern), so the animation never discards
    // the position. translate(-50%, -100%) hangs the popup above (x, y).
    d.style.setProperty("--px", `${x.toFixed(1)}px`);
    d.style.setProperty("--py", `${y.toFixed(1)}px`);
    // Class-restart idiom (same as the streak badge): force a reflow so
    // re-adding .live replays the rise/fade from 0% instead of continuing.
    d.classList.remove("live");
    void d.offsetWidth;
    d.classList.add("live");
  }

  /** Per-frame refresh; writes only what changed since last frame. */
  update(s: HudState): void {
    const L = this.last;
    if (L.phase !== s.phase) {
      L.phase = s.phase;
      // While paused this button is a touch user's ONLY resume affordance
      // (no keyboard); it must stay tappable and flip to a resume glyph.
      const paused = s.phase === "paused";
      this.pauseBtn.classList.toggle("visible", s.phase === "running" || paused);
      this.pauseBtn.textContent = paused ? "▶" : "⏸";
      this.pauseBtn.setAttribute("aria-label", paused ? "Resume" : "Pause");
      this.gauge.classList.toggle("dimmed", s.phase !== "running");
    }
    const score = Math.floor(s.score);
    if (L.score !== score) {
      L.score = score;
      this.scoreEl.textContent = String(score);
    }
    if (L.best !== s.best) {
      L.best = s.best;
      this.bestEl.textContent = `BEST ${s.best}`;
    }
    if (L.dist !== s.distanceM) {
      L.dist = s.distanceM;
      this.distEl.textContent =
        `${String(Math.floor(s.distanceM)).padStart(4, "0")}m`;
    }
    if (L.level !== s.level) {
      L.level = s.level;
      this.levelEl.textContent = String(s.level);
    }
    const prog = Math.round(s.levelProgress * 200) / 200;
    if (L.progress !== prog) {
      L.progress = prog;
      this.progressFill.style.width = `${(prog * 100).toFixed(1)}%`;
    }

    const sev = severityOf(s.imbalance);
    if (L.sev !== sev) {
      L.sev = sev;
      this.gauge.classList.toggle("warn", sev === "warn");
      this.gauge.classList.toggle("critical", sev === "critical");
      // Vignette stays a two-state flag: on only in the critical band.
      this.vignette.classList.toggle("danger", sev === "critical");
    }

    // Side danger glow shares the gauge's severity: lit only in the critical
    // band, on the SCREEN edge the heavier flank is visible on (world-right
    // renders screen-left, same flip as the weight pips below). One binary
    // state change per frame at most — the CSS opacity transition ramps it.
    // Exact ties imply imbalance 0 and never reach the critical band; >=
    // merely keeps the choice deterministic if floating point ever rounds
    // into one.
    let edge: EdgeSide = "none";
    if (sev === "critical") {
      edge = s.weights.right >= s.weights.left ? "left" : "right";
    }
    if (L.edge !== edge) {
      L.edge = edge;
      this.edges.left.classList.toggle("active", edge === "left");
      this.edges.right.classList.toggle("active", edge === "right");
    }
    this.gaugeCar.style.transform = `rotate(${(s.tilt * 25).toFixed(2)}deg)`;

    this.syncAmmo("left", s.mag.left, s.reload01.left);
    this.syncAmmo("right", s.mag.right, s.reload01.right);

    // Screen flip: the chase camera looks down +z from behind the car, so
    // world +x (zombie side "right") appears on screen-left — the convention
    // writeHudState already uses for mag ("the on-screen-left gun is
    // gun.right (world)") and for tilt. weights arrive un-flipped (world
    // space), so the screen-left row renders world-right units here.
    const cap = CONFIG.car.capacityPerSide;
    this.syncWeight(
      this.wPips.left,
      Math.max(0, Math.min(cap, Math.round(s.weights.right))),
    );
    this.syncWeight(
      this.wPips.right,
      Math.max(0, Math.min(cap, Math.round(s.weights.left))),
    );

    const mult = s.multiplier >= 2 ? s.multiplier : 0;
    if (L.mult !== mult) {
      L.mult = mult;
      if (mult === 0) {
        this.streakBadge.classList.remove("visible");
      } else {
        this.streakBadge.textContent = `x${mult}`;
        this.streakBadge.classList.remove("bump");
        void this.streakBadge.offsetWidth; // restart pop animation
        this.streakBadge.classList.add("visible", "bump");
      }
    }
  }

  /** Toggles a weight pip row only when its filled count changed. */
  private syncWeight(cells: HTMLSpanElement[], filled: number): void {
    const isLeft = cells === this.wPips.left;
    if ((isLeft ? this.last.wL : this.last.wR) === filled) return;
    if (isLeft) this.last.wL = filled;
    else this.last.wR = filled;
    for (let i = 0; i < cells.length; i++) {
      cells[i].classList.toggle("full", i < filled);
    }
  }

  private syncAmmo(side: "left" | "right", mag: number, reload01: number): void {
    const L = this.last;
    const isLeft = side === "left";
    if ((isLeft ? L.magL : L.magR) !== mag) {
      if (isLeft) L.magL = mag;
      else L.magR = mag;
      const pips = this.pips[side];
      for (let i = 0; i < pips.length; i++) {
        pips[i].classList.toggle("empty", i >= mag);
      }
    }
    const done = reload01 >= 1;
    if ((isLeft ? L.relL : L.relR) !== done) {
      if (isLeft) L.relL = done;
      else L.relR = done;
      this.arcs[side].classList.toggle("visible", !done);
    }
    if (!done) {
      this.arcs[side].style.setProperty(
        "--sweep",
        `${Math.round(reload01 * 360)}deg`,
      );
    }
  }
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Subtitle for the level-up banner, from unlocksForLevel(level): pluralized
 * display names ("RUNNERS UNLOCKED", "BRUTES UNLOCKED", and a " + " join for
 * several: "RUNNERS + BRUTES UNLOCKED"). The zombie type set is closed and
 * every plural is regular (+S), so the naive plural is exact. Empty input →
 * undefined: the banner then shows only the new level (node-testable, see
 * tests/unlockSubtitle.test.ts).
 */
export function unlockSubtitle(
  types: readonly ZombieType[],
): string | undefined {
  if (types.length === 0) return undefined;
  const names = types.map((t) => `${t.toUpperCase()}S`);
  return `${names.join(" + ")} UNLOCKED`;
}
