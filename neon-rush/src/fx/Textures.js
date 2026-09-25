// Procedural canvas textures for world dressing (W1-VIS). Everything is built
// once and cached — recycle-time code only reads the cache. CanvasTexture with
// SRGBColorSpace; RepeatWrapping only where tiling is intended.
import * as THREE from 'three';

const cache = new Map();
function cached(key, build) {
  let t = cache.get(key);
  if (!t) { t = build(); cache.set(key, t); }
  return t;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// --- scanline / CRT overlay pass used across billboard art -------------------
function scanlines(g, w, h, alpha = 0.10, step = 3) {
  g.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let y = 0; y < h; y += step) g.fillRect(0, y, w, 1);
}

function vignette(g, w, h, strength = 0.5) {
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(5,2,12,${strength})`);
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}

// retro perspective grid drawn on a billboard
function posterGrid(g, w, h, horizonY, color) {
  g.strokeStyle = color;
  g.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    const x = (i / 10) * w;
    g.beginPath();
    g.moveTo(w / 2 + (x - w / 2) * 0.06, horizonY);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let i = 0; i < 9; i++) {
    const p = i / 8;
    const y = horizonY + (h - horizonY) * p * p;
    g.globalAlpha = 0.85 - p * 0.5;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }
  g.globalAlpha = 1;
}

function bandedSun(g, cx, cy, r, colTop, colBottom, bands = 6) {
  const grad = g.createLinearGradient(0, cy - r, 0, cy + r);
  grad.addColorStop(0, colTop);
  grad.addColorStop(1, colBottom);
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.fillStyle = grad;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.fillStyle = 'rgba(8,2,16,0.92)';
  for (let i = 0; i < bands; i++) {
    const y = cy + r * (0.05 + (i / bands) * 0.95);
    g.fillRect(cx - r, y, r * 2, 2 + i * 2.2);
  }
  g.restore();
  // soft halo
  const halo = g.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.9);
  halo.addColorStop(0, 'rgba(255,80,190,0.35)');
  halo.addColorStop(1, 'rgba(255,80,190,0)');
  g.fillStyle = halo;
  g.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
}

function glowText(g, text, x, y, font, fill, glow, glowBlur = 22) {
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = glow;
  g.shadowBlur = glowBlur;
  g.fillStyle = fill;
  g.fillText(text, x, y);
  g.shadowBlur = 0;
}

// --- billboard posters (one 512×256 canvas each, cached) ----------------------
const POSTERS = [
  { title: 'HYPERDRONE', sub: 'DRIVE THE GRID', a: '#ff2bd6', b: '#3b1470', accent: '#00f0ff' },
  { title: 'TURBO COLA', sub: 'ICE COLD 24H', a: '#ff7a1a', b: '#1c0b3a', accent: '#ffd24a' },
  { title: 'STARLIGHT FM', sub: '88.4 NIGHTS', a: '#00f0ff', b: '#120735', accent: '#ff2bd6' },
  { title: 'MAX VOLT', sub: 'CHARGE AHEAD', a: '#ffd24a', b: '#22093a', accent: '#ff3355' },
  { title: 'CHROME DREAMS', sub: 'EST. 1986', a: '#ff2bd6', b: '#0d0524', accent: '#00f0ff' },
  { title: 'ZONE 84', sub: 'NO BRAKES', a: '#ff3355', b: '#160733', accent: '#ffd24a' },
];

export function billboardTexture(i = 0) {
  return cached(`bb:${i % POSTERS.length}`, () => {
    const spec = POSTERS[i % POSTERS.length];
    // r6: 1024×512 (was 512×256) — near-camera billboards read sharp, not
    // blurry; same art, 2× texel density, anisotropy 8.
    const W = 1024, H = 512;
    const [c, g] = canvas(W, H);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, spec.b);
    bg.addColorStop(1, '#07030f');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    const horizon = H * 0.62;
    // r10: the sun shrank slightly and the sub-line moved OFF the disc — the
    // 'NO BRAKES' tag used to sit directly on the pale pink sun core and turned
    // to unreadable mush. The sub now lives in the dark grid area on its own
    // backing bar, readable for every poster.
    bandedSun(g, W * 0.5, horizon - 26, 92, '#ffe9b0', spec.a, 5);
    posterGrid(g, W, H, horizon, spec.accent);

    glowText(g, spec.title, W / 2, H * 0.28, '800 112px sans-serif', '#ffffff', spec.a, 52);
    g.font = '700 40px sans-serif';
    const subY = H * 0.80;
    g.fillStyle = 'rgba(6,2,14,0.62)';
    const tw = g.measureText(spec.sub).width;
    g.fillRect(W / 2 - tw / 2 - 26, subY - 32, tw + 52, 60);
    g.shadowColor = spec.accent; g.shadowBlur = 24;
    g.fillStyle = spec.accent;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(spec.sub, W / 2, subY);
    g.shadowBlur = 0;

    // corner brackets
    g.strokeStyle = spec.accent; g.lineWidth = 8;
    const m = 24, L = 68;
    g.beginPath();
    g.moveTo(m, m + L); g.lineTo(m, m); g.lineTo(m + L, m);
    g.moveTo(W - m - L, m); g.lineTo(W - m, m); g.lineTo(W - m, m + L);
    g.moveTo(m, H - m - L); g.lineTo(m, H - m); g.lineTo(m + L, H - m);
    g.moveTo(W - m - L, H - m); g.lineTo(W - m, H - m); g.lineTo(W - m, H - m - L);
    g.stroke();

    scanlines(g, W, H, 0.12, 6);
    vignette(g, W, H, 0.45);
    return toTexture(c);
  });
}

// --- generic helpers ----------------------------------------------------------

// Tileable fine noise (used by static/fringe overlays if needed).
export function noiseTexture(size = 256) {
  return cached(`noise:${size}`, () => {
    const [c, g] = canvas(size, size);
    const img = g.createImageData(size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return toTexture(c, { repeat: true });
  });
}

// Horizontal scanline strip (1×8 tile) — subtle CRT lines on emissive panels.
export function scanlineTexture() {
  return cached('scanlines', () => {
    const [c, g] = canvas(8, 8);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 8, 8);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 5, 8, 3);
    const t = toTexture(c, { repeat: true });
    t.repeat.set(1, 24);
    return t;
  });
}

// Radial glow sprite (soft round halo) — reusable for baked light blooms.
export function glowSpriteTexture(tint = '#00f0ff') {
  return cached(`glow:${tint}`, () => {
    const S = 128;
    const [c, g] = canvas(S, S);
    const grad = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    grad.addColorStop(0, tint);
    grad.addColorStop(0.35, tint + '88');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    return toTexture(c);
  });
}

// --- phase-scene helpers (WORLD LOOK r1) ---------------------------------------

// Banded retro sun with halo on TRANSPARENT — backdrop billboards (hopper).
export function horizonSunTexture() {
  return cached('horizon-sun', () => {
    const S = 256;
    const [c, g] = canvas(S, S);
    bandedSun(g, S / 2, S * 0.52, S * 0.33, '#fff3c8', '#ff2bd6', 7);
    return toTexture(c);
  });
}

// Wide horizon glow band (magenta core → cyan fringe → transparent) — additive.
export function horizonGlowTexture() {
  return cached('horizon-glow', () => {
    const W = 256, H = 64;
    const [c, g] = canvas(W, H);
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, 'rgba(255,64,176,0.95)');
    grad.addColorStop(0.28, 'rgba(255,64,176,0.42)');
    grad.addColorStop(0.62, 'rgba(120,40,190,0.16)');
    grad.addColorStop(1, 'rgba(0,240,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // hot horizon line at the base
    g.fillStyle = 'rgba(255,150,220,0.9)';
    g.fillRect(0, H - 3, W, 2);
    return toTexture(c);
  });
}

// r4 (hopper): horizon glow with a SOFT horizontal falloff as well — the
// flat-edged band over the field read as a translucent ghost-blue box when it
// crossed the river rows. Radial-ish: hot center, fading to all four edges.
export function softGlowBandTexture() {
  return cached('soft-glow-band', () => {
    const W = 256, H = 128;
    const [c, g] = canvas(W, H);
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, 'rgba(255,64,176,0.95)');
    grad.addColorStop(0.30, 'rgba(255,64,176,0.40)');
    grad.addColorStop(0.65, 'rgba(120,40,190,0.14)');
    grad.addColorStop(1, 'rgba(0,240,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // kill the left/right hard edges (destination-in with a soft side mask)
    g.globalCompositeOperation = 'destination-in';
    const side = g.createLinearGradient(0, 0, W, 0);
    side.addColorStop(0, 'rgba(0,0,0,0)');
    side.addColorStop(0.22, 'rgba(0,0,0,1)');
    side.addColorStop(0.78, 'rgba(0,0,0,1)');
    side.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = side;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    return toTexture(c);
  });
}

// Radial dark blob — baked contact shadows under obstacles/props.
export function shadowSpriteTexture() {
  return cached('shadow-sprite', () => {
    const S = 128;
    const [c, g] = canvas(S, S);
    const grad = g.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.88)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    return toTexture(c);
  });
}

// Flight-corridor wall: panel segmentation + window band + mid accent stripe +
// base trim (tiles ALONG the corridor; V spans the full wall height once).
// r2: light seams + window panes run hot so the walls carry the corridor's
// emissive language instead of reading as flat cardboard-blue planes.
// Deterministic LCG so a given build always matches.
export function corridorWallTexture() {
  return cached('corridor-wall', () => {
    const W = 512, H = 256;
    const [c, g] = canvas(W, H);
    let s = 0x5EED;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#120d38');
    bg.addColorStop(0.55, '#171249');
    bg.addColorStop(1, '#0b0830');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // vertical panel seams every 64px (≈3.3 m at repeat 6.5 over 176 m) —
    // each seam carries a hot cyan light core with a soft neon bloom
    for (let x = 0; x <= W; x += 64) {
      g.strokeStyle = 'rgba(0,240,255,0.16)'; g.lineWidth = 7;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      g.strokeStyle = '#57ecff'; g.shadowColor = '#00f0ff'; g.shadowBlur = 9;
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      g.shadowBlur = 0;
    }
    // horizontal segment seams
    g.strokeStyle = '#20306a'; g.lineWidth = 2;
    for (const y of [0.34, 0.62, 0.86]) {
      g.beginPath(); g.moveTo(0, y * H); g.lineTo(W, y * H); g.stroke();
    }
    // recessed panel shading
    for (let x = 0; x < W; x += 64) {
      g.fillStyle = 'rgba(0,0,0,0.30)';
      g.fillRect(x + 6, H * 0.36, 52, H * 0.24);
      g.fillStyle = 'rgba(90,140,255,0.06)';
      g.fillRect(x + 6, H * 0.36, 52, 3);
    }
    // anchored window strip (upper third): dark sockets + hot lit panes
    for (let x = 6; x < W - 10; x += 20) {
      g.fillStyle = '#0a1334';
      g.fillRect(x, H * 0.12, 12, 16);
      if (rnd() < 0.60) {
        const col = rnd() < 0.55 ? '#b8f6ff' : rnd() < 0.8 ? '#ffd97a' : '#ff86d8';
        g.fillStyle = col;
        g.shadowColor = col; g.shadowBlur = 8;
        g.fillRect(x + 2, H * 0.12 + 3, 8, 10);
        g.shadowBlur = 0;
      }
    }
    // mid accent stripe: r12 re-tint — the old hot magenta service line ran
    // the full corridor length and read from the chase cam as a LASER beam
    // (magenta sits in the hazard family; red/orange must stay the only death
    // language). Now a dim structural violet: visible panel accent, clearly
    // not a hazard emitter, brightness well under the cyan light seams.
    g.fillStyle = 'rgba(126,96,255,0.13)';
    g.fillRect(0, H * 0.615, W, 9);
    g.strokeStyle = '#8d78e8'; g.shadowColor = '#6a55d0'; g.shadowBlur = 5;
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, H * 0.615 + 2.5); g.lineTo(W, H * 0.615 + 2.5); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(0,240,255,0.55)';
    for (let x = 0; x < W; x += 96) g.fillRect(x + 22, H * 0.615, 40, 5);
    // lower service strip + glowing base trim
    g.fillStyle = '#0e0b28';
    g.fillRect(0, H * 0.86, W, H * 0.14);
    g.fillStyle = '#06424f';
    g.fillRect(0, H - 12, W, 12);
    g.fillStyle = '#9ff7ff'; g.shadowColor = '#00f0ff'; g.shadowBlur = 12;
    g.fillRect(0, H - 9, W, 4);
    g.shadowBlur = 0;
    return toTexture(c, { repeat: true });
  });
}

// Flight gate hazard panels: hot maroon steel + upward chevrons pointing
// at the threadable gap (top bars flip the instance 180°). Deterministic.
// r10: the old dark-maroon background + pale-amber edge mipped to a flat
// desaturated SALMON strip at gate distance (the only surviving detail at
// 30+ m was the pale edge line averaging with the dark body). The base is now
// a richer red and the chevrons hotter, so the mip average stays hue-dominant
// HAZARD RED at every depth; the gap-kiss edge stays amber-hot but deeper.
export function gateHazardTexture() {
  return cached('gate-hazard', () => {
    const S = 128;
    const [c, g] = canvas(S, S);
    const bg = g.createLinearGradient(0, 0, 0, S);
    bg.addColorStop(0, '#6e1224');
    bg.addColorStop(0.5, '#4a0c18');
    bg.addColorStop(1, '#2c0710');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    // brushed steel sheen
    g.fillStyle = 'rgba(255,120,140,0.07)';
    for (let y = 6; y < S; y += 16) g.fillRect(0, y, S, 2);
    // hot chevrons (point up = thread this way). r4: glow blur trimmed and the
    // gap-kiss edge softened from near-white to hot amber — the bar tint sits
    // just over 1.0 HDR, so a white edge line here was rendering as a
    // full-width blown band across the corridor (r3 critic, flight).
    // r10: chevrons pushed from orange to red-orange so distance mips read RED.
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = '#ff3520'; g.shadowBlur = 9;
    g.strokeStyle = '#ff5a2a'; g.lineWidth = 15;
    for (const cy of [96, 48]) {
      g.beginPath();
      g.moveTo(16, cy + 18); g.lineTo(64, cy - 14); g.lineTo(112, cy + 18);
      g.stroke();
    }
    g.shadowBlur = 0;
    // hot top edge (kiss the gap) — deep amber, hue-dominant, never white
    g.fillStyle = '#ff9a48';
    g.shadowColor = '#ff6a20'; g.shadowBlur = 6;
    g.fillRect(0, 0, S, 4);
    g.shadowBlur = 0;
    return toTexture(c, { repeat: true });
  });
}

// Hopper terrain: dark violet land + cyan survey grid (tiles over a big plane).
// r2: brighter grid + occasional lit plots so the flanks never read as a
// black dead void around the play field.
// r6: grid lines lifted one step and plot density up — with fog pulling the
// far terrain toward #0b0518, the survey grid must stay legible long enough
// that the world edge fades into DIM GRID, not featureless black.
// r8: base lifted again (the near flank at t=25 still measured ~99% near-black
// past the field edge) — the backdrop now sits clearly above the #0b0518 fog
// color near the camera and falls into it with distance, so the edge reads as
// lit survey ground falling away, never as bare void.
export function gridTerrainTexture() {
  return cached('grid-terrain', () => {
    const S = 256;
    const [c, g] = canvas(S, S);
    let s = 0xBEEF;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
    const bg = g.createLinearGradient(0, 0, 0, S);
    bg.addColorStop(0, '#161034');
    bg.addColorStop(1, '#181242');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    // lit plots (sparse, before the grid so lines cross over them)
    for (let i = 0; i < 34; i++) {
      if (rnd() > 0.52) continue;
      const x = (rnd() * 4 | 0) * 64, y = (rnd() * 4 | 0) * 64;
      const w = 30 + rnd() * 30;
      g.fillStyle = rnd() < 0.5 ? 'rgba(64,45,148,0.85)' : 'rgba(30,72,142,0.85)';
      g.fillRect(x + 4, y + 4, w, w);
      if (rnd() < 0.4) {
        g.fillStyle = 'rgba(0,240,255,0.22)';
        g.fillRect(x + 8, y + 8, 10, 6);
      }
    }
    g.strokeStyle = '#3b53bd'; g.lineWidth = 3;
    for (let i = 0; i <= S; i += 64) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke();
    }
    g.strokeStyle = 'rgba(0,240,255,0.26)'; g.lineWidth = 2;
    for (let i = 0; i <= S; i += 64) {
      g.beginPath(); g.moveTo(i + 32, 0); g.lineTo(i + 32, S); g.stroke();
      g.beginPath(); g.moveTo(0, i + 32); g.lineTo(S, i + 32); g.stroke();
    }
    return toTexture(c, { repeat: true });
  });
}

// Hopper headlight: warm light cone thrown forward on the tarmac (additive
// plane). r12: rebuilt as a TRUE analytic cone — per-pixel angle×throw falloff
// instead of a canvas radial gradient clipped by a trapezoid path. The old
// path-clipped fill kept ~30% alpha at its slanted borders: every car dragged
// a hard-edged beige wedge with a notched lamp end (the cheapest pixels in the
// build). Alpha now reaches exact 0 at the cone's lateral borders and fades
// smoothly with throw distance, so the fan dissolves into the tarmac.
export function headlightConeTexture() {
  return cached('headlight-cone', () => {
    const S = 128;
    const [c, g] = canvas(S, S);
    const img = g.createImageData(S, S);
    const d = img.data;
    const sstep = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const ax = 0.5, ay = -0.06;          // apex just above the top edge
    const half = Math.PI / 6;            // 30° half-angle fan
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const px = (x + 0.5) / S - ax;
        const py = (y + 0.5) / S - ay;
        const dist = Math.sqrt(px * px + py * py);
        const ang = Math.abs(Math.atan2(px, Math.max(py, 1e-4)));
        // lateral: soft shoulder inside the cone, exact 0 at/over the border
        const lat = 1 - sstep(half * 0.55, half, ang);
        // throw: bright lobe at the bumper, exponential dissolve, hard 0 at r≈1
        let a = lat * Math.exp(-dist * 2.4) * (1 - sstep(0.52, 0.98, dist));
        a += lat * Math.exp(-dist * 13) * 0.55;      // hot lamp lobe
        a = Math.min(1, a);
        const i = (y * S + x) * 4;
        d[i] = 255; d[i + 1] = 226; d[i + 2] = 172;
        d[i + 3] = (a * 255) | 0;
      }
    }
    g.putImageData(img, 0, 0);
    return toTexture(c);
  });
}

// Hopper r12 spawn dressing: cyan chevron decal marking the safe hop line on
// the calm opening rows (transparent, additive use, glow + round caps).
export function chevronTexture() {
  return cached('chevron', () => {
    const W = 128, H = 96;
    const [c, g] = canvas(W, H);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = '#00f0ff'; g.shadowBlur = 10;
    g.strokeStyle = '#8ff8ff'; g.lineWidth = 11;
    for (const yy of [62, 88]) {
      g.beginPath();
      g.moveTo(18, yy + 4); g.lineTo(64, yy - 26); g.lineTo(110, yy + 4);
      g.stroke();
    }
    g.shadowBlur = 0;
    const t = toTexture(c);
    // [FX r2] flat ground decal — same grazing-angle treatment as the drift
    // apex chevrons: anisotropic filtering so minification keeps the apexes.
    const rn = (typeof window !== 'undefined' && window.__NR && window.__NR.renderer) || null;
    t.anisotropy = rn ? Math.min(16, rn.capabilities.getMaxAnisotropy()) : 8;
    return t;
  });
}

// Flight fuel-gauge HUD face: glass frame + ticks, transparent center so the
// fill plane shows through (camera-attached, drawn over the world).
export function fuelGaugeTexture() {
  return cached('fuel-gauge', () => {
    const W = 72, H = 480;
    const [c, g] = canvas(W, H);
    g.strokeStyle = '#00f0ff'; g.lineWidth = 8;
    g.shadowColor = '#00f0ff'; g.shadowBlur = 18;
    g.strokeRect(4, 4, W - 8, H - 8);
    g.shadowBlur = 0;
    // inner dark glass
    g.fillStyle = 'rgba(10,14,32,0.88)';
    g.fillRect(12, 12, W - 24, H - 24);
    // gauge ticks
    g.strokeStyle = 'rgba(0,240,255,0.5)'; g.lineWidth = 4;
    for (let i = 1; i < 10; i++) {
      const y = (i / 10) * (H - 30) + 15;
      g.beginPath(); g.moveTo(10, y); g.lineTo(i % 5 === 0 ? 30 : 20, y); g.stroke();
      g.beginPath(); g.moveTo(W - 10, y); g.lineTo(W - (i % 5 === 0 ? 30 : 20), y); g.stroke();
    }
    // bolt glyph at the head
    g.fillStyle = '#ffd24a'; g.shadowColor = '#ffd24a'; g.shadowBlur = 10;
    g.beginPath();
    g.moveTo(W / 2 + 7, 26); g.lineTo(W / 2 - 8, 52); g.lineTo(W / 2 + 1, 52);
    g.lineTo(W / 2 - 5, 74); g.lineTo(W / 2 + 10, 46); g.lineTo(W / 2 + 1, 46);
    g.closePath(); g.fill();
    g.shadowBlur = 0;
    return toTexture(c);
  });
}

// --- shared pickup family (WORLD-LOOK r8) -------------------------------------
// Faceted gold coin token — ONE identity for run/hopper/drift coins + flight
// fuel cells. Recipe is OrbPhase's proven data-fruit look: unlit vertex-colored
// facets + an amber-heavy HDR tint (ACES lifts it to saturated gold), baked
// per-triangle so it reads as faceted EMISSIVE gold at every distance/angle
// with no specular swing and no flat-card silhouette. Peak facet luminance
// stays under the 0.85 bloom threshold — the glow comes from bloom kissing the
// hottest facets, never from white clipping.
export function coinTokenGeometry(radius = 0.34) {
  let g = new THREE.CylinderGeometry(radius * 0.86, radius, radius * 0.38, 6, 1);
  g = g.toNonIndexed();
  g.rotateX(Math.PI / 2);            // flat faces toward ±Z (chase cameras)
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  let s = 0xC01D >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
  // groups survive toNonIndexed: 0 = rim, 1/2 = the two faces
  const groups = g.groups;
  for (const gr of groups) {
    const face = gr.materialIndex > 0;
    for (let v = gr.start; v < gr.start + gr.count; v++) {
      const b = face ? 0.92 + rnd() * 0.22 : 0.56 + rnd() * 0.26;
      col[v * 3] = b; col[v * 3 + 1] = b; col[v * 3 + 2] = b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// strength > 1 raises the HDR gold so bigger tokens (flight fuel cells) stay
// hue-dominant LIT at close range instead of reading as matte beige cardboard.
// 1.0 keeps the exact run/hopper/drift coin look those scenes were tuned with.
export function coinTokenMaterial(strength = 1.0) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  m.color.setRGB(1.30 * strength, 0.62 * strength, 0.13 * strength);  // amber-heavy gold — never clips to white
  return m;
}

// Flight fuel-gauge FILL: vertical energy gradient (deep amber base → hot gold
// head) with a bright "surface" line at the top of the column. Scrolling the
// offset animates a flowing-charge shimmer, so the gauge reads as live fuel
// energy instead of a dead olive block. V spans one tank; RepeatWrapping in V.
export function fuelFillTexture() {
  return cached('fuel-fill', () => {
    const W = 32, H = 128;
    const [c, g] = canvas(W, H);
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, '#7a4a08');
    grad.addColorStop(0.35, '#d98a14');
    grad.addColorStop(0.8, '#ffd24a');
    grad.addColorStop(1, '#fff3b0');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // flowing charge streaks (move via texture offset.y in the update loop)
    g.globalAlpha = 0.5;
    for (const y of [18, 52, 88]) {
      const sg = g.createLinearGradient(0, y, W, y + 6);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,246,200,0.95)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sg;
      g.fillRect(0, y, W, 3);
    }
    g.globalAlpha = 1;
    const t = toTexture(c, { repeat: true });
    t.repeat.set(1, 2);       // two tank-heights tiled → seamless flow
    return t;
  });
}

export const POSTER_COUNT = POSTERS.length;
