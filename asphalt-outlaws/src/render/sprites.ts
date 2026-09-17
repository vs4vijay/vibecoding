import type { TrafficKind } from "../sim/types";

// OWNER: Agent D. Procedural, cached sprite canvases (no binary assets).
// Contract per .plan.md §5 and §7. Do not change signatures.

export type RiderPose =
  | "ride"
  | "lean-l"
  | "lean-r"
  | "punch-l"
  | "punch-r"
  | "kick-l"
  | "kick-r"
  | "hit"
  | "down";

// Chunky 90s-arcade outline color shared by all sprites.
const OUTLINE = "#101018";
const GLASS = "#1d2733";
const TIRE = "#14141a";
const RIM = "#3c3c47";
const CHROME = "#b9bec8";
const CLOTH = "#26262e";
const BOOT = "#191920";

function shade(hex: string, amt: number): string {
  let n = hex.replace("#", "");
  if (n.length === 3) n = n[0]! + n[0]! + n[1]! + n[1]! + n[2]! + n[2]!;
  const num = Number.parseInt(n, 16);
  if (!Number.isFinite(num) || n.length !== 6) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const f = (c: number): number => {
    const v = amt >= 0 ? c + (255 - c) * amt : c * (1 + amt);
    return Math.round(Math.min(255, Math.max(0, v)));
  };
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d");
  if (!g) throw new Error("canvas 2d context unavailable");
  return g;
}

function rrect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function fillStroke(g: CanvasRenderingContext2D, fill: string, lw = 3): void {
  g.fillStyle = fill;
  g.fill();
  if (lw > 0) {
    g.lineWidth = lw;
    g.strokeStyle = OUTLINE;
    g.stroke();
  }
}

function blob(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
  lw = 3,
): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  fillStroke(g, fill, lw);
}

function limb(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  w: number,
  color: string,
): void {
  g.beginPath();
  g.moveTo(x1, y1);
  g.quadraticCurveTo(cx, cy, x2, y2);
  g.lineWidth = w;
  g.lineCap = "round";
  g.strokeStyle = color;
  g.stroke();
  g.lineCap = "butt";
}

// ---------------------------------------------------------------------------
// Rider + motorcycle, rear view. All painters draw with the origin at the
// tire contact patch (ground center), y negative = up.
// ---------------------------------------------------------------------------

interface BodyOpts {
  twist?: number;
  armsUp?: boolean;
  flinch?: number;
  punchSide?: -1 | 1;
  kickSide?: -1 | 1;
}

function paintBikeRear(g: CanvasRenderingContext2D, color: string): void {
  blob(g, 0, -30, 26, 30, TIRE);
  blob(g, 0, -30, 12, 15, RIM, 2);
  // exhausts
  rrect(g, -43, -46, 14, 32, 6);
  fillStroke(g, CHROME, 2.5);
  rrect(g, 29, -46, 14, 32, 6);
  fillStroke(g, CHROME, 2.5);
  // seat base
  rrect(g, -27, -64, 54, 14, 6);
  fillStroke(g, "#1d1d26", 2.5);
  // fender + taillight
  rrect(g, -27, -74, 54, 18, 8);
  fillStroke(g, shade(color, -0.4));
  g.fillStyle = "#ff2f1f";
  g.fillRect(-9, -72, 18, 9);
  g.fillStyle = "#ffb4a6";
  g.fillRect(-5, -70, 7, 4);
  // tail fairing
  g.beginPath();
  g.moveTo(-34, -66);
  g.lineTo(34, -66);
  g.lineTo(25, -114);
  g.lineTo(-25, -114);
  g.closePath();
  fillStroke(g, color);
  // license plate
  rrect(g, -12, -88, 24, 12, 3);
  fillStroke(g, "#f0e8d0", 2);
}

