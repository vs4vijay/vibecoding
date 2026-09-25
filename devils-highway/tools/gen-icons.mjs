/**
 * tools/gen-icons.mjs — procedural PWA icons (pure Node, node:zlib).
 * Draws the DEVIL'S HIGHWAY mark: a US-route shield silhouette in amber
 * (#ffb24d) on a charcoal (#0a0c10) rounded panel, carrying "666" in
 * punched-out charcoal — the game's route sign. A short dashed centre line
 * under the shield echoes the highway. Renders at 2x and box-downsamples
 * for clean edges.
 *
 * Usage: bun tools/gen-icons.mjs   (writes icons/icon-192.png, icon-512.png)
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- tiny software rasterizer --------------------------------------------
function makeBuf(size) {
  return { size, data: new Uint8ClampedArray(size * size * 4) };
}

function blend(buf, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= buf.size || y >= buf.size || a <= 0) return;
  const i = (y * buf.size + x) * 4;
  const ia = 1 - a;
  buf.data[i] = buf.data[i] * ia + r * a;
  buf.data[i + 1] = buf.data[i + 1] * ia + g * a;
  buf.data[i + 2] = buf.data[i + 2] * ia + b * a;
  buf.data[i + 3] = Math.max(buf.data[i + 3], 255);
}

/** Signed distance of a rounded rect; sd < 0 inside. */
function roundRectSDF(px, py, cx, cy, hw, hh, rad) {
  const dx = Math.abs(px - cx) - (hw - rad);
  const dy = Math.abs(py - cy) - (hh - rad);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - rad;
}

function fillRoundRect(buf, cx, cy, hw, hh, rad, col) {
  for (let y = Math.floor(cy - hh - 2); y <= Math.ceil(cy + hh + 2); y++) {
    for (let x = Math.floor(cx - hw - 2); x <= Math.ceil(cx + hw + 2); x++) {
      const d = roundRectSDF(x + 0.5, y + 0.5, cx, cy, hw, hh, rad);
      const a = Math.min(1, Math.max(0, -d + 0.5));
      if (a > 0) blend(buf, x, y, col[0], col[1], col[2], a * (col[3] ?? 1));
    }
  }
}

function fillCircle(buf, cx, cy, rad, col) {
  for (let y = Math.floor(cy - rad - 2); y <= Math.ceil(cy + rad + 2); y++) {
    for (let x = Math.floor(cx - rad - 2); x <= Math.ceil(cx + rad + 2); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - rad;
      const a = Math.min(1, Math.max(0, -d + 0.5));
      if (a > 0) blend(buf, x, y, col[0], col[1], col[2], a * (col[3] ?? 1));
    }
  }
}

function fillSeg(buf, x0, y0, x1, y1, halfW, col) {
  const minx = Math.floor(Math.min(x0, x1) - halfW - 2);
  const maxx = Math.ceil(Math.max(x0, x1) + halfW + 2);
  const miny = Math.floor(Math.min(y0, y1) - halfW - 2);
  const maxy = Math.ceil(Math.max(y0, y1) + halfW + 2);
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      const t = Math.max(0, Math.min(1, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / len2));
      const d = Math.hypot(x + 0.5 - (x0 + t * dx), y + 0.5 - (y0 + t * dy)) - halfW;
      const a = Math.min(1, Math.max(0, -d + 0.5));
      if (a > 0) blend(buf, x, y, col[0], col[1], col[2], a * (col[3] ?? 1));
    }
  }
}

function fillTrapezoid(buf, topY, botY, topL, topR, botL, botR, col) {
  for (let y = Math.floor(topY); y <= Math.ceil(botY); y++) {
    const t = (y + 0.5 - topY) / (botY - topY);
    const xl = topL + (botL - topL) * t;
    const xr = topR + (botR - topR) * t;
    for (let x = Math.floor(xl) - 1; x <= Math.ceil(xr) + 1; x++) {
      const a = Math.min(1, Math.max(0, Math.min(x + 0.5 - xl, xr - (x + 0.5)) + 0.5));
      if (a > 0) blend(buf, x, Math.round(y), col[0], col[1], col[2], a * (col[3] ?? 1));
    }
  }
}

/** Circular-arc stroke, angles in radians, screen convention (y down):
 *  0 = right, PI/2 = down, PI = left. Sweeps from a0 to a1 (a1 > a0). */
