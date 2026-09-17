import type { Palette, SceneryKind } from "../sim/types";

// OWNER: Agent A. Draws one roadside prop with its base at (x, y) and a
// pixel half-width w (already projection-scaled). Pure draw, no allocation
// per frame. Contract per .plan.md §5.

// Fixed brand accents (see .plan.md §7); everything else derives from the
// palette backdrop so props read as silhouettes against their own sky.
const ACCENT = "#ff5b2e";
const CREAM = "#f5ead6";
const GLOW_WARM = "#ffd98a";
const FOLIAGE_TINT = "#2f8f52";
const TRUNK_TINT = "#7a5236";

interface Shades {
  trunk: string;
  foliage: string;
  foliageDark: string;
  rockLight: string;
  rockDark: string;
  post: string;
  cityBody: string;
  cityDark: string;
  glow: string;
}

// Cached per palette object (stable per level) — no string building per frame.
let shadesPal: Palette | null = null;
let shades: Shades;

function hash1(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(i, i + 2), 16);
  return Number.isNaN(v) ? 0 : v;
}

function byte(v: number): string {
  return Math.round(v < 0 ? 0 : v > 255 ? 255 : v)
    .toString(16)
    .padStart(2, "0");
}

function mixHex(a: string, b: string, t: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(a) || !/^#[0-9a-fA-F]{6}$/.test(b)) return a;
  const r = channel(a, 1) + (channel(b, 1) - channel(a, 1)) * t;
  const g = channel(a, 3) + (channel(b, 3) - channel(a, 3)) * t;
  const bl = channel(a, 5) + (channel(b, 5) - channel(a, 5)) * t;
  return `#${byte(r)}${byte(g)}${byte(bl)}`;
}

/** f < 1 darkens toward black, f > 1 lightens toward white. */
function shadeHex(hex: string, f: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const toWhite = f > 1;
  const k = toWhite ? f - 1 : f;
  const ch = (i: number): number => {
    const v = channel(hex, i);
    return toWhite ? v + (255 - v) * k : v * k;
  };
  return `#${byte(ch(1))}${byte(ch(3))}${byte(ch(5))}`;
}

function getShades(pal: Palette): Shades {
  if (pal === shadesPal) return shades;
  const base = pal.backdrop;
  const foliage = mixHex(base, FOLIAGE_TINT, 0.65);
  shades = {
    trunk: mixHex(base, TRUNK_TINT, 0.5),
    foliage,
    foliageDark: shadeHex(foliage, 0.72),
    rockLight: shadeHex(base, 1.18),
    rockDark: shadeHex(base, 0.78),
    post: shadeHex(base, 0.6),
    cityBody: shadeHex(base, 1.12),
    cityDark: shadeHex(base, 0.85),
    glow: pal.cityGlow ?? GLOW_WARM,
  };
  shadesPal = pal;
  return shades;
}

function quad(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
  color: string,
): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.lineTo(x3, y3);
  g.lineTo(x4, y4);
  g.closePath();
  g.fill();
}

function tri(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  color: string,
): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.lineTo(x3, y3);
  g.closePath();
  g.fill();
}

function drawPalm(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  s: Shades,
  flip: boolean,
): void {
  const H = w * 5.2;
  const bend = flip ? -w * 0.5 : w * 0.5;
  let tx = x;
  let ty = y;
  for (let i = 1; i <= 4; i++) {
    const nx = x + (bend * i) / 4;
    const ny = y - (H * i) / 4;
    const tw = w * 0.16 * (1 - i / 8);
    quad(g, tx - tw, ty, tx + tw, ty, nx + tw, ny, nx - tw, ny, s.trunk);
    tx = nx;
    ty = ny;
  }
  for (let i = 0; i < 7; i++) {
    const dir = i / 3 - 1; // -1..1 across the crown
    const len = w * 2 * (1 - Math.abs(dir) * 0.3);
    tri(
      g,
      tx,
      ty,
      tx + dir * len * 0.5,
      ty - w * 1.05 + Math.abs(dir) * w * 0.35,
      tx + dir * len,
      ty - w * 0.7 + Math.abs(dir) * w * 1.6,
      i % 2 === 0 ? s.foliage : s.foliageDark,
    );
  }
}

