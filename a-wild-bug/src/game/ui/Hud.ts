import { LOOP_TUNING, type ForageLoop } from "../gameplay/ForageLoop";
import { HINTS, type Scheme, type TeachHintId } from "./Hints";

/**
 * The game UI, drawn on a 2D canvas layered over the WebGL canvas so the
 * screenshot harness (which reads the WebGL canvas) can composite both —
 * every capture includes the HUD. Redrawn every frame from fixed-step sim
 * state; all animation clocks come from the sim (no wall-clock), so pinned
 * shots are pixel-stable.
 *
 * Storybook art direction: warm creams / leaf greens / chitin ambers, soft
 * shadows, Baloo 2 (bundled via @fontsource) for the storybook voice.
 *
 * The win/lose banners used to live here; the DOM shell (Shell.ts, design D1)
 * owns results presentation now. Only the in-play "winMoment" flourish is
 * left — it fires while the day is still running, before results show.
 *
 * Presentation modes (design D5, hud-presentation spec):
 * - Compact layout: viewports that are narrow (<700 CSS px), squarish
 *   (aspect < 1.2) or short (<520 CSS px — landscape phones) floor the text/
 *   plaque scale, shorten the sun track, drop the DAWN/DUSK micro-labels and
 *   raise the prompt clear of the touch-widget thumb zones. Wide desktop
 *   viewports render the classic layout with untouched math.
 * - Safe areas: env(safe-area-inset-*) is read once via a hidden probe
 *   element (re-measured on resize) and inset into every HUD margin, so
 *   nothing readable sits under a notch or home indicator (viewport-fit=cover
 *   in index.html exposes the insets). `setSafeArea()` overrides the measured
 *   values for tests/harness.
 * - Reduced motion: `(prefers-reduced-motion: reduce)` flattens decorative
 *   pulses (vignette breathing, plaque pop, ray rotation, sun/threat pulse)
 *   to static or opacity-only treatment while urgency/quota/threat stay
 *   encoded in color, geometry and cue position. `pinned` overrides it
 *   independently — pinned captures render exactly as before.
 */

const FONT = '"Baloo 2", "Trebuchet MS", ui-rounded, system-ui, sans-serif';

const PALETTE = {
  cream: "#fff3d9",
  creamDim: "rgba(255,243,217,0.82)",
  gold: "#ffd884",
  goldDeep: "#e8a13d",
  amber: "#f0d9a8",
  ink: "rgba(43,30,12,0.85)",
  plaqueTop: "rgba(48,35,18,0.62)",
  plaqueBottom: "rgba(66,47,22,0.5)",
  plaqueEdge: "rgba(255,231,178,0.4)",
  shadow: "rgba(30,20,4,0.72)",
};

/**
 * Compact-layout thresholds, in CSS pixels. Portrait phones (390×844) trip
 * the width/aspect clauses, landscape phones (844×390) the height clause;
 * every desktop capture viewport (1280×720, 1600×900) trips none, so the
 * classic layout there is bit-for-bit the pre-compact math.
 */
const COMPACT_MAX_WIDTH = 700;
const COMPACT_MIN_ASPECT = 1.2;
const COMPACT_MAX_HEIGHT = 520;
/**
 * Floored text/plaque scale for compact viewports (device px = ×dpr). At the
 * floor the quota count renders ≈26 CSS px and prompt/toast ≈13.7–15.1 CSS px
 * — readable where the raw scale (0.24 on a 390px portrait) gave 6–8px.
 */
const COMPACT_FLOOR = 0.72;
/** Independent floor for the persistent controls line (13px × 0.78 ≈ 10 CSS px). */
const CONTROLS_FLOOR = 0.78;
/** CSS-px reserve for the DOM pause + session-mute controls when clamping the sun track. */
const PAUSE_RESERVE = 140;
/**
 * Touch-widget thumb zones mirrored from touch.css (CSS px, relative to the
 * safe-area-inset container) so the canvas prompt can keep clear of them.
 */
const WIDGET_ZONE = {
  stick: { left: 24, bottom: 24, w: 132, h: 132 },
  jump: { right: 36, bottom: 136, w: 62, h: 62 },
  act: { right: 26, bottom: 36, w: 84, h: 84 },
};

/** A recorded HUD element bounding box, in CSS pixels (device px ÷ dpr). */
export interface HudBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Safe-area insets in CSS pixels (from env() or the setSafeArea override). */
export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ThreatCueInput {
  /** 0..1 danger intensity (chase/spot drive). */
  intensity: number;
  /** Screen-space bearing to the threat (radians; 0 = right of screen center). */
  angle: number;
}

export interface HudInputs {
  loop: ForageLoop;
  /** Sim-driven animation clock (pinned wind time in shots). */
  uiClock: number;
  /** Day-cycle time-of-day t in [0,1]. */
  dayT: number;
  width: number;
  height: number;
  /** Latched input scheme (design D5): picks keycap vs. button-chip prompts. */
  scheme: Scheme;
  /** Optional M3 threat cue (absent → nothing drawn; keeps old frames stable). */
  threat?: ThreatCueInput | null;
  /**
   * First-day teaching hint (onboarding spec): the pill's verb + fade alpha
   * from Teach.display, or null when nothing is up. The HUD resolves the
   * scheme copy at draw time (design D5).
   */
  teach?: { id: TeachHintId | null; alpha: number } | null;
  /**
   * The capture kill-switch, passed through so reduced-motion flattening only
   * ever applies to live play: pinned rendering follows the pinned contract
   * regardless of the user's motion preference.
   */
  pinned: boolean;
}

/** Per-frame layout numbers shared by the draw* helpers (one reused object). */
interface HudLayout {
  /** Classic scale (device px): min(w/1600, h/900). */
  s: number;
  /** Text/plaque scale: max(s, COMPACT_FLOOR × dpr) in compact viewports. */
  sEff: number;
  compact: boolean;
  dpr: number;
  w: number;
  h: number;
  /** Safe-area insets in device px (0 on classic desktops). */
  safeT: number;
  safeR: number;
  safeB: number;
  safeL: number;
  /** Effective reduced-motion state for THIS frame (never while pinned). */
  rm: boolean;
}