function paintRiderBody(
  g: CanvasRenderingContext2D,
  color: string,
  accent: string,
  opts: BodyOpts,
): void {
  const twist = opts.twist ?? 0;
  const flinch = opts.flinch ?? 0;
  // torso
  g.beginPath();
  g.moveTo(-27, -106);
  g.lineTo(27, -106);
  g.lineTo(21 + twist, -170);
  g.lineTo(-21 + twist, -170);
  g.closePath();
  fillStroke(g, accent);
  // racing stripe in bike color
  g.fillStyle = color;
  g.fillRect(-7 + twist, -158, 14, 44);
  // belt line
  g.fillStyle = shade(accent, -0.45);
  g.fillRect(-27, -114, 54, 9);
  // kick leg swings out over the fairing
  if (opts.kickSide) {
    const s = opts.kickSide;
    limb(g, s * 12, -112, s * 52, -96, s * 92, -70, 16, "#1e1e28");
    g.save();
    g.translate(s * 100, -66);
    g.rotate(s * 0.5);
    rrect(g, -12, -9, 26, 16, 5);
    fillStroke(g, BOOT, 2.5);
    g.restore();
  }
  // shoulders + neck + helmet
  blob(g, twist, -166 + flinch, 28, 12, shade(accent, -0.12));
  g.fillStyle = "#191920";
  g.fillRect(-9 + twist, -180 + flinch * 1.5, 18, 12);
  blob(g, twist, -196 + flinch * 2, 23, 23, shade(accent, 0.28));
  g.fillStyle = shade(accent, -0.5);
  g.fillRect(twist - 21, -203 + flinch * 2, 42, 8);
  rrect(g, twist - 20, -180 + flinch * 1.5, 40, 8, 3);
  fillStroke(g, "#12121a", 2);
  // arms
  const glove = shade(accent, -0.3);
  const drawArm = (s: -1 | 1): void => {
    if (opts.punchSide === s) {
      limb(g, s * 22 + twist, -162, s * 70, -158, s * 112, -150, 14, CLOTH);
      blob(g, s * 120, -150, 11, 11, shade(accent, -0.25), 2.5);
      return;
    }
    if (opts.armsUp) {
      limb(g, s * 24 + twist, -164 + flinch, s * 40, -196, s * 44, -206, 13, CLOTH);
      blob(g, s * 46, -210, 9, 9, glove, 2.5);
      return;
    }
    limb(g, s * 24 + twist, -162, s * 42, -148, s * 40, -118, 13, CLOTH);
    blob(g, s * 40, -114, 8, 8, glove, 2.5);
  };
  drawArm(-1);
  drawArm(1);
}

function paintDown(g: CanvasRenderingContext2D, color: string, accent: string): void {
  // bike on its side (left)...
  blob(g, -88, -28, 27, 27, TIRE);
  blob(g, -88, -28, 12, 12, RIM, 2);
  rrect(g, -92, -52, 84, 26, 9);
  fillStroke(g, shade(color, -0.15));
  g.beginPath();
  g.moveTo(-16, -50);
  g.lineTo(-2, -86);
  g.lineWidth = 7;
  g.lineCap = "round";
  g.strokeStyle = CLOTH;
  g.stroke();
  g.lineCap = "butt";
  // ...rider splayed to the right, tumbling
  g.save();
  g.translate(46, -56);
  g.rotate(0.42);
  rrect(g, -22, -34, 44, 62, 14);
  fillStroke(g, accent);
  g.fillStyle = color;
  g.fillRect(-7, -22, 14, 40);
  blob(g, 0, -48, 20, 20, shade(accent, 0.28));
  g.fillStyle = shade(accent, -0.5);
  g.fillRect(-18, -54, 36, 7);
  g.restore();
  const glove = shade(accent, -0.3);
  limb(g, 30, -80, 6, -104, -12, -112, 12, CLOTH);
  blob(g, -16, -114, 8, 8, glove, 2.5);
  limb(g, 62, -82, 92, -108, 104, -114, 12, CLOTH);
  blob(g, 108, -116, 8, 8, glove, 2.5);
  limb(g, 32, -34, 8, -16, -2, -8, 13, "#1e1e28");
  limb(g, 60, -34, 88, -18, 100, -12, 13, "#1e1e28");
  blob(g, -6, -6, 9, 8, BOOT, 2);
  blob(g, 104, -10, 9, 8, BOOT, 2);
}

function paintRider(
  g: CanvasRenderingContext2D,
  pose: RiderPose,
  color: string,
  accent: string,
): void {
  g.lineJoin = "round";
  switch (pose) {
    case "ride":
      paintBikeRear(g, color);
      paintRiderBody(g, color, accent, {});
      break;
    case "lean-l":
    case "lean-r": {
      // 14 degrees of lean around the contact patch.
      const lean = 0.244;
      g.save();
      g.rotate(pose === "lean-l" ? -lean : lean);
      paintBikeRear(g, color);
      paintRiderBody(g, color, accent, { twist: pose === "lean-l" ? -4 : 4 });
      g.restore();
      break;
    }
    case "punch-l":
      paintBikeRear(g, color);
      paintRiderBody(g, color, accent, { punchSide: -1, twist: -6 });
      break;
    case "punch-r":
      paintBikeRear(g, color);
      paintRiderBody(g, color, accent, { punchSide: 1, twist: 6 });
      break;
    case "kick-l":
      paintBikeRear(g, color);
      paintRiderBody(g, color, accent, { kickSide: -1 });
      break;
    case "kick-r":
      paintBikeRear(g, color);
      paintRiderBody(g, color, accent, { kickSide: 1 });
      break;
    case "hit":
      paintBikeRear(g, color);
      paintRiderBody(g, color, accent, { armsUp: true, flinch: 5 });
      break;
    case "down":
      paintDown(g, color, accent);
      break;
  }
}

