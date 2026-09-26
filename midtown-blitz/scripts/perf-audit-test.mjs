#!/usr/bin/env node
/**
 * Performance audit harness (Midtown Blitz — task 6.2).
 *
 * Three plain-node sections; together with boot-integration's loading-phase
 * assertions (which pin the exact boot progress sequence and its frame
 * yields) this is the automated half of task 6.2. The REAL 60 s >= 55 fps
 * profile needs a real GPU + screen and is delegated to the orchestrator
 * (see the recipe at the bottom of this file / the task report).
 *
 * a. FPS sampler logic (src/engine/fps-meter.js): synthetic frame times —
 *    a uniform 60 fps stream reads avg ~60 / min ~60; one 150 ms stall
 *    dents the worst-second reading while the average barely moves; a long
 *    stall empties the window (no stale frames diluting the next reading);
 *    read() overwrites a reused out object; degenerate inputs read 0.
 *
 * b. Hot-path allocation audit — METHOD (documented choice): a STATIC
 *    source scan of every per-frame update/render function, not a runtime
 *    allocation counter. A stubbed-THREE runtime count would need to
 *    intercept every constructor across the real render pipeline for N
 *    frames (high coupling, brittle); a source scan is deterministic and
 *    pins the invariant where reviewers can see it. Each audited function
 *    body (comments AND strings stripped) must contain NO:
 *      - `new X` constructor calls (the big GC risk)
 *      - object/array literals assigned or returned (`= {`, `= [`,
 *        `return {`) — each is a fresh heap object per frame
 *      - allocating array methods (.map/.filter/.concat/.slice) or spread
 *    Allowlist (explicit, per function): loop.frame's single `return {`
 *    frame-info literal — that object IS the loop's public per-frame
 *    contract (LoopFrameInfo, consumed by the render hook); everything
 *    else in the body is scalar. Excluded from the audit, documented:
 *    camera-rig getDesiredPose() (debug/console inspection accessor, never
 *    called per frame) and short-lived template STRINGS in change-gated
 *    DOM writers (built only when a rounded value moved; strings are not
 *    per-frame heap churn the way objects are).
 *
 * c. Quality-tier sanity (design Decision 6 + the 6.2 trim knobs): pixel
 *    ratio caps ordered with low = 0.75 (the weak-GPU fill-rate trim),
 *    shadows only at high, draw distance ordered, camera far beyond fog
 *    for every tier, and effectivePixelRatio clamping verified.
 *
 * Run: node scripts/perf-audit-test.mjs   (plain node, no dependencies)
 */
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { createFpsMeter } from '../src/engine/fps-meter.js';
import {
  QUALITY_TIERS,
  QUALITY_TIER_NAMES,
  effectivePixelRatio,
} from '../src/engine/renderer.js';

/** Synchronous stdout write: output survives process.exit and crashes. */
function log(line) {
  fs.writeSync(1, line + '\n');
}

const checkResults = [];
function check(cond, label) {
  checkResults.push([!!cond, label]);
  if (!cond) log(`    FAIL ${label}`);
}
function section(title) {
  log('');
  log(title);
}

// ===========================================================================
// a. FPS sampler logic — synthetic frame times
// ===========================================================================
section('a. fps sampler logic (synthetic frame times)');

const FRAME = 1000 / 60;

// a1. Uniform 60 fps stream for a full 5 s window: avg ~60, min ~60.
{
  const m = createFpsMeter();
  for (let i = 0; i < 300; i += 1) m.frame(i * FRAME);
  const out = m.read();
  check(out.frames === 300, `a1: all 300 frames in window (got ${out.frames})`);
  check(Math.abs(out.avgFps - 60) < 1, `a1: uniform stream avg ~60 (got ${out.avgFps.toFixed(2)})`);
  check(
    Math.abs(out.minFps - 60) < 2,
    `a1: uniform stream worst-second ~60 (got ${out.minFps.toFixed(2)})`
  );
}

