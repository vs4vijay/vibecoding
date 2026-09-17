import type { RaceState, Rider } from "../sim/types";
import { COMBAT, HUD, SIM } from "../config";
import { clamp } from "../core/math";

// OWNER: Agent D. Canvas HUD in the 1280x720 logical space. Contract per
// .plan.md §5 and §7. Do not change signatures.

export interface HudMeta {
  muted: boolean;
  levelName: string;
}

const INK = "#f5ead6";
const PANEL = "#16101e";
const ORANGE = "#ff5b2e";
const GOLD = "#ffd23c";
const RED = "#ff3b30";
const BLUE = "#3ec6ff";
const OUTLINE = "#0e0c12";
const FONT = '"Arial Black", Impact, sans-serif';
const TAU = Math.PI * 2;

const MPH_MAX = 200;
const GAUGE_START = (135 * Math.PI) / 180;
const GAUGE_SWEEP = (220 * Math.PI) / 180;

interface TextOpts {
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  stroke?: number;
  alpha?: number;
}

function text(
  g: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  o: TextOpts = {},
): void {
  if (o.alpha !== undefined) g.globalAlpha = clamp(o.alpha, 0, 1);
  g.font = `${size}px ${FONT}`;
  g.textAlign = o.align ?? "center";
  g.textBaseline = o.baseline ?? "middle";
  if (o.stroke) {
    g.lineWidth = o.stroke;
    g.lineJoin = "round";
    g.strokeStyle = OUTLINE;
    g.strokeText(str, x, y);
  }
  g.fillStyle = fill;
  g.fillText(str, x, y);
  if (o.alpha !== undefined) g.globalAlpha = 1;
}

/**
 * Draws a skewed panel centered on (x+w/2, y+h/2) and LEAVES the transform
 * active so content drawn with absolute coords rotates with the panel.
 * Callers must g.restore() when done.
 */
