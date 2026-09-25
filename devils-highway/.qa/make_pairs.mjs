#!/usr/bin/env bun
/**
 * Builds blind A/B pairs for the visual critic (main-agent tool).
 * Randomly assigns ours vs official reference to letters A/B per pair, per round.
 * Usage: bun .qa/make_pairs.mjs <roundName> <pairsSpec.json>
 *   pairsSpec: [{ scenario: "menu", ours: "shots/menu.png", ref: "reference/zombie_highway_2_1.jpg" }, ...]
 * Writes .qa/pairs/<round>/<scenario>_A.png, _B.png + manifest.json (letter→source mapping).
 */
import { copyFile, mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(new URL(".", import.meta.url))); // = endless/ (project root)
const PROJ = ROOT;
const round = process.argv[2];
const specPath = process.argv[3];
if (!round || !specPath) { console.error("usage: bun .qa/make_pairs.mjs <round> <spec.json>"); process.exit(2); }

const spec = JSON.parse(await readFile(specPath, "utf8"));
const outDir = join(ROOT, ".qa", "pairs", round);
await mkdir(outDir, { recursive: true });

const manifest = { round, seed: (Math.random() * 1e9) | 0, pairs: [] };
let s = manifest.seed;
const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };

for (const p of spec) {
  const oursAbs = join(PROJ, p.ours), refAbs = join(PROJ, p.ref);
  for (const f of [oursAbs, refAbs]) {
    const st = await stat(f).catch(() => null);
    if (!st) { console.error("MISSING:", f); process.exit(1); }
  }
  const oursIsA = rand() < 0.5;
  const aSrc = oursIsA ? oursAbs : refAbs;
  const bSrc = oursIsA ? refAbs : oursAbs;
  const extA = aSrc.endsWith(".png") ? ".png" : ".jpg";
  const extB = bSrc.endsWith(".png") ? ".png" : ".jpg";
  const a = join(outDir, `${p.scenario}_A${extA}`);
  const b = join(outDir, `${p.scenario}_B${extB}`);
  await copyFile(aSrc, a);
  await copyFile(bSrc, b);
  manifest.pairs.push({
    scenario: p.scenario,
    note: p.note || "",
    A: { path: a, source: oursIsA ? "OURS" : "REFERENCE" },
    B: { path: b, source: oursIsA ? "REFERENCE" : "OURS" },
  });
  console.log(`pair ${p.scenario}: ours=${oursIsA ? "A" : "B"}`);
}

async function readFile(f, enc) { return (await import("node:fs/promises")).readFile(f, enc); }
await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`wrote ${manifest.pairs.length} pairs + manifest (seed ${manifest.seed}) → ${outDir}`);
