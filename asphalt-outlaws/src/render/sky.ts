import type { CameraView } from "./road";
import type { Palette, RaceState } from "../sim/types";
import { SIM } from "../config";
import { clamp } from "../core/math";

// OWNER: Agent A. Sky gradient + parallax backdrop silhouettes, driven by the
// level palette and camera curve offset. Contract per .plan.md §5.

const CURVE_PARALLAX = 14; // px of backdrop shift per unit of segment curve

/** Deterministic 0..1 hash so backdrop shapes are stable across frames. */
function hash1(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(i, i + 2), 16);
  return Number.isNaN(v) ? 0 : v;
}

function byte(v: number): string {
  return Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
}

function isHex(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

/** Blend two #rrggbb colors; falls back to `a` on malformed input. */
function mixHex(a: string, b: string, t: number): string {
  if (!isHex(a) || !isHex(b)) return a;
  const r = channel(a, 1) + (channel(b, 1) - channel(a, 1)) * t;
  const g = channel(a, 3) + (channel(b, 3) - channel(a, 3)) * t;
  const bl = channel(a, 5) + (channel(b, 5) - channel(a, 5)) * t;
  return `#${byte(r)}${byte(g)}${byte(bl)}`;
}

/** One layer of triangle peaks rising from the horizon. Single path fill. */
function drawRidge(
  g: CanvasRenderingContext2D,
  width: number,
  baseY: number,
  offset: number,
  amp: number,
  spacing: number,
  color: string,
  seed: number,
): void {
  g.fillStyle = color;
  g.beginPath();
  const k0 = Math.floor(offset / spacing) - 1;
  const count = Math.ceil(width / spacing) + 3;
  for (let i = 0; i < count; i++) {
    const k = k0 + i;
    const px = k * spacing - offset;
    const h = amp * (0.45 + 0.55 * hash1(k * 2.7 + seed));
    const half = spacing * (0.55 + 0.25 * hash1(k * 5.1 + seed));
    g.moveTo(px - half, baseY + 2);
    g.lineTo(px, baseY - h);
    g.lineTo(px + half, baseY + 2);
  }
  g.fill();
}

/** Dusk city skyline with deterministically lit windows. */
function drawCity(
  g: CanvasRenderingContext2D,
  width: number,
  height: number,
  horizon: number,
  offset: number,
  pal: Palette,
): void {
  const glow = pal.cityGlow ?? pal.lane;
  const body = mixHex(pal.backdrop, pal.haze, 0.12);
  g.globalAlpha = 0.16;
  g.fillStyle = glow;
  g.fillRect(0, horizon - height * 0.05, width, height * 0.05);
  g.globalAlpha = 1;

  const spacing = 96;
  const k0 = Math.floor(offset / spacing) - 1;
  const count = Math.ceil(width / spacing) + 2;
  for (let i = 0; i < count; i++) {
    const k = k0 + i;
    const bx = k * spacing - offset;
    const bw = spacing * (0.55 + 0.3 * hash1(k * 3.3 + 7));
    const bh = height * (0.07 + 0.2 * hash1(k * 7.7 + 3));
    const by = horizon - bh;
    g.fillStyle = body;
    g.fillRect(bx, by, bw, bh + 2);
    g.fillStyle = glow;
    const cols = Math.max(2, Math.floor(bw / 16));
    const rows = Math.max(2, Math.floor(bh / 20));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (hash1(k * 131 + r * 17 + c * 7) < 0.55) continue;
        g.globalAlpha = 0.3 + 0.5 * hash1(k + r * 3 + c);
        g.fillRect(bx + 3 + (c * (bw - 6)) / cols, by + 4 + (r * (bh - 8)) / rows, 3, 4);
      }
    }
    g.globalAlpha = 1;
  }
}

export function renderSky(
  g: CanvasRenderingContext2D,
  state: RaceState,
  cam: CameraView,
): void {
  const width = cam.width;
  const height = cam.height;
  const pal = state.cfg.level.palette;
  const segs = state.track.segments;
  const n = segs.length;

  // Horizon = projection of the world point at the far end of the draw
  // range, so the backdrop sits exactly where the road fades into haze.
  let horizon = height / 2;
  if (n > 0) {
    const farSeg = segs[clamp(cam.baseSegment + SIM.drawDistance, 0, n - 1)];
    if (farSeg) {
      const zFar = farSeg.p1.world.z - cam.camZ;
      if (zFar > 1) {
        horizon =
          height / 2 -
          ((cam.camDepth / zFar) * (farSeg.p1.world.y - cam.camY) * height) / 2;
      }
    }
  }
  horizon = clamp(horizon, height * 0.3, height * 0.7);

  const baseSeg = n > 0 ? segs[clamp(cam.baseSegment, 0, n - 1)] : undefined;
  const par = -(baseSeg ? baseSeg.curve : 0) * CURVE_PARALLAX;

  const grad = g.createLinearGradient(0, 0, 0, horizon);
  grad.addColorStop(0, pal.skyTop);
  grad.addColorStop(1, pal.skyBottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, width, horizon + 1);

  if (pal.night) {
    g.fillStyle = pal.rumbleLight;
    for (let i = 0; i < 42; i++) {
      g.globalAlpha = 0.2 + hash1(i * 11 + 9) * 0.45;
      g.fillRect(hash1(i * 3 + 1) * width, hash1(i * 7 + 5) * horizon * 0.8, 2, 2);
    }
    g.globalAlpha = 1;
  }

  if (pal.sun) {
    const sunX = width * 0.74 + par * 2;
    const sunY = horizon - height * 0.24;
    const r = height * 0.055;
    g.fillStyle = pal.sun;
    g.globalAlpha = 0.32;
    g.beginPath();
    g.arc(sunX, sunY, r * 2, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(sunX, sunY, r, 0, Math.PI * 2);
    g.fill();
  }

  if (pal.cityGlow) {
    drawCity(g, width, height, horizon, par, pal);
  } else {
    drawRidge(g, width, horizon, par * 0.5, height * 0.11, 170, mixHex(pal.backdrop, pal.haze, 0.55), 17);
    if (pal.water) {
      // Distant sea band in front of the far ridge, behind the headlands.
      g.fillStyle = pal.water;
      g.fillRect(0, horizon - height * 0.035, width, height * 0.035);
      g.globalAlpha = 0.4;
      g.fillStyle = pal.haze;
      g.fillRect(0, horizon - height * 0.035, width, 2);
      g.globalAlpha = 1;
    }
    drawRidge(g, width, horizon, par, height * 0.17, 250, mixHex(pal.backdrop, pal.haze, 0.18), 91);
  }

  // Ground base below the horizon; the road pass paints over it (and any
  // gap between the last drawn segment and the horizon reads as haze).
  g.fillStyle = pal.haze;
  g.fillRect(0, horizon, width, height - horizon);
}
