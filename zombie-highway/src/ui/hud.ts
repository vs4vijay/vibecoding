import { CONFIG } from "../config";
import type { Phase } from "../game/session";

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
  mag: { left: number; right: number };
  /** 0..1 reload completion; 1 means ready. */
  reload01: { left: number; right: number };
  multiplier: number;
};

/**
 * Live in-run heads-up display: score/best, distance, level chip with
 * progress bar, tilt gauge, ammo pip rows with reload arcs, streak badge,
 * center toasts, pause button and the danger vignette. Builds its own DOM
 * under `root` (#hud) once; update() is called every frame.
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
  private readonly pauseBtn: HTMLButtonElement;
  private readonly streakBadge: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly pips: { left: HTMLSpanElement[]; right: HTMLSpanElement[] };
  private readonly arcs: { left: HTMLElement; right: HTMLElement };
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
    crit: false,
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
    const topLeft = el("div", "hud-topleft");
    this.distEl = el("div", "hud-dist");
    topLeft.append(this.distEl);

    const topCenter = el("div", "hud-topcenter");
    this.scoreEl = el("div", "hud-score");
    this.bestEl = el("div", "hud-best");
    this.gauge = el("div", "tilt-gauge");
    this.gaugeCar = el("div", "tilt-car");
    this.gauge.append(this.gaugeCar);
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
      topLeft,
      topCenter,
      topRight,
      ammoLeftWrap,
      ammoRightWrap,
      this.streakBadge,
    );
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

  /** Center-screen transient message (LEVEL N / NEW BEST!). */
  toast(text: string): void {
    const t = el("div", "toast");
    t.textContent = text;
    this.toasts.append(t);
    window.setTimeout(() => t.remove(), 1200);
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

    const crit = Math.abs(s.imbalance) >= 0.75;
    if (L.crit !== crit) {
      L.crit = crit;
      this.gauge.classList.toggle("critical", crit);
      this.vignette.classList.toggle("danger", crit);
    }
    this.gaugeCar.style.transform = `rotate(${(s.tilt * 25).toFixed(2)}deg)`;

    this.syncAmmo("left", s.mag.left, s.reload01.left);
    this.syncAmmo("right", s.mag.right, s.reload01.right);

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