// a2. One 150 ms stall in an otherwise-60 fps stream: the average barely
//     moves, the worst-second reading clearly dips below it.
{
  const m = createFpsMeter();
  let t = 0;
  for (let i = 0; i < 300; i += 1) {
    m.frame(t);
    t += i === 150 ? 150 : FRAME; // the stall replaces frame #151's delta
  }
  const out = m.read();
  check(
    out.avgFps > 55 && out.avgFps < 60,
    `a2: stall barely moves the average (got ${out.avgFps.toFixed(2)})`
  );
  check(
    out.minFps < out.avgFps - 2,
    `a2: worst-second dips below average (min ${out.minFps.toFixed(2)} vs avg ${out.avgFps.toFixed(2)})`
  );
  check(
    out.minFps > 40 && out.minFps < 55,
    `a2: worst-second in the expected band (got ${out.minFps.toFixed(2)})`
  );
}

// a3. A long stall EMPTIES the window: stale frames must not dilute the
//     post-stall reading (the 5 s window is wall-clock trailing).
{
  const m = createFpsMeter();
  for (let i = 0; i < 61; i += 1) m.frame(i * FRAME); // 1 s of 60 fps
  m.frame(8000); // 7 s later — everything before is now outside the window
  let out = m.read();
  check(
    out.frames === 1 && out.avgFps === 0 && out.minFps === 0,
    `a3: after a 7 s stall the window holds only the fresh frame (got ${out.frames})`
  );
  for (let i = 1; i <= 60; i += 1) m.frame(8000 + i * FRAME);
  out = m.read();
  check(
    out.avgFps > 55,
    `a3: post-stall reading counts only fresh frames (avg ${out.avgFps.toFixed(2)})`
  );
  check(out.frames < 70, `a3: fresh window holds ~1 s of frames (got ${out.frames})`);
}

// a4. read() overwrites a reused out object (the panel passes one).
{
  const m = createFpsMeter();
  m.frame(0);
  m.frame(FRAME);
  const out = { avgFps: -1, minFps: -1, frames: -1 };
  m.read(out);
  check(out.frames === 2, 'a4: read() writes the passed object (frames 2)');
  for (let i = 2; i < 120; i += 1) m.frame(i * FRAME);
  m.read(out);
  check(out.frames === 120, `a4: same object shows fresh data (frames ${out.frames})`);
  check(Math.abs(out.avgFps - 60) < 1, `a4: overwritten avg still right (${out.avgFps.toFixed(2)})`);
}

// a5. Degenerate inputs: a single frame reads zeros; non-finite timestamps
//     are ignored.
{
  const m = createFpsMeter();
  let out = m.read();
  check(
    out.avgFps === 0 && out.minFps === 0 && out.frames === 0,
    'a5: empty meter reads 0/0 with 0 frames'
  );
  m.frame(123);
  out = m.read();
  check(
    out.avgFps === 0 && out.minFps === 0 && out.frames === 1,
    'a5: single frame reads 0/0 (not Infinity), frames 1'
  );
  m.frame(Number.NaN);
  m.frame(Number.POSITIVE_INFINITY);
  out = m.read();
  check(out.frames === 1, `a5: non-finite timestamps ignored (frames ${out.frames})`);
}

// ===========================================================================
// b. Hot-path allocation audit — static source scan (method in header)
// ===========================================================================
section('b. hot-path allocation audit (static source scan)');

/**
 * Strip /* *\/ block comments and // line comments (naive but safe for
 * these modules: none of the audited files contains a comment marker
 * inside a string literal; the harness's own sources are not scanned).
 * @param {string} src Source text.
 * @returns {string} Comment-free source.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\/])\/\/[^\n]*/g, '$1');
}

/**
 * Replace string and template literal contents with empty strings so scan
 * regexes cannot match inside them.
 * @param {string} src Comment-free source.
 * @returns {string} String-free source.
 */