function drawPine(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  s: Shades,
): void {
  const H = w * 4.4;
  g.fillStyle = s.trunk;
  g.fillRect(x - w * 0.1, y - H * 0.2, w * 0.2, H * 0.2);
  for (let i = 0; i < 3; i++) {
    const yb = y - H * (0.14 + i * 0.25);
    const yt = yb - H * 0.42;
    const hw = w * (1.05 - i * 0.28);
    tri(g, x - hw, yb, x, yt, x + hw, yb, i === 1 ? s.foliageDark : s.foliage);
  }
}

function drawCactus(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  s: Shades,
  flip: boolean,
): void {
  const H = w * 3.1;
  const side = flip ? -1 : 1;
  g.fillStyle = s.foliage;
  g.fillRect(x - w * 0.18, y - H, w * 0.36, H);
  g.beginPath();
  g.arc(x, y - H, w * 0.18, Math.PI, 0);
  g.fill();
  // Upper arm
  const a1 = y - H * 0.58;
  g.fillRect(x + side * w * 0.18, a1, side * w * 0.46, w * 0.2);
  const a1x = x + side * w * 0.64;
  g.fillRect(side > 0 ? a1x - w * 0.2 : a1x, a1 - H * 0.26, w * 0.2, H * 0.26 + w * 0.2);
  g.beginPath();
  g.arc(a1x - side * w * 0.1, a1 - H * 0.26, w * 0.1, Math.PI, 0);
  g.fill();
  // Lower arm on the opposite side
  const s2 = -side;
  const a2 = y - H * 0.34;
  g.fillRect(x + s2 * w * 0.18, a2, s2 * w * 0.34, w * 0.18);
  const a2x = x + s2 * w * 0.52;
  g.fillRect(s2 > 0 ? a2x - w * 0.18 : a2x, a2 - H * 0.16, w * 0.18, H * 0.16 + w * 0.18);
  g.beginPath();
  g.arc(a2x - s2 * w * 0.09, a2 - H * 0.16, w * 0.09, Math.PI, 0);
  g.fill();
}

function drawRock(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  s: Shades,
  flip: boolean,
): void {
  const H = w * 0.85;
  g.fillStyle = s.rockLight;
  g.beginPath();
  g.moveTo(x - w, y);
  g.lineTo(x - w * 0.55, y - H * 0.8);
  g.lineTo(x - w * 0.05, y - H);
  g.lineTo(x + w * 0.65, y - H * 0.62);
  g.lineTo(x + w, y);
  g.closePath();
  g.fill();
  // Shaded facet on one side (mirrored by flip)
  const d = flip ? -1 : 1;
  g.fillStyle = s.rockDark;
  g.beginPath();
  g.moveTo(x - w * 0.05 * d, y - H);
  g.lineTo(x + w * 0.65 * d, y - H * 0.62);
  g.lineTo(x + w * d, y);
  g.lineTo(x + w * 0.1 * d, y);
  g.closePath();
  g.fill();
}

