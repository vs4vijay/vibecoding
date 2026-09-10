// scripts/gen-placeholder-atlas.ts
// Generates placeholder atlases (PNG + twin JSON) under public/assets/atlas/ so the
// T10 renderer is honest before real Kenney art lands in T13 (spec §3.6).
//
//   bun scripts/gen-placeholder-atlas.ts
//
// Zero canvas dependency: writes PNG bytes directly via a minimal encoder.
// Cells are labeled magenta boxes (name initials) sized 48×64 for fighters,
// smaller for props/fx; every key referenced by src/data/*.json is covered,
// plus `<charId>_idle` fallbacks and bg layer atlasKeys from stages.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "public", "assets", "atlas");
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Minimal PNG writer: 8-bit RGBA, no filtering, stored (uncompressed deflate) blocks. */
function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  // zlib stream with stored deflate blocks (BFINAL on last, ≤65535 bytes each)
  const nBlocks = Math.ceil(raw.length / 65535);
  const z = new Uint8Array(2 + raw.length + nBlocks * 5 + 4);
  let zi = 0;
  z[zi++] = 0x78;
  z[zi++] = 0x01;
  for (let i = 0; i < nBlocks; i++) {
    const len = Math.min(65535, raw.length - i * 65535);
    z[zi++] = i === nBlocks - 1 ? 1 : 0;
    z[zi++] = len & 0xff;
    z[zi++] = (len >> 8) & 0xff;
    z[zi++] = ~len & 0xff;
    z[zi++] = (~len >> 8) & 0xff;
    z.set(raw.subarray(i * 65535, i * 65535 + len), zi);
    zi += len;
  }
  const adler = adler32(raw);
  z[zi++] = (adler >>> 24) & 0xff;
  z[zi++] = (adler >>> 16) & 0xff;
  z[zi++] = (adler >>> 8) & 0xff;
  z[zi++] = adler & 0xff;

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return concat([HEADER, chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))]);
}

const HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

interface CellSpec {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pivotX?: number;
  pivotY?: number;
}

/** Paint one labeled cell: magenta fill, black border, name initials centered. */
function paintCell(
  rgba: Uint8Array,
  w: number,
  spec: CellSpec,
): void {
  const { x, y, w: cw, h: ch } = spec;
  for (let py = y; py < y + ch; py++) {
    for (let px = x; px < x + cw; px++) {
      const border = px === x || py === y || px === x + cw - 1 || py === y + ch - 1;
      const [r, g, b] = border ? [0, 0, 0] : [255, 0, 255];
      const i = (py * w + px) * 4;
      rgba[i] = r!;
      rgba[i + 1] = g!;
      rgba[i + 2] = b!;
      rgba[i + 3] = 255;
    }
  }
}

const DIGITS_3X5: Record<string, number[]> = {
  A: [0b010, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b011, 0b100, 0b100, 0b100, 0b011],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b110, 0b100, 0b111],
  F: [0b111, 0b100, 0b110, 0b100, 0b100],
  G: [0b011, 0b100, 0b101, 0b101, 0b011],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  K: [0b101, 0b101, 0b110, 0b101, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b111, 0b101, 0b101],
  N: [0b101, 0b111, 0b111, 0b111, 0b101],
  O: [0b010, 0b101, 0b101, 0b101, 0b010],
  P: [0b110, 0b101, 0b110, 0b100, 0b100],
  R: [0b110, 0b101, 0b110, 0b101, 0b101],
  S: [0b011, 0b100, 0b010, 0b001, 0b110],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b111],
  V: [0b101, 0b101, 0b101, 0b101, 0b010],
  W: [0b101, 0b101, 0b111, 0b111, 0b101],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
};

function paintLabel(rgba: Uint8Array, w: number, text: string, cx: number, cy: number): void {
  const chars = [...text.toUpperCase()].filter((c) => DIGITS_3X5[c]);
  if (chars.length === 0) return;
  const scale = chars.length > 8 ? 1 : 2;
  const glyphW = 4 * scale; // 3px glyph + 1px gap
  let ox = Math.round(cx - (chars.length * glyphW - scale) / 2);
  const oy = Math.round(cy - (2.5 * scale));
  for (const c of chars) {
    const rows = DIGITS_3X5[c]!;
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if ((rows[gy]! >> (2 - gx)) & 1) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = ox + gx * scale + sx;
              const py = oy + gy * scale + sy;
              const i = (py * w + px) * 4;
              rgba[i] = 0;
              rgba[i + 1] = 0;
              rgba[i + 2] = 0;
            }
          }
        }
      }
    }
    ox += glyphW;
  }
}

/**
 * Pack cells column-major into a power-of-two square; 1px transparent gutter
 * around every cell (§3.6). Fighters get feet-center pivots for z-sorting.
 */