function fillArc(buf, cx, cy, rad, halfW, a0, a1, col) {
  const reach = rad + halfW + 2;
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      const px = x + 0.5 - cx, py = y + 0.5 - cy;
      const d = Math.abs(Math.hypot(px, py) - rad) - halfW;
      let phi = Math.atan2(py, px);
      while (phi < a0) phi += Math.PI * 2;
      if (phi <= a1) {
        const a = Math.min(1, Math.max(0, -d + 0.5));
        if (a > 0) blend(buf, x, y, col[0], col[1], col[2], a * (col[3] ?? 1));
      }
    }
  }
}

// ---- icon composition ------------------------------------------------------
const BG = [10, 12, 16]; // #0a0c10 charcoal
const PANEL = [17, 21, 27];
const AMBER = [255, 178, 77]; // #ffb24d

/** One "6": ring bowl + a tail arc that rises above the bowl from its left
 *  edge and sweeps over the top toward the upper right (geometric 6). Kept
 *  inside the digit cell: tail extent <= ~1.02 R vs cell half-width ~1.22 R. */
function drawSix(buf, cx, cy, R, w, col) {
  fillCircle(buf, cx, cy, R, col);
  fillCircle(buf, cx, cy, R - w, AMBER); // punch the bowl hole back to shield
  const e = R * 0.5; // tail-circle centre offset to the right of the bowl
  const rt = R + e; // passes exactly through the bowl's left-outer edge
  fillArc(buf, cx + e, cy, rt, w / 2, Math.PI, Math.PI * 1.62, col);
}

function drawIcon(size) {
  const S = size * 2; // supersample
  const buf = makeBuf(S);
  buf.data.fill(0);
  // Full-bleed bg (maskable-safe) + rounded panel for "any" identity.
  for (let i = 0; i < S * S; i++) {
    buf.data[i * 4] = BG[0];
    buf.data[i * 4 + 1] = BG[1];
    buf.data[i * 4 + 2] = BG[2];
    buf.data[i * 4 + 3] = 255;
  }
  fillRoundRect(buf, S / 2, S / 2, S * 0.47, S * 0.47, S * 0.2, [...PANEL, 1]);

  // US-route shield: near-square shoulder cap + short taper to a rounded point.
  const cx = S * 0.5;
  const capHw = S * 0.28;
  fillRoundRect(buf, cx, S * 0.26, capHw, S * 0.08, S * 0.045, AMBER);
  fillTrapezoid(buf, S * 0.3, S * 0.62, cx - capHw, cx + capHw, cx - S * 0.15, cx + S * 0.15, AMBER);
  fillCircle(buf, cx, S * 0.575, S * 0.15, AMBER);

  // "666" punched out of the shield face (charcoal, same ink as the bg).
  const INK = [...BG, 1];
  const R = S * 0.054; // bowl outer radius
  const w = S * 0.024; // numeral stroke
  const bowlY = S * 0.45;
  const advance = 2 * R + S * 0.024;
  for (const dx of [-advance, 0, advance]) drawSix(buf, cx + dx, bowlY, R, w, INK);

  // Dashed centre line under the shield — the highway reads on home screens.
  const dashY = S * 0.84;
  for (const dx of [-S * 0.1, 0, S * 0.1]) {
    fillSeg(buf, cx + dx - S * 0.035, dashY, cx + dx + S * 0.035, dashY, S * 0.009, AMBER);
  }

  // Box-downsample 2x.
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 4; c++) {
        const i = ((y * 2) * S + x * 2) * 4 + c;
        const j = ((y * 2 + 1) * S + x * 2) * 4 + c;
        const k = ((y * 2) * S + x * 2 + 1) * 4 + c;
        const l = ((y * 2 + 1) * S + x * 2 + 1) * 4 + c;
        out[(y * size + x) * 4 + c] =
          (buf.data[i] + buf.data[j] + buf.data[k] + buf.data[l]) / 4;
      }
    }
  }
  return out;
}

// ---- minimal PNG encoder (RGBA8, filter 0) ---------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(join(ROOT, "icons"), { recursive: true });
for (const size of [192, 512]) {
  const png = encodePNG(size, size, drawIcon(size));
  const out = join(ROOT, "icons", `icon-${size}.png`);
  writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}