function panelTransform(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rot: number,
): void {
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.rotate(rot);
  // Rotate about the panel center but keep absolute screen coords working:
  // the rect and all content are drawn in untransformed coordinates.
  g.translate(-(x + w / 2), -(y + h / 2));
  g.globalAlpha = 0.92;
  g.fillStyle = PANEL;
  g.fillRect(x, y, w, h);
  g.globalAlpha = 1;
  g.lineWidth = 3;
  g.strokeStyle = INK;
  g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const tenth = Math.floor((t * 10) % 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenth}`;
}

// --- Speedo (bottom-left) ---------------------------------------------------

function drawSpeedo(g: CanvasRenderingContext2D, state: RaceState): void {
  const cx = 148;
  const cy = 592;
  const R = 92;
  g.save();
  // dial plate
  g.beginPath();
  g.arc(cx, cy, R + 18, 0, TAU);
  g.globalAlpha = 0.9;
  g.fillStyle = PANEL;
  g.fill();
  g.globalAlpha = 1;
  g.lineWidth = 3;
  g.strokeStyle = INK;
  g.stroke();
  // track arc
  g.lineWidth = 9;
  g.strokeStyle = "rgba(245,234,214,0.18)";
  g.beginPath();
  g.arc(cx, cy, R, GAUGE_START, GAUGE_START + GAUGE_SWEEP);
  g.stroke();
  // red zone (> 85%)
  g.strokeStyle = RED;
  g.beginPath();
  g.arc(cx, cy, R, GAUGE_START + GAUGE_SWEEP * 0.85, GAUGE_START + GAUGE_SWEEP);
  g.stroke();
  // ticks every 20 mph, majors every 40
  for (let i = 0; i <= 10; i++) {
    const a = GAUGE_START + (GAUGE_SWEEP * i) / 10;
    const major = i % 2 === 0;
    const r1 = R - (major ? 14 : 8);
    const r2 = R - 3;
    g.strokeStyle = major ? INK : "rgba(245,234,214,0.55)";
    g.lineWidth = major ? 3 : 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    g.stroke();
  }
  // needle
  const mph = Math.max(0, state.player.speed / HUD.mphDivisor);
  const f = clamp(mph / MPH_MAX, 0, 1);
  const na = GAUGE_START + GAUGE_SWEEP * f;
  g.strokeStyle = ORANGE;
  g.lineWidth = 5;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(cx - Math.cos(na) * 16, cy - Math.sin(na) * 16);
  g.lineTo(cx + Math.cos(na) * (R - 18), cy + Math.sin(na) * (R - 18));
  g.stroke();
  g.lineCap = "butt";
  // hub
  g.beginPath();
  g.arc(cx, cy, 7, 0, TAU);
  g.fillStyle = GOLD;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = OUTLINE;
  g.stroke();
  // digital mph
  text(g, String(Math.round(mph)), cx, cy + 46, 34, INK, { stroke: 5 });
  text(g, "MPH", cx, cy + 70, 12, ORANGE);
  g.restore();
}

// --- Position panel (top-left) ----------------------------------------------

function drawPosition(g: CanvasRenderingContext2D, state: RaceState, meta: HudMeta): void {
  const x = 20;
  const y = 16;
  const w = 310;
  const h = 76;
  g.save();
  panelTransform(g, x, y, w, h, -0.018);
  const place = state.player.place > 0 ? state.player.place : state.totalRacers;
  text(g, `${place}/${state.totalRacers}`, x + 22, y + h / 2, 40, ORANGE, {
    align: "left",
    stroke: 6,
  });
  text(g, "RACE", x + 160, y + 27, 13, "rgba(245,234,214,0.75)", { align: "left" });
  text(g, meta.levelName, x + 160, y + 51, 14, INK, { align: "left" });
  g.restore();
}

// --- Progress bar (top-center) ----------------------------------------------

function drawProgress(g: CanvasRenderingContext2D, state: RaceState): void {
  const w = 460;
  const h = 12;
  const rot = -0.015;
  const finishZ = (state.track.finishIndex + 1) * SIM.segmentLength;
  g.save();
  g.translate(640, 44);
  g.rotate(rot);
  g.globalAlpha = 0.88;
  g.fillStyle = PANEL;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.globalAlpha = 1;
  g.lineWidth = 3;
  g.strokeStyle = INK;
  g.strokeRect(-w / 2, -h / 2, w, h);
  const frac = clamp(state.player.z / finishZ, 0, 1);
  if (frac > 0) {
    g.fillStyle = ORANGE;
    g.fillRect(-w / 2 + 3, -h / 2 + 3, (w - 6) * frac, h - 6);
  }
  // rival ticks (colored by rider)
  for (const r of state.rivals) {
    const rf = clamp(r.z / finishZ, 0, 1);
    const tx = -w / 2 + 4 + (w - 8) * rf;
    g.fillStyle = r.color;
    g.fillRect(tx - 2, -h / 2 - 8, 4, 8);
  }
  // player chevron below the bar
  const px = -w / 2 + 4 + (w - 8) * frac;
  g.fillStyle = GOLD;
  g.beginPath();
  g.moveTo(px, h / 2 + 4);
  g.lineTo(px - 7, h / 2 + 13);
  g.lineTo(px + 7, h / 2 + 13);
  g.closePath();
  g.fill();
  // finish flag at the end
  g.fillStyle = INK;
  g.fillRect(w / 2 - 4, -h / 2 - 27, 3, 27);
  for (let iy = 0; iy < 2; iy++) {
    for (let ix = 0; ix < 4; ix++) {
      g.fillStyle = (ix + iy) % 2 === 0 ? INK : "#16101e";
      g.fillRect(w / 2 - 1 + ix * 5, -h / 2 - 27 + iy * 5, 5, 5);
    }
  }
  g.restore();
}

// --- Player HP bar (top-right) ----------------------------------------------

function drawHp(g: CanvasRenderingContext2D, state: RaceState): void {
  const w = 250;
  const h = 52;
  const x = 1280 - 20 - w;
  const y = 16;
  g.save();
  panelTransform(g, x, y, w, h, 0.02);
  text(g, "RIDER", x + 16, y + 17, 13, ORANGE, { align: "left" });
  const hp = Math.max(0, state.player.hp);
  const low = hp < 30;
  const flash = low && Math.floor(state.time * 6) % 2 === 0;
  const cellColor = low ? (flash ? RED : "#7a1d18") : hp < 60 ? GOLD : INK;
  const cells = 10;
  const cw = 18;
  const gap = 3;
  const total = cells * cw + (cells - 1) * gap;
  const sx = x + w - 16 - total;
  const filled = Math.ceil((clamp(hp, 0, 100) / 100) * cells);
  for (let i = 0; i < cells; i++) {
    const cx0 = sx + i * (cw + gap);
    if (i < filled) {
      g.fillStyle = cellColor;
      g.fillRect(cx0, y + 30, cw, 14);
    } else {
      g.strokeStyle = "rgba(245,234,214,0.35)";
      g.lineWidth = 2;
      g.strokeRect(cx0 + 1, y + 31, cw - 2, 12);
    }
  }
  g.restore();
}

// --- Nearest rival mini HP (bottom-right) ------------------------------------

function drawRivalBar(g: CanvasRenderingContext2D, state: RaceState): void {
  const p = state.player;
  let best: Rider | null = null;
  let bestDz = Infinity;
  for (const r of state.rivals) {
    const dz = Math.abs(r.z - p.z);
    if (dz <= COMBAT.rangeZ * 2 && dz < bestDz) {
      best = r;
      bestDz = dz;
    }
  }
  if (!best) return;
  const w = 300;
  const h = 66;
  const x = 1280 - 20 - w;
  const y = 720 - 18 - h;
  g.save();
  panelTransform(g, x, y, w, h, 0.015);
  text(g, best.name, x + 18, y + 20, 16, best.color, { align: "left", stroke: 4 });
  const bw = 190;
  const bx = x + w - 18 - bw;
  const by = y + 12;
  g.fillStyle = "#2a2136";
  g.fillRect(bx, by, bw, 12);
  g.lineWidth = 2;
  g.strokeStyle = INK;
  g.strokeRect(bx, by, bw, 12);
  const hf = clamp(best.hp / 100, 0, 1);
  g.fillStyle = hf < 0.3 ? RED : GOLD;
  g.fillRect(bx + 2, by + 2, (bw - 4) * hf, 8);
  const dx = best.x - p.x;
  const inStrike =
    bestDz <= COMBAT.rangeZ &&
    Math.abs(dx) >= COMBAT.minSideGap &&
    Math.abs(dx) <= COMBAT.maxSideGap;
  if (inStrike) {
    if (Math.floor(state.time * 5) % 2 === 0) {
      const side = dx > 0 ? "K →" : "← J";
      text(g, `PUNCH ${side}`, x + 18, y + 46, 15, GOLD, { align: "left", stroke: 4 });
    }
  } else {
    text(g, `HP ${Math.round(best.hp)}`, x + 18, y + 46, 13, "rgba(245,234,214,0.8)", {
      align: "left",
    });
  }
  g.restore();
}

// --- Center stage: countdown / GO / toasts -----------------------------------

function drawCenter(g: CanvasRenderingContext2D, state: RaceState): void {
  if (state.phase === "countdown") {
    const n = Math.min(3, Math.ceil(state.countdown));
    const frac = state.countdown - Math.floor(state.countdown);
    const pop = clamp((frac - 0.6) / 0.4, 0, 1);
    const scale = 1 + 0.5 * pop;
    g.save();
    g.translate(640, 300);
    g.scale(scale, scale);
    const str = String(n);
    g.font = `150px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 16;
    g.lineJoin = "round";
    g.strokeStyle = OUTLINE;
    g.strokeText(str, 0, 0);
    g.lineWidth = 7;
    g.strokeStyle = ORANGE;
    g.strokeText(str, 0, 0);
    g.fillStyle = INK;
    g.fillText(str, 0, 0);
    g.restore();
    return;
  }
  if (state.phase === "racing" && state.time < 0.9) {
    const k = clamp(state.time / 0.9, 0, 1);
    g.save();
    g.globalAlpha = 1 - k;
    g.translate(640, 300);
    g.scale(1 + k * 0.7, 1 + k * 0.7);
    text(g, "GO!", 0, 0, 130, GOLD, { stroke: 12 });
    g.restore();
  }
}