const riderCache = new Map<string, HTMLCanvasElement>();
const RIDER_W = 340;
const RIDER_H = 240;
const RIDER_GROUND = 228;
const RIDER_CX = 170;

/**
 * Cached offscreen canvas of a rider + bike seen from behind, ~256px tall at
 * scale 1, keyed by pose + colors. Drawn with drawImage at projection scale.
 */
export function getRiderSprite(
  pose: RiderPose,
  color: string,
  accent: string,
): HTMLCanvasElement {
  const key = `${pose}|${color}|${accent}`;
  const hit = riderCache.get(key);
  if (hit) return hit;
  const c = makeCanvas(RIDER_W, RIDER_H);
  const g = ctx2d(c);
  g.translate(RIDER_CX, RIDER_GROUND);
  paintRider(g, pose, color, accent);
  riderCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------
// Traffic, rear (dir 1) and front (dir -1) views. Origin: top-left of canvas.
// ---------------------------------------------------------------------------

function paintCar(g: CanvasRenderingContext2D, color: string, front: boolean): void {
  // wheels
  rrect(g, 42, 158, 54, 34, 8);
  fillStroke(g, TIRE, 2.5);
  rrect(g, 244, 158, 54, 34, 8);
  fillStroke(g, TIRE, 2.5);
  // body
  rrect(g, 24, 64, 292, 114, 16);
  fillStroke(g, color);
  g.strokeStyle = shade(color, -0.32);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(36, 96);
  g.lineTo(304, 96);
  g.stroke();
  // cabin + glass
  rrect(g, 72, 16, 196, 74, 14);
  fillStroke(g, shade(color, -0.18));
  rrect(g, 88, 26, 164, 48, 9);
  fillStroke(g, GLASS, 2.5);
  g.fillStyle = "rgba(255,255,255,0.16)";
  g.beginPath();
  g.moveTo(100, 74);
  g.lineTo(140, 26);
  g.lineTo(166, 26);
  g.lineTo(126, 74);
  g.closePath();
  g.fill();
  // bumper
  rrect(g, 24, 148, 292, 28, 9);
  fillStroke(g, shade(color, -0.48));
  if (front) {
    rrect(g, 40, 106, 46, 24, 6);
    fillStroke(g, "#ffe97a", 2.5);
    g.fillStyle = "#fff7c8";
    g.fillRect(46, 111, 22, 10);
    rrect(g, 254, 106, 46, 24, 6);
    fillStroke(g, "#ffe97a", 2.5);
    g.fillStyle = "#fff7c8";
    g.fillRect(272, 111, 22, 10);
    rrect(g, 128, 104, 84, 28, 5);
    fillStroke(g, "#23232c", 2.5);
    g.fillStyle = "#101016";
    for (let i = 0; i < 3; i++) g.fillRect(134, 110 + i * 8, 72, 4);
  } else {
    rrect(g, 40, 102, 46, 26, 6);
    fillStroke(g, "#ff2418", 2.5);
    g.fillStyle = "#ffb4a6";
    g.fillRect(47, 108, 20, 10);
    rrect(g, 254, 102, 46, 26, 6);
    fillStroke(g, "#ff2418", 2.5);
    g.fillStyle = "#ffb4a6";
    g.fillRect(272, 108, 20, 10);
  }
  rrect(g, 146, 122, 48, 22, 3);
  fillStroke(g, "#f0e8d0", 2);
}

function paintTruck(g: CanvasRenderingContext2D, color: string, front: boolean): void {
  for (const wx of [40, 96, 218, 274]) {
    rrect(g, wx, 186, 46, 36, 7);
    fillStroke(g, TIRE, 2.5);
  }
  // box
  rrect(g, 18, 14, 324, 160, 7);
  fillStroke(g, color);
  g.strokeStyle = shade(color, -0.28);
  g.lineWidth = 3;
  for (const sx of [98, 180, 262]) {
    g.beginPath();
    g.moveTo(sx, 24);
    g.lineTo(sx, 164);
    g.stroke();
  }
  // roof marker lights
  for (const mx of [118, 172, 226]) {
    rrect(g, mx, 8, 15, 11, 2);
    fillStroke(g, "#ffb02e", 2);
  }
  if (front) {
    rrect(g, 44, 34, 272, 52, 8);
    fillStroke(g, GLASS, 2.5);
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.fillRect(150, 38, 20, 44);
    rrect(g, 30, 122, 42, 26, 6);
    fillStroke(g, "#ffe97a", 2.5);
    rrect(g, 288, 122, 42, 26, 6);
    fillStroke(g, "#ffe97a", 2.5);
    g.fillStyle = "#fff7c8";
    g.fillRect(36, 128, 18, 10);
    g.fillRect(300, 128, 18, 10);
    rrect(g, 140, 114, 80, 34, 5);
    fillStroke(g, "#23232c", 2.5);
  } else {
    g.strokeStyle = shade(color, -0.4);
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(180, 20);
    g.lineTo(180, 168);
    g.stroke();
    rrect(g, 26, 138, 28, 20, 4);
    fillStroke(g, "#ff2418", 2);
    rrect(g, 306, 138, 28, 20, 4);
    fillStroke(g, "#ff2418", 2);
    rrect(g, 162, 138, 36, 20, 3);
    fillStroke(g, "#f0e8d0", 2);
  }
  // underride bar + mud flaps
  rrect(g, 30, 178, 300, 10, 4);
  fillStroke(g, "#2a2a33", 2);
  rrect(g, 44, 192, 32, 28, 4);
  fillStroke(g, BOOT, 2.5);
  rrect(g, 284, 192, 32, 28, 4);
  fillStroke(g, BOOT, 2.5);
}

function paintBus(g: CanvasRenderingContext2D, color: string, front: boolean): void {
  rrect(g, 46, 204, 52, 38, 8);
  fillStroke(g, TIRE, 2.5);
  rrect(g, 262, 204, 52, 38, 8);
  fillStroke(g, TIRE, 2.5);
  // body + roof strip
  rrect(g, 16, 12, 328, 214, 12);
  fillStroke(g, color);
  g.fillStyle = shade(color, -0.38);
  g.fillRect(20, 16, 320, 14);
  for (const mx of [64, 132, 200, 268]) {
    rrect(g, mx, 18, 14, 9, 2);
    fillStroke(g, "#ffb02e", 1.5);
  }
  if (front) {
    rrect(g, 122, 38, 116, 20, 4);
    fillStroke(g, "#14141a", 2);
    rrect(g, 36, 66, 138, 66, 8);
    fillStroke(g, GLASS, 2.5);
    rrect(g, 186, 66, 138, 66, 8);
    fillStroke(g, GLASS, 2.5);
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.fillRect(52, 70, 16, 58);
    g.fillRect(202, 70, 16, 58);
    rrect(g, 36, 166, 38, 24, 6);
    fillStroke(g, "#ffe97a", 2.5);
    rrect(g, 286, 166, 38, 24, 6);
    fillStroke(g, "#ffe97a", 2.5);
    g.fillStyle = "#fff7c8";
    g.fillRect(42, 171, 16, 9);
    g.fillRect(298, 171, 16, 9);
  } else {
    rrect(g, 36, 56, 288, 70, 8);
    fillStroke(g, GLASS, 2.5);
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.fillRect(150, 60, 18, 62);
    rrect(g, 120, 150, 120, 42, 6);
    fillStroke(g, shade(color, -0.3), 2.5);
    g.fillStyle = shade(color, -0.45);
    for (let i = 0; i < 4; i++) g.fillRect(130, 158 + i * 9, 100, 4);
    rrect(g, 24, 130, 16, 48, 4);
    fillStroke(g, "#ff2418", 2);
    rrect(g, 320, 130, 16, 48, 4);
    fillStroke(g, "#ff2418", 2);
  }
  rrect(g, 16, 198, 328, 20, 6);
  fillStroke(g, shade(color, -0.48));
}

interface TrafficSpec {
  w: number;
  h: number;
  paint: (g: CanvasRenderingContext2D, color: string, front: boolean) => void;
}

const TRAFFIC_SPECS: Record<TrafficKind, TrafficSpec> = {
  car: { w: 340, h: 200, paint: paintCar },
  truck: { w: 360, h: 230, paint: paintTruck },
  bus: { w: 360, h: 250, paint: paintBus },
};

const trafficCache = new Map<string, HTMLCanvasElement>();

/** Cached car/truck/bus sprite; dir 1 = rear view, -1 = front view. */
export function getTrafficSprite(
  kind: TrafficKind,
  color: string,
  dir: 1 | -1,
): HTMLCanvasElement {
  const key = `${kind}|${color}|${dir}`;
  const hit = trafficCache.get(key);
  if (hit) return hit;
  const spec = TRAFFIC_SPECS[kind];
  const c = makeCanvas(spec.w, spec.h);
  const g = ctx2d(c);
  spec.paint(g, color, dir === -1);
  trafficCache.set(key, c);
  return c;
}