function buildAtlas(name: string, keys: string[], cellW: number, cellH: number, pivoted: boolean): void {
  const gutter = 2;
  // Column budget from a nominal 512px canvas edge; rows follow from key count.
  const perCol = Math.floor(508 / (cellH + gutter));
  const cols = Math.max(1, Math.ceil(keys.length / perCol));
  const rows = Math.max(1, Math.ceil(keys.length / cols));
  // BOTH dimensions must fit the packed extent (P1-1: one-column sets previously
  // collapsed to a 64px canvas and paintCell wrote past the buffer end).
  const size = nextPow2(Math.max(
    64,
    cols * (cellW + gutter) + gutter,
    rows * (cellH + gutter) + gutter,
  ));
  const rgba = new Uint8Array(size * size * 4); // transparent backdrop
  const frames: CellSpec[] = [];
  keys.forEach((key, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const x = 1 + col * (cellW + gutter);
    const y = 1 + row * (cellH + gutter);
    if (x + cellW + 1 > size || y + cellH + 1 > size) {
      throw new Error(`${name}: overflow at "${key}" (cell ${x},${y} ${cellW}×${cellH} vs canvas ${size})`);
    }
    const spec: CellSpec = { name: key, x, y, w: cellW, h: cellH };
    if (pivoted) {
      spec.pivotX = x + cellW / 2;
      spec.pivotY = y + cellH; // feet at cell bottom
    }
    paintCell(rgba, size, spec);
    paintLabel(rgba, size, key, x + cellW / 2, y + cellH / 2);
    frames.push(spec);
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.png`), encodePng(size, size, rgba));
  assertFramesFit(name, join(OUT, `${name}.png`), frames);
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(frames, null, "\t")}\n`);
  console.log(`${name}.png ${size}×${size} — ${frames.length} frames`);
}

/** Post-write IHDR check: every declared frame rect must sit inside the PNG. */
function assertFramesFit(name: string, pngPath: string, frames: CellSpec[]): void {
  const buf = readFileSync(pngPath);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${name}: bad PNG signature`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  for (const f of frames) {
    if (f.x + f.w > w || f.y + f.h > h) {
      throw new Error(`${name}: frame "${f.name}" rect (${f.x},${f.y} ${f.w}×${f.h}) exceeds PNG ${w}×${h}`);
    }
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// ---- content-driven key collection ----------------------------------------

type RawSheet = { id: string; moves: Record<string, { frames: { sprite: string }[] }>; projectiles?: Record<string, { sprite: string }> };
type RawStage = { layers?: { atlasKey: string }[] };

function main(): void {
  const charDir = join(ROOT, "src", "data", "characters");
  const charFiles: RawSheet[] = ["brawler", "fire-caster", "ice-caster", "ninja", "swordsman", "support-mage"]
    .map((id) => JSON.parse(readFileSync(join(charDir, `${id}.json`), "utf8")));
  const weapons = JSON.parse(readFileSync(join(ROOT, "src", "data", "weapons.json"), "utf8")) as Record<string, unknown>;
  const items = JSON.parse(readFileSync(join(ROOT, "src", "data", "items.json"), "utf8")) as Record<string, unknown>;
  const stageDir = join(ROOT, "src", "data", "stages");
  const stages: RawStage[] = ["grassland-dojo", "rooftop-night"]
    .map((id) => JSON.parse(readFileSync(join(stageDir, `${id}.json`), "utf8")));

  // Fighters: every MoveFrame.sprite plus the `<charId>_idle` fallback keys.
  const fighterKeys = new Set<string>();
  for (const sheet of charFiles) {
    fighterKeys.add(`${sheet.id}_idle`);
    for (const move of Object.values(sheet.moves)) {
      for (const frame of move.frames) fighterKeys.add(frame.sprite);
    }
  }

  // FX: projectile sprites.
  const fxKeys = new Set<string>();
  for (const sheet of charFiles) {
    for (const proj of Object.values(sheet.projectiles ?? {})) fxKeys.add(proj.sprite);
  }

  // Props: weapons and items as `prop_<defId>`.
  const propKeys = new Set<string>([...Object.keys(weapons), ...Object.keys(items)].map((id) => `prop_${id}`));

  // BG: stage parallax layer atlasKeys.
  const bgKeys = new Set<string>();
  for (const stage of stages) {
    for (const layer of stage.layers ?? []) bgKeys.add(layer.atlasKey);
  }

  buildAtlas("fighters", [...fighterKeys].sort(), 48, 64, true);
  buildAtlas("props", [...propKeys].sort(), 32, 32, false);
  buildAtlas("fx", [...fxKeys].sort(), 32, 32, false);
  buildAtlas("bg", [...bgKeys].sort(), 256, 128, false);
}

main();