function drawToasts(g: CanvasRenderingContext2D, state: RaceState): void {
  let bigs = 0;
  let smalls = 0;
  const list = state.toasts;
  for (let i = 0; i < list.length; i++) {
    const t = list[i]!;
    const lifeFrac = clamp(t.t / HUD.toastTime, 0, 1);
    const alpha = clamp(t.t / 0.4, 0, 1);
    const rise = (1 - lifeFrac) * 14;
    g.save();
    g.globalAlpha = alpha;
    if (t.big) {
      text(g, t.text, 640, 150 - bigs * 62 + rise, 44, ORANGE, { stroke: 9 });
      bigs++;
    } else {
      text(g, t.text, 640, 132 - smalls * 40 + rise, 24, INK, { stroke: 6 });
      smalls++;
    }
    g.restore();
  }
}

// --- Endings ------------------------------------------------------------------

function drawEnding(g: CanvasRenderingContext2D, state: RaceState): void {
  if (state.phase === "finished") {
    g.save();
    panelTransform(g, 640 - 190, 86, 380, 54, -0.01);
    text(g, `FINISHED — P${state.player.place}`, 0, 0, 24, GOLD, { stroke: 6 });
    g.restore();
    return;
  }
  if (state.phase !== "busted" && state.phase !== "wrecked") return;
  const busted = state.phase === "busted";
  const pulse = 0.3 + 0.18 * Math.sin(state.time * 9);
  const grad = g.createRadialGradient(640, 360, 220, 640, 360, 780);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, busted ? `rgba(28,79,216,${pulse.toFixed(3)})` : `rgba(216,28,28,${pulse.toFixed(3)})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 1280, 720);
  g.save();
  g.translate(640, 340);
  g.rotate(-0.09);
  text(g, busted ? "BUSTED!" : "WRECKED!", 0, 0, 110, busted ? BLUE : RED, { stroke: 14 });
  g.restore();
}

// --- Mute glyph (top-right corner) --------------------------------------------

function drawMute(g: CanvasRenderingContext2D, muted: boolean): void {
  if (!muted) return;
  const x = 1236;
  const y = 76;
  g.save();
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(x, y + 5);
  g.lineTo(x + 5, y + 5);
  g.lineTo(x + 11, y);
  g.lineTo(x + 11, y + 16);
  g.lineTo(x + 5, y + 11);
  g.lineTo(x, y + 11);
  g.closePath();
  g.fill();
  g.strokeStyle = RED;
  g.lineWidth = 3;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x + 14, y + 3);
  g.lineTo(x + 21, y + 13);
  g.moveTo(x + 21, y + 3);
  g.lineTo(x + 14, y + 13);
  g.stroke();
  g.restore();
}

/**
 * Draws: analog speedo arc + digital mph (HUD.mphDivisor), place X/N, race
 * progress bar with rival ticks + finish flag, player HP bar, nearest-rival
 * mini HP bar, countdown numerals / "GO", toasts (state.toasts), busted-
 * cop warning flash, mute icon. Handles phase "finished" banner minimally —
 * full results live in the DOM overlay.
 */
export function renderHud(
  g: CanvasRenderingContext2D,
  state: RaceState,
  meta: HudMeta,
): void {
  drawSpeedo(g, state);
  drawPosition(g, state, meta);
  drawProgress(g, state);
  drawHp(g, state);
  drawRivalBar(g, state);
  drawCenter(g, state);
  drawToasts(g, state);
  drawEnding(g, state);
  drawMute(g, meta.muted);
}
