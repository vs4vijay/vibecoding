#!/usr/bin/env node
/**
 * tools/compare.mjs — dependency-free pixel comparison for aaa-visual-overhaul
 * stage gates (task 1.8).
 *
 * Compares each stage capture in <stage>/fullres/<scenario>.png against the
 * matching pre-change capture in <baseline>/fullres/<scenario>.png and reports:
 *   - dimensions match
 *   - per-channel (r/g/b) mean/std on each image
 *   - luma (Rec.709) mean/std on each image
 *   - mean absolute difference (MAD) over a 64x36 block-downsampled grid
 *     (each cell = mean abs diff of its 20x20-pixel block, all channels)
 *   - fraction of grid cells whose mean abs diff exceeds 24 ("hot cells")
 *   - coarse verdict: near-identical | changed-subtle | changed-significant
 *
 * The PNG decoder is duplicated (not imported) from tools/capture.mjs because
 * that module executes main() at import time and exports nothing. Decode path
 * is minimal: 8-bit, non-interlaced, color type 2 (RGB) or 6 (RGBA).
 *
 * Usage:
 *     node tools/compare.mjs [--baseline dir] [--stage dir] [--out file]
 *
 *     --baseline dir   pre-change captures (default:
 *                      evidence/aaa-visual-overhaul/baseline)
 *     --stage dir      current captures  (default:
 *                      evidence/aaa-visual-overhaul/stage0)
 *     --out file       JSON report path (default: <stage>/compare-vs-baseline.json)
 *     --help           this text
 *
 * Zero npm dependencies (node builtins only). bun node is fine too.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SCENARIOS = [
  "car-side-profile",
  "combat-mid",
  "horde-max",
  "lamp-pool",
  "title",
  "game-over",
];

const GRID_W = 64;
const GRID_H = 36;

// Verdict thresholds (8-bit units, coarse by design):
//  MAD   = mean absolute difference over the whole downsampled grid
//  hotFrac = fraction of grid cells with cellMAD > 24 (a real structural shift)
const NEAR_IDENTICAL_MAD = 3;
const NEAR_IDENTICAL_HOT = 0.01;
const SUBTLE_MAD = 12;
const SUBTLE_HOT = 0.35;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(code = 0) {
  console.log(
    [
      "undead-driver pixel compare (stage gate vs pre-change baseline)",
      "",
      "  node tools/compare.mjs [--baseline dir] [--stage dir] [--out file]",
      "",
      "  --baseline dir   default: evidence/aaa-visual-overhaul/baseline",
      "  --stage dir      default: evidence/aaa-visual-overhaul/stage0",
      "  --out file       default: <stage>/compare-vs-baseline.json",
      "  --help           this text",
      "",
      `Scenarios: ${SCENARIOS.join(" ")}`,
    ].join("\n"),
  );
  process.exit(code);
}

function parseArgs(argv) {
  let baseline = "evidence/aaa-visual-overhaul/baseline";
  let stage = "evidence/aaa-visual-overhaul/stage0";
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage(0);
    else if (a === "--baseline") baseline = argv[++i] ?? die("--baseline needs a value");
    else if (a === "--stage") stage = argv[++i] ?? die("--stage needs a value");
    else if (a === "--out") out = argv[++i] ?? die("--out needs a value");
    else if (a.startsWith("--")) die(`unknown flag: ${a}`);
    else die(`unexpected positional arg: ${a}`);
  }
  return { baseline: path.resolve(baseline), stage: path.resolve(stage), out };
}

function die(msg) {
  console.error(`compare: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// PNG decode — duplicated minimal path from tools/capture.mjs (not exported
// there; that file runs main() on import). 8-bit, non-interlaced, RGB/RGBA.
// ---------------------------------------------------------------------------

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG (bad signature)");
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (!width || !height) throw new Error("PNG missing IHDR dimensions");
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : -1;
  if (bpp === -1) throw new Error(`unsupported color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let val = line[x];
      switch (filter) {
        case 1: val += a; break;
        case 2: val += b; break;
        case 3: val += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          val += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
      }
      cur[x] = val & 0xff;
    }
  }
  return { width, height, bpp, pixels: out };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Per-channel + luma mean/std over the full-res pixels. */
function channelStats(img) {
  const { width, height, bpp, pixels } = img;
  const n = width * height;
  const sums = [0, 0, 0];
  const sumSqs = [0, 0, 0];
  let lumaSum = 0;
  let lumaSumSq = 0;
  for (let i = 0; i < n; i++) {
    const o = i * bpp;
    const r = pixels[o];
    const g = pixels[o + 1];
    const b = pixels[o + 2];
    sums[0] += r; sumSqs[0] += r * r;
    sums[1] += g; sumSqs[1] += g * g;
    sums[2] += b; sumSqs[2] += b * b;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumaSum += luma;
    lumaSumSq += luma * luma;
  }
  const stat = (sum, sumSq) => {
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    return { mean: round2(mean), std: round2(std) };
  };
  return {
    r: stat(sums[0], sumSqs[0]),
    g: stat(sums[1], sumSqs[1]),
    b: stat(sums[2], sumSqs[2]),
    luma: stat(lumaSum, lumaSumSq),
  };
}

const round2 = (v) => Number(v.toFixed(2));

/**
 * Block-average both images down to GRID_W x GRID_H luma cells, then compute
 * the mean absolute difference across all cells plus the hot-cell fraction.
 */
function gridDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return null;
  const cellW = a.width / GRID_W;
  const cellH = a.height / GRID_H;
  const ca = gridLuma(a, cellW, cellH);
  const cb = gridLuma(b, cellW, cellH);
  let sum = 0;
  let hot = 0;
  const perCell = new Array(GRID_W * GRID_H);
  for (let i = 0; i < ca.length; i++) {
    const d = Math.abs(ca[i] - cb[i]);
    perCell[i] = round2(d);
    sum += d;
    if (d > 24) hot++;
  }
  const mad = sum / ca.length;
  return { mad: round2(mad), hotFrac: Number((hot / ca.length).toFixed(4)), perCell };
}

/** Downsample to GRID_W x GRID_H cells of mean Rec.709 luma. */
function gridLuma(img, cellW, cellH) {
  const { width, bpp, pixels } = img;
  const cells = new Float64Array(GRID_W * GRID_H);
  for (let cy = 0; cy < GRID_H; cy++) {
    const y0 = Math.floor(cy * cellH);
    const y1 = Math.floor((cy + 1) * cellH);
    for (let cx = 0; cx < GRID_W; cx++) {
      const x0 = Math.floor(cx * cellW);
      const x1 = Math.floor((cx + 1) * cellW);
      let acc = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y++) {
        let o = (y * width + x0) * bpp;
        for (let x = x0; x < x1; x++) {
          acc += 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];
          o += bpp;
          cnt++;
        }
      }
      cells[cy * GRID_W + cx] = acc / cnt;
    }
  }
  return cells;
}

function verdict(mad, hotFrac) {
  if (mad < NEAR_IDENTICAL_MAD && hotFrac < NEAR_IDENTICAL_HOT) return "near-identical";
  if (mad < SUBTLE_MAD && hotFrac < SUBTLE_HOT) return "changed-subtle";
  return "changed-significant";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { baseline, stage, out } = parseArgs(process.argv.slice(2));
  const baseDir = path.join(baseline, "fullres");
  const stageDir = path.join(stage, "fullres");
  const outPath = out ? path.resolve(out) : path.join(stage, "compare-vs-baseline.json");

  const pairs = [];
  let failures = 0;
  const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));

  console.log(
    `compare: baseline ${baseDir}\ncompare: stage    ${stageDir}\n` +
      `compare: grid ${GRID_W}x${GRID_H} (cells over 24 luma = "hot")\n`,
  );
  console.log(
    `${pad("scenario", 18)}${pad("dims", 12)}${pad("MAD", 7)}${pad("hot%", 7)}` +
      `${pad("luma b->s (mean)", 22)}${pad("verdict", 22)}notes`,
  );
  console.log("-".repeat(110));

  for (const name of SCENARIOS) {
    const bp = path.join(baseDir, `${name}.png`);
    const sp = path.join(stageDir, `${name}.png`);
    const notes = [];
    try {
      const bImg = decodePng(fs.readFileSync(bp));
      const sImg = decodePng(fs.readFileSync(sp));
      const dimsMatch = bImg.width === sImg.width && bImg.height === sImg.height;
      if (!dimsMatch) notes.push(`DIMS MISMATCH ${bImg.width}x${bImg.height} vs ${sImg.width}x${sImg.height}`);
      const bStats = channelStats(bImg);
      const sStats = channelStats(sImg);
      const gd = gridDiff(bImg, sImg);
      const v = gd ? verdict(gd.mad, gd.hotFrac) : "skipped";
      if (!dimsMatch) failures++;
      if (v === "near-identical") notes.push("pipeline may not have taken effect");

      pairs.push({
        scenario: name,
        baseline: { path: bp, width: bImg.width, height: bImg.height, stats: bStats },
        stage: { path: sp, width: sImg.width, height: sImg.height, stats: sStats },
        dimensionsMatch: dimsMatch,
        mad: gd ? gd.mad : null,
        hotCellFraction: gd ? gd.hotFrac : null,
        verdict: v,
        notes,
      });

      console.log(
        `${pad(name, 18)}${pad(`${sImg.width}x${sImg.height}`, 12)}` +
          `${pad(String(gd ? gd.mad : "-"), 7)}${pad(gd ? (gd.hotFrac * 100).toFixed(1) : "-", 7)}` +
          `${pad(`${bStats.luma.mean}->${sStats.luma.mean}`, 22)}${pad(v, 22)}${notes.join("; ")}`,
      );
    } catch (err) {
      failures++;
      pairs.push({ scenario: name, baseline: { path: bp }, stage: { path: sp }, error: err.message });
      console.log(`${pad(name, 18)}${pad("-", 12)}${pad("-", 7)}${pad("-", 7)}${pad("-", 22)}${pad("ERROR", 22)}${err.message}`);
    }
  }
  console.log("-".repeat(110));

  const report = {
    generatedAt: new Date().toISOString(),
    purpose: "aaa-visual-overhaul task 1.8 — stage0 captures vs pre-change baseline",
    grid: { w: GRID_W, h: GRID_H, cellThreshold: 24 },
    verdictThresholds: {
      nearIdentical: { mad: NEAR_IDENTICAL_MAD, hotFrac: NEAR_IDENTICAL_HOT },
      changedSubtle: { mad: SUBTLE_MAD, hotFrac: SUBTLE_HOT },
    },
    baselineDir: baseDir,
    stageDir,
    pairs,
    failures,
  };
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\ncompare: report -> ${outPath}`);
  console.log(`compare: ${failures === 0 ? "no hard failures" : `${failures} failure(s)`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
