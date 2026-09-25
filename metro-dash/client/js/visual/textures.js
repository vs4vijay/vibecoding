// Procedural texture generation (per visual-overhaul D1)
import * as THREE from "three";

// One facade tile = TILE_METERS of wall, holding GRID x GRID window cells.
// Buildings tile it with an integer repeat so cap faces (UV-pinned to the
// {0, 0.5, 1} band grid) always sample plain wall — flat roofs for free.
export const FACADE_TILE = { px: 256, grid: 2, meters: 3.2 };

function shade(hex, amt) {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 0xff) + amt));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (hex & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

function windowRect(kind, cell) {
  switch (kind) {
    case "curtain":
      return { x: cell.x + 4, y: cell.y + 5, w: cell.s - 8, h: cell.s - 10 };
    case "ribbon":
      return {
        x: cell.x + cell.s * 0.1,
        y: cell.y + cell.s * 0.3,
        w: cell.s * 0.8,
        h: cell.s * 0.34,
      };
    case "punchedStone": {
      const w = cell.s * 0.34;
      const h = cell.s * 0.42;
      return { x: cell.x + (cell.s - w) / 2, y: cell.y + cell.s * 0.26, w, h };
    }
    default: {
      const w = cell.s * 0.42;
      const h = cell.s * 0.5;
      return { x: cell.x + (cell.s - w) / 2, y: cell.y + cell.s * 0.24, w, h };
    }
  }
}

function paintFacade(ctx, { base, trim, glass, kind }, cells) {
  const S = FACADE_TILE.px;
  ctx.fillStyle = shade(base, 0);
  ctx.fillRect(0, 0, S, S);

  // Wall material pattern
  if (kind === "brick" || kind === "punchedStone") {
    const course = kind === "brick" ? 8 : 16;
    for (let y = 0; y < S; y += course) {
      ctx.fillStyle = `rgba(0,0,0,${kind === "brick" ? 0.1 : 0.08})`;
      ctx.fillRect(0, y, S, 1);
      const off = (y / course) % 2 === 0 ? 0 : 12;
      for (let x = off; x < S; x += 24) {
        ctx.fillStyle = "rgba(0,0,0,0.06)";
        ctx.fillRect(x, y, 1, course);
      }
    }
  } else if (kind === "ribbon") {
    for (let x = 0; x <= S; x += 64) {
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(x, 0, 1, S);
    }
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = "rgba(0,0,0,0.03)";
      ctx.fillRect(Math.random() * S, 0, 6 + Math.random() * 10, S);
    }
  }

  // Floor bands + seams on the {0, 0.5, 1} grid (plain texels for cap faces)
  ctx.fillStyle = shade(base, kind === "curtain" ? 24 : -18);
  for (const p of [0, S / 2, S]) {
    ctx.fillRect(0, p - 4, S, 8);
    ctx.fillRect(p - 4, 0, 8, S);
  }

  for (const cell of cells) {
    const r = windowRect(kind, cell);

    if (kind === "curtain") {
      ctx.fillStyle = "rgba(0,0,0,0.14)";
      ctx.fillRect(r.x, r.y + r.h, r.w, 5);
    } else {
      ctx.fillStyle = trim;
      ctx.fillRect(r.x - 2, r.y - 4, r.w + 4, 3); // lintel
      ctx.fillRect(r.x - 3, r.y + r.h + 1, r.w + 6, 3); // sill
    }

    const grad = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    grad.addColorStop(0, shade(glass, 26));
    grad.addColorStop(1, shade(glass, -8));
    ctx.globalAlpha = Math.min(1, 0.85 * cell.tint);
    ctx.fillStyle = grad;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (kind === "curtain") {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(r.x + r.w / 2 - 1, r.y, 2, r.h); // mullion
      ctx.fillRect(r.x, r.y + r.h / 2 - 1, r.w, 2); // transom
    }
  }

  // Grain
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle =
      Math.random() > 0.5 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.04)";
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
}