export class Hud {
  readonly canvas: HTMLCanvasElement;
  /** Shot-director kill switch (the anthill beauty shot hides the HUD). */
  enabled = true;

  // Verification seams for tools/probe-ui.mjs (plain field writes per frame,
  // never read by the drawing itself): what the last rendered frame chose.
  /** Whether the persistent controls line rendered (key scheme only). */
  lastControlsDrawn = false;
  /** Affordance chosen for the last rendered prompt (null = none drawn). */
  lastPromptAffordance: "keycap" | "chip" | null = null;
  /** The label drawn inside that keycap/chip (null = none drawn). */
  lastPromptLabel: string | null = null;

  /**
   * Element bounding boxes of the last rendered frame, in CSS pixels — the
   * probe asserts non-intersection / safe-area containment from these. One
   * fixed set of objects, refilled per frame (null = not drawn); the threat
   * cue is recorded too but is an ambient edge glow, excluded from the
   * pairwise overlap assertions.
   */
  readonly hudBoxes = {
    viewport: { w: 0, h: 0 },
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    /** Compact mode engaged for this frame. */
    compact: false,
    /** Classic + effective text scale, in CSS px. */
    s: 0,
    sEff: 0,
    /** Rendered font sizes, CSS px (floors are asserted from these). */
    fonts: { count: 0, sub: 0, prompt: 0, toast: 0, teach: 0 },
    plaque: null as HudBox | null,
    dayTrack: null as HudBox | null,
    toast: null as HudBox | null,
    prompt: null as HudBox | null,
    controls: null as HudBox | null,
    threat: null as HudBox | null,
    banner: null as HudBox | null,
    teach: null as HudBox | null,
  };

  /**
   * Motion samples of the last rendered frame, for the reduced-motion probe:
   * under reduced motion the amplitudes collapse to constants while the
   * threat angle keeps tracking the chase.
   */
  readonly debugMotion = {
    /** Edge alpha of the urgency vignette (0 = not drawn). */
    vignetteAlpha: 0,
    /** Rotation applied to the sun rays (radians). */
    sunRayAngle: 0,
    /** Sun disc radius, CSS px (urgency-scaled, pulse-flattened). */
    sunRadius: 0,
    /** Bearing of the threat cue (radians) — informational, tracks always. */
    threatAngle: 0,
    /** Threat eye marker radius, CSS px (pulse-flattened under reduce). */
    threatRadius: 0,
    /** Quota plaque pop scale (1 = static). */
    plaqueScale: 1,
    /** Reduced-motion flattening applied this frame (false while pinned). */
    reduced: false,
  };

  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;

  /** Persistent per-element box objects (refilled, never reallocated). */
  private readonly boxPlaque: HudBox = { x: 0, y: 0, w: 0, h: 0 };
  private readonly boxDayTrack: HudBox = { x: 0, y: 0, w: 0, h: 0 };
  private readonly boxToast: HudBox = { x: 0, y: 0, w: 0, h: 0 };
  private readonly boxPrompt: HudBox = { x: 0, y: 0, w: 0, h: 0 };
  private readonly boxControls: HudBox = { x: 0, y: 0, w: 0, h: 0 };
  private readonly boxThreat: HudBox = { x: 0, y: 0, w: 0, h: 0 };
  private readonly boxBanner: HudBox = { x: 0, y: 0, w: 0, h: 0 };
  private readonly boxTeach: HudBox = { x: 0, y: 0, w: 0, h: 0 };
  private readonly layout: HudLayout = {
    s: 0,
    sEff: 0,
    compact: false,
    dpr: 1,
    w: 0,
    h: 0,
    safeT: 0,
    safeR: 0,
    safeB: 0,
    safeL: 0,
    rm: false,
  };

  // --- safe areas (design D5) ----------------------------------------------

  /** Hidden probe element whose env() padding exposes the system insets. */
  private readonly safeProbe: HTMLDivElement;
  /** Current insets, CSS px (measured from env(), or the test override). */
  private readonly safe: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Set by setSafeArea(): measured env() values stop being applied. */
  private safeOverride = false;

  // --- reduced motion (design D5) ------------------------------------------

  private readonly reducedQuery: MediaQueryList;
  private reducedMotion: boolean;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "ui";
    this.ctx = this.canvas.getContext("2d")!;

    this.reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.reducedQuery.matches;
    this.reducedQuery.addEventListener("change", this.onReducedChange);