function drawBush(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  s: Shades,
): void {
  const H = w * 0.95;
  g.fillStyle = s.foliageDark;
  g.beginPath();
  g.arc(x - w * 0.5, y - H * 0.4, w * 0.42, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(x + w * 0.45, y - H * 0.38, w * 0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = s.foliage;
  g.beginPath();
  g.arc(x, y - H * 0.62, w * 0.5, 0, Math.PI * 2);
  g.fill();
}

function drawSign(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  s: Shades,
): void {
  const H = w * 2.3;
  g.fillStyle = s.post;
  g.fillRect(x - w * 0.07, y - H * 0.6, w * 0.14, H * 0.6);
  g.fillRect(x - w * 0.52, y - H, w * 1.04, H * 0.44);
  g.fillStyle = CREAM;
  g.fillRect(x - w * 0.44, y - H * 0.92, w * 0.88, H * 0.28);
  g.fillStyle = ACCENT;
  g.fillRect(x - w * 0.44, y - H * 0.68, w * 0.88, H * 0.06);
  g.fillStyle = s.post;
  g.fillRect(x - w * 0.28, y - H * 0.86, w * 0.4, H * 0.05);
  g.fillRect(x - w * 0.28, y - H * 0.77, w * 0.26, H * 0.04);
}

function drawBillboard(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  s: Shades,
): void {
  const H = w * 2.9;
  g.fillStyle = s.post;
  g.fillRect(x - w * 0.72, y - H * 0.42, w * 0.13, H * 0.42);
  g.fillRect(x + w * 0.59, y - H * 0.42, w * 0.13, H * 0.42);
  g.fillRect(x - w * 1.15, y - H, w * 2.3, H * 0.62);
  g.fillStyle = CREAM;
  g.fillRect(x - w * 1.05, y - H * 0.92, w * 2.1, H * 0.42);
  g.fillStyle = ACCENT;
  g.fillRect(x - w * 1.05, y - H * 0.56, w * 2.1, H * 0.08);
  g.fillStyle = s.post;
  for (let i = 0; i < 4; i++) {
    g.fillRect(x - w * 0.85 + i * w * 0.5, y - H * 0.82, w * 0.32, H * 0.1);
  }
}

function drawLamp(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  s: Shades,
  flip: boolean,
  pal: Palette,
): void {
  const H = w * 4;
  const side = flip ? 1 : -1; // arm reaches toward the road center
  g.fillStyle = s.post;
  g.fillRect(x - w * 0.05, y - H, w * 0.1, H);
  g.fillRect(side < 0 ? x - w * 0.55 : x, y - H, w * 0.55, w * 0.09);
  const headX = x + side * w * 0.55;
  g.fillRect(headX - w * 0.08, y - H, w * 0.16, w * 0.16);
  if (pal.night) {
    g.fillStyle = s.glow;
    g.globalAlpha = 0.22;
    g.beginPath();
    g.arc(headX, y - H + w * 0.3, w * 0.4, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.95;
    g.beginPath();
    g.arc(headX, y - H + w * 0.26, w * 0.12, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }
}

function drawCityBlock(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  s: Shades,
): void {
  const H = w * 2.6;
  const towers: readonly (readonly [number, number, number])[] = [
    [-1.0, 0.72, 0.72],
    [-0.26, 0.88, 1.0],
    [0.58, 0.6, 0.55],
  ];
  for (let t = 0; t < towers.length; t++) {
    const tw = towers[t];
    if (!tw) continue;
    const bx = x + tw[0] * w;
    const bw = tw[1] * w;
    const bh = H * tw[2];
    const by = y - bh;
    g.fillStyle = t === 1 ? s.cityBody : s.cityDark;
    g.fillRect(bx, by, bw, bh);
    g.fillStyle = s.glow;
    const rows = Math.max(2, Math.round(tw[2] * 4));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 2; c++) {
        if (hash1(t * 29 + r * 7 + c * 3) < 0.45) continue;
        g.globalAlpha = 0.55 + hash1(t * 13 + r * 5 + c) * 0.4;
        g.fillRect(bx + bw * (0.18 + c * 0.46), by + bh * (0.1 + (r * 0.78) / rows), bw * 0.2, bh * 0.09);
      }
    }
    g.globalAlpha = 1;
  }
}

export function drawSceneryItem(
  g: CanvasRenderingContext2D,
  kind: SceneryKind,
  x: number,
  y: number,
  w: number,
  palette: Palette,
  flip: boolean,
): void {
  if (w < 0.75) return;
  const s = getShades(palette);
  switch (kind) {
    case "palm":
      drawPalm(g, x, y, w, s, flip);
      break;
    case "pine":
      drawPine(g, x, y, w, s);
      break;
    case "cactus":
      drawCactus(g, x, y, w, s, flip);
      break;
    case "rock":
      drawRock(g, x, y, w, s, flip);
      break;
    case "bush":
      drawBush(g, x, y, w, s);
      break;
    case "sign":
      drawSign(g, x, y, w, s);
      break;
    case "billboard":
      drawBillboard(g, x, y, w, s);
      break;
    case "lamp":
      drawLamp(g, x, y, w, s, flip, palette);
      break;
    case "city":
      drawCityBlock(g, x, y, w, s);
      break;
  }
}