function paintEmissive(ctx, kind, cells) {
  const S = FACADE_TILE.px;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, S, S);
  for (const cell of cells) {
    if (!cell.lit) continue;
    const r = windowRect(kind, cell);
    ctx.fillStyle = `rgba(255,255,255,${0.55 + Math.random() * 0.45})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (Math.random() < 0.4) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(r.x, r.y + r.h * 0.55, r.w, r.h * 0.45);
    }
  }
}

// Facade color map + matching lit-window emissive map (greyscale; the
// material's warm emissive color tints it. emissiveIntensity starts at 0 —
// raised by the night pass).
export function createFacadeTextures({ base, trim, glass, kind, litChance }) {
  const cell = FACADE_TILE.px / FACADE_TILE.grid;
  const cells = [];
  for (let row = 0; row < FACADE_TILE.grid; row++) {
    for (let col = 0; col < FACADE_TILE.grid; col++) {
      cells.push({
        x: col * cell,
        y: row * cell,
        s: cell,
        lit: Math.random() < litChance,
        tint: 0.8 + Math.random() * 0.4,
      });
    }
  }

  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = mapCanvas.height = FACADE_TILE.px;
  paintFacade(mapCanvas.getContext("2d"), { base, trim, glass, kind }, cells);

  const emissiveCanvas = document.createElement("canvas");
  emissiveCanvas.width = emissiveCanvas.height = FACADE_TILE.px;
  paintEmissive(emissiveCanvas.getContext("2d"), kind, cells);

  const map = new THREE.CanvasTexture(mapCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;

  const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;

  return { map, emissiveMap };
}

// ---------------------------------------------------------------------------
// Track bed (per visual-overhaul D4) — ballast gravel + sleeper ties
// ---------------------------------------------------------------------------

// One ballast tile = BALLAST_TILE.meters of gravel. Stones near tile edges are
// redrawn at wrapped offsets so repeats are seamless; the ground strip tiles it
// an integer number of times along its length (200 / 2.5 = 80).
export const BALLAST_TILE = { px: 512, meters: 2.5 };

// One sleeper tile = one tie pitch along travel: a horizontal tie band spanning
// the strip's full width (u), repeating along its length (v) — ties read
// perpendicular to travel. Grime is baked where rails seat (u = 0.2..0.8).
// 200 / 0.625 = 320 repeats, no partial tile.
export const SLEEPER_TILE = { px: 256, pitch: 0.625 };

function makeCanvas(w, h = w) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function toTexture(canvas, anisotropy) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

// fillRect that wraps past the right edge so streaks stay seamless in u
function wrapRect(ctx, S, x, y, w, h) {
  ctx.fillRect(x, y, w, h);
  if (x + w > S) ctx.fillRect(x - S, y, w, h);
}

function paintStone(ctx, x, y, r, tone) {
  const n = 5 + Math.floor(Math.random() * 3);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.7 + Math.random() * 0.45);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85]);
  }
  const path = (dx, dy) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) =>
      i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy),
    );
    ctx.closePath();
  };
  path(r * 0.22, r * 0.28); // shadow crescent (bottom-right)
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fill();
  path(-r * 0.14, -r * 0.18); // lit crescent (top-left)
  ctx.fillStyle = "rgba(255,255,255,0.13)";
  ctx.fill();
  path(0, 0); // body covers both, leaving the crescents
  ctx.fillStyle = tone;
  ctx.fill();
}

let ballastTexture = null;
// Gravel bed: irregular stones in gray tones with warm/cool variance. Major
// stones span ~0.2–0.37 m at BALLAST_TILE.meters — reads at gameplay distance.
export function createBallastTexture() {
  if (ballastTexture) return ballastTexture;
  const S = BALLAST_TILE.px;
  const ctx = makeCanvas(S).getContext("2d");

  ctx.fillStyle = "#55575a";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle =
      Math.random() < 0.5
        ? "rgba(122,113,100,0.1)"
        : "rgba(70,74,82,0.12)";
    const w = 40 + Math.random() * 140;
    wrapRect(ctx, S, Math.random() * S, Math.random() * S, w, w * (0.5 + Math.random()));
  }

  const tones = ["#7b7d7f", "#8d8e8a", "#6a6c6e", "#98938a", "#5f6165", "#84827c"];
  const scatter = (count, rMin, rMax) => {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      const r = rMin + Math.random() * (rMax - rMin);
      const tone = tones[Math.floor(Math.random() * tones.length)];
      // redraw near edge stones at wrapped offsets for seamless tiling
      for (let ox = -S; ox <= S; ox += S) {
        for (let oy = -S; oy <= S; oy += S) {
          const px = x + ox;
          const py = y + oy;
          if (px < -r * 1.6 || px > S + r * 1.6 || py < -r * 1.6 || py > S + r * 1.6)
            continue;
          paintStone(ctx, px, py, r, tone);
        }
      }
    }
  };
  scatter(90, 20, 38); // major ballast
  scatter(150, 6, 16); // fines between the big stones
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle =
      Math.random() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }

  ballastTexture = toTexture(ctx.canvas, 8);
  return ballastTexture;
}

let sleeperTexture = null;
// Wooden tie band on dark oiled ballast; ties span the full strip width.
export function createSleeperTexture() {
  if (sleeperTexture) return sleeperTexture;
  const S = SLEEPER_TILE.px;
  const ctx = makeCanvas(S).getContext("2d");

  ctx.fillStyle = "#3a3a3c";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 250; i++) {
    ctx.fillStyle =
      Math.random() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.18)";
    const s = 2 + Math.random() * 4;
    wrapRect(ctx, S, Math.random() * S, Math.random() * S, s, s);
  }

  const top = S * 0.32;
  const h = S * 0.38;
  ctx.fillStyle = "#2c2016";
  ctx.fillRect(0, top, S, h);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(0, top, S, 3); // worn top edge
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, top + h, S, 5); // shadow under the tie
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle =
      Math.random() < 0.5 ? "rgba(0,0,0,0.25)" : "rgba(120,88,56,0.16)";
    const w = 30 + Math.random() * 120;
    wrapRect(ctx, S, Math.random() * S, top + Math.random() * h, w, 1 + Math.random() * 2);
  }
  // grime where the rails seat (u = 0.2..0.8 step 0.15, the lane boundaries)
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  for (const u of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    ctx.fillRect(u * S - 5, top - 2, 10, h + 4);
  }

  sleeperTexture = toTexture(ctx.canvas, 8);
  return sleeperTexture;
}

// ---------------------------------------------------------------------------
// Hazard planks (per visual-overhaul D5) — diagonal orange/black safety
// stripes for work-zone barriers, scuffed so the planks read as used street
// furniture. Stripe bands follow lines of constant x + y and the stripe
// period divides the tile, so repeats stay seamless.
// ---------------------------------------------------------------------------

const HAZARD_TILE = { px: 256, period: 64 };

let hazardTexture = null;
export function createHazardTexture() {
  if (hazardTexture) return hazardTexture;
  const S = HAZARD_TILE.px;
  const ctx = makeCanvas(S).getContext("2d");

  ctx.fillStyle = "#d9601a"; // safety orange
  ctx.fillRect(0, 0, S, S);

  // Diagonal black bands as parallelograms of constant x + y
  const period = HAZARD_TILE.period;
  ctx.fillStyle = "#1a1b1d";
  for (let d = -period; d < 2 * S + period; d += period) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + period / 2, 0);
    ctx.lineTo(d + period / 2 - S, S);
    ctx.lineTo(d - S, S);
    ctx.closePath();
    ctx.fill();
  }

  // Wear: scuffs, chips down to the dark undercoat, grime film
  for (let i = 0; i < 130; i++) {
    ctx.fillStyle =
      Math.random() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
    ctx.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 4, 2);
  }
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = "rgba(24,20,18,0.5)";
    ctx.fillRect(
      Math.random() * S,
      Math.random() * S,
      3 + Math.random() * 6,
      2 + Math.random() * 3,
    );
  }
  const edge = ctx.createLinearGradient(0, 0, 0, S);
  edge.addColorStop(0, "rgba(0,0,0,0.3)");
  edge.addColorStop(0.16, "rgba(0,0,0,0)");
  edge.addColorStop(0.84, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, S, S);

  hazardTexture = toTexture(ctx.canvas, 8);
  return hazardTexture;
}

// ---------------------------------------------------------------------------
// Landing dust puff (per visual-overhaul D6) — soft white cloud for the
// sprite pool at the player's feet. Alpha-only texture (no wrap, no tiles):
// a hot core plus offset wisps so the puff reads as a billow, not a disc.
// ---------------------------------------------------------------------------

const DUST_TILE = { px: 128 };

let dustTexture = null;
export function createDustTexture() {
  if (dustTexture) return dustTexture;
  const S = DUST_TILE.px;
  const ctx = makeCanvas(S).getContext("2d");

  const blob = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  };
  blob(S / 2, S / 2, S * 0.5, 0.85); // core
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = S * (0.12 + Math.random() * 0.2);
    blob(
      S / 2 + Math.cos(a) * d,
      S / 2 + Math.sin(a) * d,
      S * (0.14 + Math.random() * 0.16),
      0.3,
    );
  }

  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  dustTexture = tex;
  return dustTexture;
}

// ---------------------------------------------------------------------------
// Sky cloud puff (per visual-overhaul D7) — soft white billboard cloud for
// the atmosphere pool. Alpha-only texture (no wrap, no tiles): a flat-bottomed
// base with lobes stacked above it so the sprite reads as a cloud, not a disc.
// Fixed lobe layout (no randomness) keeps every cloud uniform; variety comes
// from the pool's random scale/opacity.
// ---------------------------------------------------------------------------

const CLOUD_TILE = { px: 256 };

let cloudTexture = null;
export function createCloudTexture() {
  if (cloudTexture) return cloudTexture;
  const S = CLOUD_TILE.px;
  const ctx = makeCanvas(S).getContext("2d");

  const lobe = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  };
  lobe(S * 0.5, S * 0.62, S * 0.3, 0.7); // base, slightly low for a flat bottom
  lobe(S * 0.34, S * 0.5, S * 0.22, 0.55); // left lobe
  lobe(S * 0.66, S * 0.48, S * 0.24, 0.55); // right lobe
  lobe(S * 0.5, S * 0.36, S * 0.2, 0.5); // crown

  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cloudTexture = tex;
  return tex;
}