    // The env() probe: a zero-size fixed element whose computed paddings are
    // exactly the system safe-area insets (needs viewport-fit=cover in the
    // meta to report non-zero values on notched displays).
    this.safeProbe = document.createElement("div");
    this.safeProbe.setAttribute("aria-hidden", "true");
    this.safeProbe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;visibility:hidden;" +
      "pointer-events:none;" +
      "padding:env(safe-area-inset-top) env(safe-area-inset-right) " +
      "env(safe-area-inset-bottom) env(safe-area-inset-left);";
    document.body.appendChild(this.safeProbe);
    this.measureSafeArea();
  }

  /** Whether the system reduced-motion preference is active (probe seam). */
  get debugReduced(): boolean {
    return this.reducedMotion;
  }

  private readonly onReducedChange = (e: MediaQueryListEvent): void => {
    this.reducedMotion = e.matches;
  };

  /** Re-reads env() insets from the probe element (cheap; on resize only). */
  measureSafeArea(): void {
    if (this.safeOverride) return;
    const cs = getComputedStyle(this.safeProbe);
    this.safe.top = Number.parseFloat(cs.paddingTop) || 0;
    this.safe.right = Number.parseFloat(cs.paddingRight) || 0;
    this.safe.bottom = Number.parseFloat(cs.paddingBottom) || 0;
    this.safe.left = Number.parseFloat(cs.paddingLeft) || 0;
  }

  /**
   * Test/harness seam: pin the insets explicitly (Playwright cannot emulate
   * env()). While overridden, resize re-measurement is skipped.
   */
  setSafeArea(insets: SafeInsets): void {
    this.safeOverride = true;
    this.safe.top = insets.top;
    this.safe.right = insets.right;
    this.safe.bottom = insets.bottom;
    this.safe.left = insets.left;
  }

  /**
   * Wipes the HUD canvas. Used while the DOM shell owns the screen (title,
   * unpinned) so the quota plaque can't peek through the title scrim.
   */
  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.resetFrameDebug();
  }

  resize(width: number, height: number, dpr: number): void {
    this.canvas.width = Math.max(2, Math.round(width * dpr));
    this.canvas.height = Math.max(2, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    // Orientation changes re-expose env() — re-measure while it's cheap.
    this.dpr = dpr;
    this.measureSafeArea();
  }

  render(inputs: HudInputs): void {
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Nothing drawn yet this frame (kept before the enabled gate so a hidden
    // HUD never reports stale choices).
    this.lastControlsDrawn = false;
    this.lastPromptAffordance = null;
    this.lastPromptLabel = null;
    this.resetFrameDebug();
    if (!this.enabled) return;

    const s = Math.min(w / 1600, h / 900);
    const cssW = w / dpr;
    const cssH = h / dpr;
    const compact = cssW < COMPACT_MAX_WIDTH || cssW / cssH < COMPACT_MIN_ASPECT || cssH < COMPACT_MAX_HEIGHT;
    const sEff = compact ? Math.max(s, COMPACT_FLOOR * dpr) : s;
    const L = this.layout;
    L.s = s;
    L.sEff = sEff;
    L.compact = compact;
    L.dpr = dpr;
    L.w = w;
    L.h = h;
    L.safeT = this.safe.top * dpr;
    L.safeR = this.safe.right * dpr;
    L.safeB = this.safe.bottom * dpr;
    L.safeL = this.safe.left * dpr;
    // Pinned rendering follows the pinned contract regardless of the media
    // query (the kill-switch overrides the user preference independently).
    L.rm = this.reducedMotion && !inputs.pinned;
    this.debugMotion.reduced = L.rm;

    // Layout meta for the probe (CSS-px space).
    const bx = this.hudBoxes;
    bx.viewport.w = cssW;
    bx.viewport.h = cssH;
    bx.safe.top = this.safe.top;
    bx.safe.right = this.safe.right;
    bx.safe.bottom = this.safe.bottom;
    bx.safe.left = this.safe.left;
    bx.compact = compact;
    bx.s = s / dpr;
    bx.sEff = sEff / dpr;
    bx.fonts.count = (36 * sEff) / dpr;
    bx.fonts.sub = ((compact ? 15 : 11.5) * sEff) / dpr;
    bx.fonts.prompt = (21 * sEff) / dpr;
    bx.fonts.toast = (19 * sEff) / dpr;
    bx.fonts.teach = (17.5 * sEff) / dpr;

    const phase = inputs.loop.phase;

    if (phase === "playing" || phase === "winMoment") {
      this.drawQuota(inputs, L);
      this.drawDayTrack(inputs, L);
      this.drawToast(inputs, L);
      this.drawPrompt(inputs, L);
      this.drawControls(inputs, L);
      this.drawTeach(inputs, L);
      if (inputs.threat && inputs.threat.intensity > 0.03) this.drawThreatCue(inputs, L);
      if (phase === "winMoment") this.drawWinMoment(inputs, L);
    }
    // phase "win" / "lose" draw nothing: the DOM shell owns results now.

    // Urgency vignette: a warm edge-bias that breathes when the sun runs low —
    // kept strong enough to read at a glance (edge alpha 0.18–0.25). Under
    // reduced motion it holds the static mean; urgency still colors the frame.
    if (inputs.loop.urgency > 0.01 && phase === "playing") {
      const pulse = L.rm ? 0.5 : 0.5 + 0.5 * Math.sin(inputs.uiClock * 6.6);
      const a = inputs.loop.urgency * (L.rm ? 0.215 : 0.18 + 0.07 * pulse);
      this.debugMotion.vignetteAlpha = a;
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, "rgba(255,110,40,0)");
      g.addColorStop(1, `rgba(214,72,18,${a.toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /** Clears every per-frame debug record (fixed objects, no allocation). */
  private resetFrameDebug(): void {
    const bx = this.hudBoxes;
    bx.plaque = null;
    bx.dayTrack = null;
    bx.toast = null;
    bx.prompt = null;
    bx.controls = null;
    bx.threat = null;
    bx.banner = null;
    bx.teach = null;
    bx.compact = false;
    bx.s = 0;
    bx.sEff = 0;
    bx.fonts.count = 0;
    bx.fonts.sub = 0;
    bx.fonts.prompt = 0;
    bx.fonts.toast = 0;
    bx.fonts.teach = 0;
    const m = this.debugMotion;
    m.vignetteAlpha = 0;
    m.sunRayAngle = 0;
    m.sunRadius = 0;
    m.threatAngle = 0;
    m.threatRadius = 0;
    m.plaqueScale = 1;
    m.reduced = false;
  }

  // --- quota counter (top-left) -------------------------------------------

  private drawQuota(inputs: HudInputs, L: HudLayout): void {
    const { ctx } = this;
    const loop = inputs.loop;
    const s = L.sEff;
    const pad = 26 * s;
    const x = pad + L.safeL;
    const y = pad + L.safeT;
    const w = (L.compact ? 200 : 190) * s;
    const h = 66 * s;
    const urgent = loop.phase === "playing" ? loop.urgency : 0;
    const pulse = L.rm ? 0.5 : 0.5 + 0.5 * Math.sin(inputs.uiClock * 6.6);

    // Plaque pop on deposit — flattened under reduced motion (the count's
    // color still carries the state).
    const pop = 1 - loop.countPop; // 1 right after a deposit
    const scale = L.rm ? 1 : 1 + Math.sin(Math.min(1, pop) * Math.PI) * 0.07;
    this.debugMotion.plaqueScale = scale;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(x + w / 2), -(y + h / 2));

    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 14 * s;
    ctx.shadowOffsetY = 4 * s;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, PALETTE.plaqueTop);
    grad.addColorStop(1, PALETTE.plaqueBottom);
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, w, h, 20 * s);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Inner edge highlight — hot amber while the sun runs out. The pulse term
    // collapses to its mean under reduced motion; urgency stays encoded in
    // the stroke color and width.
    ctx.lineWidth = (1.6 + urgent * 1.3) * s;
    if (urgent > 0.01) {
      const edgeA = (L.rm ? 0.7 : 0.5 + 0.4 * pulse) * Math.min(1, 0.35 + urgent);
      ctx.strokeStyle = `rgba(255,166,52,${edgeA.toFixed(3)})`;
    } else {
      ctx.strokeStyle = PALETTE.plaqueEdge;
    }
    roundRect(ctx, x + 1 * s, y + 1 * s, w - 2 * s, h - 2 * s, 19 * s);
    ctx.stroke();

    // Grain icon (its idle tilt is decorative — static under reduce).
    drawGrainIcon(ctx, x + 34 * s, y + h * 0.52, 15 * s, L.rm ? 0 : inputs.uiClock);
    if (loop.phase === "winMoment") {
      // Golden glow behind the count when the quota lands (opacity-only
      // already; the breathing term holds still under reduce).
      const glow = L.rm ? 0.75 : 0.5 + 0.5 * Math.sin(inputs.uiClock * 5.0);
      ctx.shadowColor = `rgba(255,196,90,${0.5 + glow * 0.4})`;
      ctx.shadowBlur = 22 * s;
    }

    // Count — tints from cream toward hot amber as urgency rises.
    const met = loop.deposited >= loop.quota;
    ctx.font = `800 ${36 * s}px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const countText = `${Math.min(loop.deposited, loop.quota)} / ${loop.quota}`;
    const cx = x + 62 * s;
    const cy = y + h * 0.46;
    ctx.fillStyle = met
      ? PALETTE.gold
      : mixHex("#fff3d9", "#ffc45e", Math.min(1, urgent * 1.2));
    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 8 * s;
    ctx.shadowOffsetY = 2.5 * s;
    ctx.fillText(countText, cx, cy);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Sub-label — bumped in compact mode so it stays legible at the floor.
    ctx.font = `600 ${(L.compact ? 15 : 11.5) * s}px ${FONT}`;
    ctx.fillStyle = PALETTE.amber;
    ctx.textAlign = "left";
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(L.compact ? 1.6 : 2.4) * s}px`;
    ctx.fillText("GRAIN QUOTA", cx + 1 * s, y + h * 0.82);
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
    ctx.restore();

    // Probe box: the drawn (pop-scaled) plaque extent, CSS px.
    const d = L.dpr;
    const bw = w * scale;
    const bh = h * scale;
    this.boxPlaque.x = (x + (w - bw) / 2) / d;
    this.boxPlaque.y = (y + (h - bh) / 2) / d;
    this.boxPlaque.w = bw / d;
    this.boxPlaque.h = bh / d;
    this.hudBoxes.plaque = this.boxPlaque;
  }

  // --- sun-timer day track (top-center) ------------------------------------

  private drawDayTrack(inputs: HudInputs, L: HudLayout): void {
    const { ctx } = this;
    const s = L.sEff;
    const w = L.w;
    const d = L.dpr;
    const a0 = (L.compact ? 64 : 128) * s; // arc half-width
    let b = (L.compact ? 28 : 46) * s; // arc height
    const ext0 = (L.compact ? 10 : 30) * s; // horizon overrun past the feet
    const baseY = 58 * s + L.safeT;
    const u = dayProgress(inputs); // 0..1 progress of the day

    // Compact: fit the track into the band between the quota plaque and the
    // pause control, shrinking the arc if that band is tight (stubbed-notched
    // portrait), then center within it.
    let a = a0;
    let ext = ext0;
    let cx = w / 2;
    if (L.compact) {
      const plaqueRight = 26 * s + L.safeL + (L.compact ? 200 : 190) * s;
      const pauseLeft = w - L.safeR - PAUSE_RESERVE * d;
      const halfW0 = a0 + ext0;
      const band = pauseLeft - plaqueRight - 12 * d;
      const want = 2 * halfW0;
      if (band < want) {
        // Stub-notched portrait can leave a very tight band — shrink the arc
        // (floored so it never vanishes) and flatten it to match.
        const k = Math.max(0.35, band / want);
        a = a0 * k;
        ext = ext0 * k;
        b = Math.min(b, a * 0.9);
      }
      const halfW = a + ext;
      const minCx = plaqueRight + 6 * d + halfW;
      const maxCx = pauseLeft - 6 * d - halfW;
      // Feasible band: clamp inside it. Infeasible (pathological stubs): hug
      // the controls side so any encroachment lands on the plaque edge, never
      // the interactive cluster.
      cx = minCx <= maxCx ? Math.min(maxCx, Math.max(minCx, cx)) : Math.max(cx, maxCx);
    }

    // Track: dim full path, then a bright elapsed overlay (the progress read).
    ctx.lineCap = "round";
    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 8 * s;
    ctx.shadowOffsetY = 2 * s;
    ctx.strokeStyle = "rgba(58,42,22,0.55)";
    ctx.lineWidth = 7 * s;
    ctx.beginPath();
    ctx.ellipse(cx, baseY, a, b, 0, Math.PI, Math.PI * 2);
    ctx.stroke();

    // Warm→amber gradient darkens as the sun descends.
    const warm = ctx.createLinearGradient(cx - a, 0, cx + a, 0);
    const duskMix = Math.pow(u, 1.4);
    warm.addColorStop(0, mixHex("#ffe9b0", "#e8973b", duskMix));
    warm.addColorStop(0.5, mixHex("#ffdf9a", "#d97f2e", duskMix));
    warm.addColorStop(1, mixHex("#f5c26e", "#b45e24", duskMix));
    ctx.strokeStyle = warm;
    ctx.lineWidth = 4.2 * s;
    ctx.beginPath();
    ctx.ellipse(cx, baseY, a, b, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Horizon line through the arc feet.
    ctx.strokeStyle = "rgba(255,236,190,0.5)";
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(cx - a - ext, baseY);
    ctx.lineTo(cx + a + ext, baseY);
    ctx.stroke();
    // Dawn/dusk posts.
    for (const px of [cx - a - ext, cx + a + ext]) {
      ctx.fillStyle = "rgba(255,222,150,0.85)";
      ctx.beginPath();
      ctx.moveTo(px, baseY - 5 * s);
      ctx.lineTo(px + 4.5 * s, baseY);
      ctx.lineTo(px, baseY + 5 * s);
      ctx.lineTo(px - 4.5 * s, baseY);
      ctx.closePath();
      ctx.fill();
    }

    // Sun marker sliding along the arc. The urgency breathing collapses to
    // its static mean under reduce; size/color still encode urgency.
    const ang = Math.PI + u * Math.PI;
    const sx = cx + Math.cos(ang) * a;
    const sy = baseY + Math.sin(ang) * b;
    const urgent = inputs.loop.urgency;
    const pulse = L.rm ? 0.5 : 0.5 + 0.5 * Math.sin(inputs.uiClock * 6.6);
    const sunR = (9.5 + urgent * 4.5 * pulse) * s;
    this.debugMotion.sunRadius = sunR / d;

    // Halo.
    const halo = ctx.createRadialGradient(sx, sy, sunR * 0.2, sx, sy, sunR * (2.4 + urgent * 1.2 * pulse));
    halo.addColorStop(0, `rgba(255,214,120,${0.5 + urgent * 0.25})`);
    halo.addColorStop(1, "rgba(255,170,60,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, sunR * (2.4 + urgent * 1.2 * pulse), 0, Math.PI * 2);
    ctx.fill();

    // Rays — rotation is decorative and freezes under reduce (rays drawn on).
    const rayAngle = L.rm ? 0 : inputs.uiClock * 0.15;
    this.debugMotion.sunRayAngle = rayAngle;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rayAngle);
    ctx.strokeStyle = `rgba(255,225,150,${0.75 + urgent * 0.25})`;
    ctx.lineWidth = 2.2 * s;
    for (let i = 0; i < 8; i++) {
      const ra = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ra) * sunR * 1.45, Math.sin(ra) * sunR * 1.45);
      ctx.lineTo(Math.cos(ra) * sunR * 1.95, Math.sin(ra) * sunR * 1.95);
      ctx.stroke();
    }
    ctx.restore();

    // Disc.
    const disc = ctx.createRadialGradient(sx - sunR * 0.3, sy - sunR * 0.35, sunR * 0.15, sx, sy, sunR);
    disc.addColorStop(0, "#fffbe8");
    disc.addColorStop(0.6, "#ffd884");
    disc.addColorStop(1, urgent > 0.4 ? "#f0953c" : "#f5b452");
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sx, sy, sunR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,70,20,0.55)";
    ctx.lineWidth = 1.4 * s;
    ctx.stroke();

    // Tiny end labels (diegetic, not a clock). Below the compact floor they
    // would render under 8 CSS px — drop them and let the posts speak.
    if (!L.compact) {
      ctx.font = `600 ${10.5 * s}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(255,236,190,0.66)";
      ctx.fillText("DAWN", cx - a - ext, baseY + 9 * s);
      ctx.fillText("DUSK", cx + a + ext, baseY + 9 * s);
    }

    // Probe box: track + posts (+ labels on classic) + worst-case sun, CSS px.
    const sunTop = 2 * ((9.5 + 4.5) * s);
    const yTop = Math.max(L.safeT, baseY - b - sunTop);
    const yBot = baseY + (L.compact ? 5 * s : 23 * s);
    this.boxDayTrack.x = (cx - a - ext) / d;
    this.boxDayTrack.y = yTop / d;
    this.boxDayTrack.w = (2 * (a + ext)) / d;
    this.boxDayTrack.h = (yBot - yTop) / d;
    this.hudBoxes.dayTrack = this.boxDayTrack;
  }

  // --- contextual prompt (bottom-center) -----------------------------------

  private drawPrompt(inputs: HudInputs, L: HudLayout): void {
    const { ctx } = this;
    const prompt = inputs.loop.prompt;
    if (prompt.alpha <= 0.01 || !prompt.text) return;
    const s = L.sEff;
    const w = L.w;
    const h = L.h;
    const cx = w / 2;
    const y = L.compact ? h - 250 * s - L.safeB : h - 64 * L.s - L.safeB;
    const alpha = prompt.alpha;

    // The affordance follows the latched scheme (design D5): a keycap on
    // keyboard — byte-identical to the pre-hints prompt — or, on touch, a
    // chip styled like the on-screen ACTION button, labeled with that
    // button's verb so the prompt points at the control a thumb can press.
    const touch = inputs.scheme === "touch";
    const affordance = prompt.key
      ? (HINTS.promptAffordance[prompt.key]?.[inputs.scheme] ?? prompt.key)
      : null;
    const chip = touch && affordance !== null;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${21 * s}px ${FONT}`;
    ctx.textBaseline = "middle";
    const textW = ctx.measureText(prompt.text).width;
    let capW = 0;
    if (affordance !== null) {
      if (chip) {
        ctx.font = chipFont(s);
        setChipSpacing(ctx, s);
        capW = ctx.measureText(affordance).width + 24 * s;
        setChipSpacing(ctx, s, true);
      } else {
        capW = 34 * s;
      }
    }
    const gap = affordance !== null ? 10 * s : 0;
    const totalW = capW + gap + textW;
    let x = cx - totalW / 2;
    let yDraw = y;

    // Compact: keep the strip out of the joystick/button thumb zones — the
    // prompt sits above them; when it would still reach a widget rect (long
    // text), raise it above the JUMP button, the topmost of the cluster.
    if (L.compact) {
      const stripX0 = x - 16 * s;
      const stripX1 = x + totalW + 16 * s;
      const stripY0 = y - 21 * s;
      const stripY1 = y + 21 * s;
      const d = L.dpr;
      const zones = [
        {
          x0: L.safeL + WIDGET_ZONE.stick.left * d,
          x1: L.safeL + (WIDGET_ZONE.stick.left + WIDGET_ZONE.stick.w) * d,
          y0: h - L.safeB - (WIDGET_ZONE.stick.bottom + WIDGET_ZONE.stick.h) * d,
          y1: h - L.safeB - WIDGET_ZONE.stick.bottom * d,
        },
        {
          x0: w - L.safeR - (WIDGET_ZONE.jump.right + WIDGET_ZONE.jump.w) * d,
          x1: w - L.safeR - WIDGET_ZONE.jump.right * d,
          y0: h - L.safeB - (WIDGET_ZONE.jump.bottom + WIDGET_ZONE.jump.h) * d,
          y1: h - L.safeB - WIDGET_ZONE.jump.bottom * d,
        },
        {
          x0: w - L.safeR - (WIDGET_ZONE.act.right + WIDGET_ZONE.act.w) * d,
          x1: w - L.safeR - WIDGET_ZONE.act.right * d,
          y0: h - L.safeB - (WIDGET_ZONE.act.bottom + WIDGET_ZONE.act.h) * d,
          y1: h - L.safeB - WIDGET_ZONE.act.bottom * d,
        },
      ];
      for (const z of zones) {
        if (stripX0 < z.x1 && z.x0 < stripX1 && stripY0 < z.y1 && z.y0 < stripY1) {
          yDraw = h - L.safeB - (WIDGET_ZONE.jump.bottom + WIDGET_ZONE.jump.h) * d - 8 * d - 21 * s;
          break;
        }
      }
    }

    // Backing strip for legibility.
    ctx.fillStyle = "rgba(30,22,8,0.32)";
    roundRect(ctx, x - 16 * s, yDraw - 21 * s, totalW + 32 * s, 42 * s, 21 * s);
    ctx.fill();

    if (affordance !== null) {
      if (chip) {
        drawActionChip(ctx, x, yDraw, capW, 34 * s, affordance, s);
        this.lastPromptAffordance = "chip";
      } else {
        drawKeycap(ctx, x, yDraw, 34 * s, affordance, s);
        this.lastPromptAffordance = "keycap";
      }
      this.lastPromptLabel = affordance;
      x += capW + gap;
    }
    ctx.fillStyle = PALETTE.cream;
    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 6 * s;
    ctx.shadowOffsetY = 2 * s;
    ctx.textAlign = "left";
    ctx.fillText(prompt.text, x, yDraw);
    ctx.restore();

    // Probe box: the backing strip, CSS px.
    const d = L.dpr;
    this.boxPrompt.x = (x - (capW + gap) - 16 * s) / d;
    this.boxPrompt.y = (yDraw - 21 * s) / d;
    this.boxPrompt.w = (totalW + 32 * s) / d;
    this.boxPrompt.h = (42 * s) / d;
    this.hudBoxes.prompt = this.boxPrompt;
  }

  // --- toast ---------------------------------------------------------------

  private drawToast(inputs: HudInputs, L: HudLayout): void {
    const { ctx } = this;
    const toast = inputs.loop.toast;
    if (toast.alpha <= 0.01) return;
    const w = L.w;
    const cx = w / 2;
    // Compact nudges the toast a little lower so it clears the shrunken arc
    // and (with insets) the plaque row.
    const y = (L.compact ? 128 : 108) * L.sEff + L.safeT;
    ctx.save();
    ctx.globalAlpha = toast.alpha;
    ctx.font = `700 ${19 * L.sEff}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(toast.text).width;
    ctx.fillStyle = PALETTE.creamDim;
    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 8 * L.sEff;
    ctx.shadowOffsetY = 2 * L.sEff;
    ctx.fillText(toast.text, cx, y);
    ctx.restore();

    // Probe box: measured text extent, CSS px.
    const d = L.dpr;
    const fh = 19 * L.sEff;
    this.boxToast.x = (cx - tw / 2 - 4 * L.sEff) / d;
    this.boxToast.y = (y - fh * 0.7) / d;
    this.boxToast.w = (tw + 8 * L.sEff) / d;
    this.boxToast.h = (fh * 1.4) / d;
    this.hudBoxes.toast = this.boxToast;
  }

  // --- first-day teaching hint (onboarding spec) -----------------------------

  /**
   * The teaching pill: ONE non-blocking amber chip below the event toast —
   * warm pill face + gold edge + grain icon + cream text, so teaching reads
   * differently from the bare-text loop toasts. Copy follows the latched
   * scheme (HINTS.teach, design D5); alpha comes from Teach's fixed-step fade
   * so the pill freezes with the sim. Never gates input or the sim.
   */
  private drawTeach(inputs: HudInputs, L: HudLayout): void {
    const teach = inputs.teach;
    if (!teach || !teach.id || teach.alpha <= 0.01) return;
    const { ctx } = this;
    const s = L.sEff;
    const d = L.dpr;
    const text = HINTS.teach[teach.id][inputs.scheme];
    const cx = L.w / 2;
    // Below the toast line, clear of the sun track above and the prompt zone,
    // widgets and controls line below (safe-area aware like every margin).
    const cy = (L.compact ? 128 : 108) * s + L.safeT + 38 * s;

    ctx.save();
    ctx.globalAlpha = teach.alpha;

    ctx.font = `700 ${17.5 * s}px ${FONT}`;
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(text).width;
    const iconR = 8 * s;
    const padX = 15 * s;
    const iconGap = 9 * s;
    const pillW = padX * 2 + iconR * 2 + iconGap + tw;
    const pillH = 34 * s;
    const x0 = cx - pillW / 2;

    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 10 * s;
    ctx.shadowOffsetY = 3 * s;
    const g = ctx.createLinearGradient(x0, cy - pillH / 2, x0, cy + pillH / 2);
    g.addColorStop(0, "rgba(163,107,34,0.88)");
    g.addColorStop(1, "rgba(112,70,18,0.88)");
    ctx.fillStyle = g;
    roundRect(ctx, x0, cy - pillH / 2, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = "rgba(255,222,150,0.55)";
    ctx.lineWidth = 1.6 * s;
    roundRect(ctx, x0 + 1 * s, cy - pillH / 2 + 1 * s, pillW - 2 * s, pillH - 2 * s, (pillH - 2 * s) / 2);
    ctx.stroke();

    // Tiny grain icon (idle tilt flattened under reduced motion, like the
    // quota plaque's) marks the pill as teaching, not an event.
    drawGrainIcon(ctx, x0 + padX + iconR, cy, iconR, L.rm ? 0 : inputs.uiClock);
    ctx.fillStyle = PALETTE.cream;
    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 5 * s;
    ctx.shadowOffsetY = 1.5 * s;
    ctx.textAlign = "left";
    ctx.fillText(text, x0 + padX + iconR * 2 + iconGap, cy + 0.5 * s);
    ctx.restore();

    // Probe box: the pill extent, CSS px.
    this.boxTeach.x = x0 / d;
    this.boxTeach.y = (cy - pillH / 2) / d;
    this.boxTeach.w = pillW / d;
    this.boxTeach.h = pillH / d;
    this.hudBoxes.teach = this.boxTeach;
  }

  // --- controls hint (bottom-left) ------------------------------------------

  private drawControls(inputs: HudInputs, L: HudLayout): void {
    // The line comes from the copy table; an empty touch variant hides it
    // entirely — the visible widgets already say it (design D5).
    const line = HINTS.controlsLine[inputs.scheme];
    if (!line) return;
    this.lastControlsDrawn = true;
    const { ctx } = this;
    const h = L.h;
    // Compact floors the line independently (13 × 0.72 ≈ 9.4px is too small).
    const sLine = L.compact ? Math.max(L.s, CONTROLS_FLOOR * L.dpr) : L.s;
    ctx.save();
    ctx.font = `600 ${13 * sLine}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = PALETTE.cream;
    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 5 * sLine;
    const tw = ctx.measureText(line).width;
    ctx.fillText(line, 26 * sLine + L.safeL, h - 16 * sLine - L.safeB);
    ctx.restore();

    // Probe box: measured line extent, CSS px.
    const d = L.dpr;
    const fh = 13 * sLine;
    this.boxControls.x = (26 * sLine + L.safeL) / d;
    this.boxControls.y = (h - 16 * sLine - L.safeB - fh * 1.25) / d;
    this.boxControls.w = tw / d;
    this.boxControls.h = (fh * 1.35) / d;
    this.hudBoxes.controls = this.boxControls;
  }

  // --- threat cue (M3): edge glow + hopper-eye marker toward the danger ------

  private drawThreatCue(inputs: HudInputs, L: HudLayout): void {
    const { ctx } = this;
    const w = L.w;
    const h = L.h;
    const threat = inputs.threat!;
    const intensity = Math.min(1, threat.intensity);
    // Breathing flattens to its static mean under reduce; position still
    // tracks the threat and intensity still drives alpha and size.
    const pulse = L.rm ? 0.5 : 0.5 + 0.5 * Math.sin(inputs.uiClock * 9.0);
    const cx = w / 2;
    const cy = h * 0.46;
    const ix = cx + Math.cos(threat.angle) * w * 0.37;
    const iy = cy + Math.sin(threat.angle) * h * 0.36;
    this.debugMotion.threatAngle = threat.angle;

    // Soft red-amber edge glow, breathing with the chase.
    const glowR = 240 * L.sEff;
    const g = ctx.createRadialGradient(ix, iy, 0, ix, iy, glowR);
    const ga = (0.16 + 0.06 * pulse) * intensity;
    g.addColorStop(0, `rgba(255,84,26,${ga.toFixed(3)})`);
    g.addColorStop(0.55, `rgba(224,64,18,${(ga * 0.45).toFixed(3)})`);
    g.addColorStop(1, "rgba(224,64,18,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ix, iy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // The hopper's eye: a hostile amber almond with a slit pupil.
    const r = (15 + 2.5 * pulse) * L.sEff;
    this.debugMotion.threatRadius = r / L.dpr;
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(threat.angle);
    ctx.globalAlpha = 0.55 + 0.45 * intensity;
    ctx.shadowColor = "rgba(40,8,0,0.8)";
    ctx.shadowBlur = 8 * L.sEff;
    const eg = ctx.createRadialGradient(-r * 0.25, -r * 0.2, r * 0.1, 0, 0, r * 1.25);
    eg.addColorStop(0, "#ffb452");
    eg.addColorStop(0.6, "#e05a1e");
    eg.addColorStop(1, "#7e2a0c");
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.moveTo(-r * 1.25, 0);
    ctx.quadraticCurveTo(0, -r * 0.95, r * 1.25, 0);
    ctx.quadraticCurveTo(0, r * 0.95, -r * 1.25, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    // Slit pupil.
    ctx.fillStyle = "#1d0d04";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.16, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Catchlight.
    ctx.fillStyle = "rgba(255,244,214,0.85)";
    ctx.beginPath();
    ctx.arc(-r * 0.34, -r * 0.3, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Probe box: the eye marker (the glow is ambient and excluded from the
    // overlap assertions), CSS px.
    const d = L.dpr;
    this.boxThreat.x = (ix - r * 1.5) / d;
    this.boxThreat.y = (iy - r * 1.2) / d;
    this.boxThreat.w = (3 * r) / d;
    this.boxThreat.h = (2.4 * r) / d;
    this.hudBoxes.threat = this.boxThreat;
  }

  // --- winMoment flourish (results themselves live in the DOM shell) ---------

  /**
   * The "Quota met!" beat while the day is still running (winMoment plays out
   * in live play before Game flips to results). Deterministic fade on the
   * loop's phase clock — opacity-only already, so reduced motion changes
   * nothing here.
   */
  private drawWinMoment(inputs: HudInputs, L: HudLayout): void {
    const { ctx } = this;
    const w = L.w;
    const h = L.h;
    const s = L.sEff;
    const t = inputs.loop.phaseT; // deterministic fade clock
    const fadeIn = Math.min(1, t / 0.45);
    const ease = fadeIn * fadeIn * (3 - 2 * fadeIn);

    const cy = h * 0.24 + L.safeT;
    ctx.save();
    ctx.globalAlpha = ease;
    ctx.translate(w / 2, cy);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 18 * s;
    ctx.shadowOffsetY = 5 * s;
    ctx.font = `800 ${64 * s}px ${FONT}`;
    ctx.fillStyle = PALETTE.gold;
    const tw = ctx.measureText("Quota met!").width;
    ctx.fillText("Quota met!", 0, 0);
    ctx.font = `700 ${22 * s}px ${FONT}`;
    ctx.fillStyle = PALETTE.creamDim;
    ctx.fillText("The colony eats tonight", 0, 50 * s);
    ctx.restore();

    // Probe box: both lines, CSS px.
    const d = L.dpr;
    this.boxBanner.x = (w / 2 - tw / 2 - 16 * s) / d;
    this.boxBanner.y = (cy - 46 * s) / d;
    this.boxBanner.w = (tw + 32 * s) / d;
    this.boxBanner.h = (96 * s + 22 * s) / d;
    this.hudBoxes.banner = this.boxBanner;
  }
}

// --- helpers -----------------------------------------------------------------

/** Day progress for the track (loop-relative, not raw dayT). */
function dayProgress(inputs: HudInputs): number {
  const span = LOOP_TUNING.dayEndT - LOOP_TUNING.dayStartT;
  return Math.min(1, Math.max(0, (inputs.dayT - LOOP_TUNING.dayStartT) / span));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255;
  const ag = (pa >> 8) & 255;
  const ab = pa & 255;
  const br = (pb >> 16) & 255;
  const bg = (pb >> 8) & 255;
  const bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

/** A golden wheat grain icon: teardrop with a crease and a highlight. */
function drawGrainIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, clock: number): void {
  const tilt = Math.sin(clock * 1.4) * 0.08;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.5 + tilt);
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, "#ffe9a8");
  g.addColorStop(0.55, "#f0b452");
  g.addColorStop(1, "#c9832e");
  ctx.fillStyle = g;
  ctx.shadowColor = "rgba(20,12,2,0.5)";
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.25);
  ctx.bezierCurveTo(r * 0.9, -r * 0.6, r * 0.72, r * 0.7, 0, r * 1.15);
  ctx.bezierCurveTo(-r * 0.72, r * 0.7, -r * 0.9, -r * 0.6, 0, -r * 1.25);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Crease.
  ctx.strokeStyle = "rgba(140,86,22,0.7)";
  ctx.lineWidth = Math.max(1, r * 0.09);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.05);
  ctx.quadraticCurveTo(r * 0.16, 0, 0, r);
  ctx.stroke();
  // Highlight.
  ctx.fillStyle = "rgba(255,252,230,0.85)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.42, r * 0.16, r * 0.34, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Storybook keycap: cream cap, dark letter, soft shadow. Width fits the label. */
function drawKeycap(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, label: string, s: number): void {
  ctx.save();
  ctx.font = `800 ${size * 0.52}px ${FONT}`;
  const w = Math.max(size, ctx.measureText(label).width + size * 0.6);
  const r = 9 * s;
  ctx.shadowColor = PALETTE.shadow;
  ctx.shadowBlur = 7 * s;
  ctx.shadowOffsetY = 3 * s;
  const g = ctx.createLinearGradient(x - w / 2, y - size / 2, x - w / 2, y + size / 2);
  g.addColorStop(0, "#fff1cf");
  g.addColorStop(1, "#e5c489");
  ctx.fillStyle = g;
  roundRect(ctx, x - w / 2, y - size / 2, w, size, Math.min(r, size / 2));
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(122,86,38,0.85)";
  ctx.lineWidth = 1.6 * s;
  roundRect(ctx, x - w / 2, y - size / 2, w, size, Math.min(r, size / 2));
  ctx.stroke();
  ctx.fillStyle = "#5c421e";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + size * 0.04);
  ctx.restore();
}

/** Chip label font — an uppercase verb sized to the keycap row. */
function chipFont(s: number): string {
  return `800 ${13.5 * s}px ${FONT}`;
}

/** Chip letter-spacing on/off (matches the touch buttons' tracked verbs). */
function setChipSpacing(ctx: CanvasRenderingContext2D, s: number, off = false): void {
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = off ? "0px" : `${1.1 * s}px`;
}

/**
 * The touch prompt affordance: a full-radius pill styled like the ready
 * ACTION button (gold gradient face, dark verb, chitin edge) so the prompt
 * reads as "press that button" rather than a keyboard keycap.
 */
function drawActionChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  s: number,
): void {
  ctx.save();
  ctx.font = chipFont(s);
  ctx.shadowColor = PALETTE.shadow;
  ctx.shadowBlur = 7 * s;
  ctx.shadowOffsetY = 3 * s;
  const g = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
  g.addColorStop(0, "#ffe6a3");
  g.addColorStop(0.55, "#f0b954");
  g.addColorStop(1, "#e8a13d");
  ctx.fillStyle = g;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(122,86,38,0.85)";
  ctx.lineWidth = 1.6 * s;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.stroke();
  ctx.fillStyle = "#5c421e";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  setChipSpacing(ctx, s);
  ctx.fillText(label, x, y + h * 0.04);
  setChipSpacing(ctx, s, true);
  ctx.restore();
}