function stripStrings(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === ch) {
          i += 1;
          break;
        }
        i += 1;
      }
      out += '""';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Extract a function body by brace-matching from the first `{` after the
 * signature `sig` (comment-stripped source).
 * @param {string} src Comment-stripped source.
 * @param {string} sig Signature fragment to locate the function.
 * @returns {string | null} The body between the outer braces, or null.
 */
function extractFn(src, sig) {
  const at = src.indexOf(sig);
  if (at === -1) return null;
  const open = src.indexOf('{', at + sig.length);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** Scan rules; `why` explains the failure in the check label. */
const RULES = [
  { re: /\bnew\s+[A-Za-z_$]/, why: '`new X` constructor allocation' },
  { re: /=\s*\{/, why: 'object literal assigned (`= {`)' },
  { re: /=\s*\[/, why: 'array literal assigned (`= [`)' },
  { re: /return\s*\{/, why: 'object literal returned (`return {`)' },
  { re: /\.map\(|\.filter\(|\.concat\(|\.slice\(/, why: 'allocating array method' },
  { re: /\.\.\./, why: 'spread allocation' },
];

/**
 * The per-frame functions under audit. `allow` lists body substrings whose
 * rule hits are accepted (documented exceptions only).
 * @type {{ file: string, sig: string, label: string, allow?: string[] }[]}
 */
const AUDITS = [
  { file: 'src/game/traffic-view.js', sig: 'function update()', label: 'trafficView.update()' },
  {
    file: 'src/game/car-view.js',
    sig: 'function update(state, controls, alpha = 1, prev = null)',
    label: 'carView.update()',
  },
  { file: 'src/engine/camera-rig.js', sig: 'update(dt) {', label: 'cameraRig.update()' },
  {
    file: 'src/engine/loop.js',
    sig: 'function frame(nowMs)',
    label: 'loop.frame()',
    allow: ['return {'], // the LoopFrameInfo object — the loop's public per-frame contract
  },
  {
    file: 'src/game/checkpoint-marker.js',
    sig: 'update(dt, camera) {',
    label: 'checkpointMarker.update()',
  },
  { file: 'src/ui/hud.js', sig: 'updateCheckpoint(camera) {', label: 'hud.updateCheckpoint()' },
  {
    file: 'src/ui/checkpoint-arrow.js',
    sig: 'computeCheckpointIndicator(out, p) {',
    label: 'checkpoint-arrow computeCheckpointIndicator()',
  },
  { file: 'src/engine/fps-meter.js', sig: 'function frame(nowMs)', label: 'fpsMeter.frame()' },
  { file: 'src/engine/fps-meter.js', sig: 'function read(out)', label: 'fpsMeter.read()' },
  {
    file: 'src/main.js',
    sig: 'render: (alpha, info) =>',
    label: 'main render hook',
  },
];

let auditedBodies = 0;
for (const audit of AUDITS) {
  const raw = readFileSync(new URL(`../${audit.file}`, import.meta.url), 'utf8');
  const clean = stripStrings(stripComments(raw));
  const body = extractFn(clean, audit.sig);
  if (!body) {
    check(false, `b: ${audit.label} — could not locate body via "${audit.sig}" in ${audit.file}`);
    continue;
  }
  auditedBodies += 1;
  const lines = body.split('\n');
  let violations = [];
  for (const rule of RULES) {
    for (const line of lines) {
      if (!rule.re.test(line)) continue;
      if (audit.allow && audit.allow.some((a) => line.includes(a))) continue;
      violations.push(`${rule.why}: "${line.trim().slice(0, 60)}"`);
    }
  }
  check(
    violations.length === 0,
    violations.length === 0
      ? `b: ${audit.label} allocates nothing`
      : `b: ${audit.label} — ${violations.length} hit(s): ${violations[0]}`
  );
}
check(auditedBodies === AUDITS.length, `b: all ${AUDITS.length} audited bodies were found + scanned`);

// ===========================================================================
// c. Quality-tier sanity (design Decision 6 — the 6.2 trim knobs)
// ===========================================================================
section('c. quality-tier sanity (design Decision 6)');

check(
  QUALITY_TIERS.low.pixelRatioCap === 0.75,
  `c: low tier caps pixel ratio at 0.75 (got ${QUALITY_TIERS.low.pixelRatioCap})`
);
check(
  QUALITY_TIERS.low.pixelRatioCap < QUALITY_TIERS.medium.pixelRatioCap &&
    QUALITY_TIERS.medium.pixelRatioCap < QUALITY_TIERS.high.pixelRatioCap,
  'c: pixel ratio caps ordered low < medium < high'
);
check(
  !QUALITY_TIERS.low.shadows && !QUALITY_TIERS.medium.shadows && QUALITY_TIERS.high.shadows,
  'c: shadow pass only at high tier (medium cruise carries no shadow render)'
);
check(
  QUALITY_TIERS.low.shadowMapSize === 1024 && QUALITY_TIERS.high.shadowMapSize === 2048,
  'c: shadow map sizes sane (1024 low / 2048 high)'
);
check(
  QUALITY_TIERS.low.fogFar < QUALITY_TIERS.medium.fogFar &&
    QUALITY_TIERS.medium.fogFar < QUALITY_TIERS.high.fogFar,
  'c: draw distance (fogFar) ordered low < medium < high'
);
check(
  QUALITY_TIERS.medium.fogFar === 260,
  `c: medium fogFar 260 — matches the traffic recycle radius (got ${QUALITY_TIERS.medium.fogFar})`
);
for (const tierName of QUALITY_TIER_NAMES) {
  const t = QUALITY_TIERS[tierName];
  check(t.cameraFar > t.fogFar, `c: ${tierName} cameraFar beyond fogFar (${t.cameraFar} > ${t.fogFar})`);
  check(
    Number.isFinite(t.pixelRatioCap) && t.pixelRatioCap > 0,
    `c: ${tierName} pixel ratio cap positive + finite`
  );
}
check(effectivePixelRatio('low', 3) === 0.75, 'c: effectivePixelRatio clamps a 3x display to 0.75');
check(effectivePixelRatio('medium', 1) === 1, 'c: effectivePixelRatio leaves a 1x display at 1');
check(effectivePixelRatio('high', 2) === 2, 'c: effectivePixelRatio leaves a 2x display at 2');

// --- budget summary (documentation; draw counts are PINNED by boot-integration)
log('');
log('  budget summary (medium tier, chase view, full traffic):');
log('    - draw calls: 30 pinned by boot-integration (city ~12 + car ~14 + traffic 3 + parked 2)');
log('      -> far under the ~50 budget; overhead view pins 32. NO trim needed.');
log('    - per-tick sim cost (from module harnesses): city-gen ~1 ms (boot only),');
log('      collision ~1.4 ms / 10k queries, car physics 0.8 us/tick, traffic +');
log('      car-car collisions ~0.006 ms/tick avg — the 60 Hz sim budget is not at risk.');
log('    - fill-rate (the weak-GPU risk): tier table already trims pixel ratio first');
log('      (0.75 / 1.5 / 2 caps) and disables shadows below high — asserted in section c.');
log('    - live 60 s avg >= 55 fps measurement: needs a real GPU -> orchestrator recipe:');
log('      open http://localhost:5173/?debug, drive Cruise with full traffic for 60 s,');
log('      read "fps avg ... min ..." (bottom line of the top-right QUALITY DEBUG panel)');
log('      or evaluate __game.fps.read() in the console; record avgFps (>= 55 passes)');

const failed = checkResults.filter(([ok]) => !ok).length;
log(
  failed === 0
    ? `  PASS perf-audit (${checkResults.length} checks)`
    : `  perf-audit: ${failed}/${checkResults.length} checks FAILED`
);
process.exitCode = failed === 0 ? 0 : 1;
