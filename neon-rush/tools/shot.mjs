#!/usr/bin/env node
// NEON RUSH — tools/shot.mjs — screenshot + console-error harness (Playwright).
// Implements the "Photo API" + window.__NR debug API contract from ARCHITECTURE.md.
//
// Chromium is launched with software WebGL2 (SwiftShader):
//   ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
// SwiftShader renders slowly (~5-20 FPS): every wait is frame/condition based,
// never wall-clock based.
//
// Usage:
//   node tools/shot.mjs --set run,menu,death --out /tmp/shots [--width 1600] [--height 900]
//                       [--port 3050] [--seed 7] [--extra "m=500&tier=3"]
//
// Exit codes: 0 = clean · 1 = pageerror / console error / hard scenario failure
//             2 = setup error (server unreachable, bad args, playwright missing)

import path from 'node:path';
import fsp from 'node:fs/promises';
import { parseArgs } from 'node:util';

const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const BOOT_TIMEOUT_MS = 45_000;      // window.__NR.ready must appear within this
const READY_PROMISE_CAP_MS = 30_000; // and the ready promise must settle within this
const STEP_TIMEOUT_MS = 120_000;     // per __NR.* call (SwiftShader warp can be slow)
const NAV_TIMEOUT_MS = 60_000;
const RENDER_RAFS = 3;               // rendered frames to wait after scenario setup
const MAX_CONSOLE_ENTRIES = 2000;
const MAX_TEXT_LEN = 4000;
const DIRECT_METHODS = ['forceState', 'forcePhase', 'warp', 'teleport'];

// ---------------------------------------------------------------------------
// SCENARIOS — add new photo scenarios HERE (name -> { at, steps }).
//
//   at:     default game-seconds; sent as the ?at= query param (Photo API).
//   steps:  applied in order after __NR.ready. Each is wrapped; a missing
//           __NR method marks the scenario "skipped (no __NR.x)", a thrown
//           error marks it "error" — neither aborts the batch.
//             ['forceState', 'RUN']        -> __NR.forceState('RUN')
//             ['forcePhase', 'flight']     -> __NR.forcePhase('flight')
//             ['warp', 8]                  -> __NR.warp(8)
//             ['teleport', 500]            -> __NR.teleport(500)
//             ['ui', 'shop']               -> __NR.ui.show('shop'), falling back
//                                             to __NR.game.ui.show, then bus
//                                             'ui:screen' emit (whichever exists)
//             ['emit', 'ui:toast', {...}]  -> bus.emit(...) (window.bus || __NR.bus)
//
// The URL always also carries ?photo=<name>&seed=<seed>&at=<at> per the Photo
// API; if main.js honors those params the calls stack deterministically with
// the steps below (same result every run for a given seed).
// ---------------------------------------------------------------------------
const SCENARIOS = {
  menu:        { at: 0,  steps: [['forceState', 'MENU']] },
  run:         { at: 8,  steps: [['warp', 8]] },
  run30:       { at: 30, steps: [['warp', 30]] },
  flight:      { at: 6,  steps: [['forceState', 'RUN'], ['forcePhase', 'flight'], ['warp', 6]] },
  drift:       { at: 6,  steps: [['forceState', 'RUN'], ['forcePhase', 'drift'], ['warp', 6]] },
  hopper:      { at: 6,  steps: [['forceState', 'RUN'], ['forcePhase', 'hopper'], ['warp', 6]] },
  stack:       { at: 6,  steps: [['forceState', 'RUN'], ['forcePhase', 'stack'], ['warp', 6]] },
  orb:         { at: 6,  steps: [['forceState', 'RUN'], ['forcePhase', 'orb'], ['warp', 6]] },
  death:       { at: 8,  steps: [['forceState', 'RUN'], ['warp', 8], ['forceState', 'DEAD']] },
  shop:        { at: 0,  steps: [['forceState', 'MENU'], ['ui', 'shop']] },
  'menu-meta': { at: 0,  steps: [['forceState', 'MENU'], ['ui', 'missions']] }, // meta UI (XP/daily/missions)
};

function pad(s, n) { s = String(s); return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length); }
function truncate(t) { t = String(t); return t.length > MAX_TEXT_LEN ? t.slice(0, MAX_TEXT_LEN) + '...[truncated]' : t; }

async function loadPlaywright() {
  try { return await import('playwright'); }
  catch (e) {
    console.error('ERROR: playwright not found — run `npm install` in /workspace/neon-rush (' + e.message + ')');
    process.exit(2);
  }
}

async function probeServer(port) {
  const base = `http://127.0.0.1:${port}`;
  try {
    await fetch(base + '/', { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(`ERROR: no dev server reachable at ${base} — start it first, then re-run:`);
    console.error(`  python3 tools/server.py ${port}`);
    process.exit(2);
  }
}

function buildUrl(name, cfg, opts) {
  let u = `http://127.0.0.1:${opts.port}/?photo=${encodeURIComponent(name)}` +
          `&seed=${encodeURIComponent(opts.seed)}&at=${cfg.at}`;
  if (opts.extra) u += '&' + opts.extra.replace(/^[?&]+/, '');
  return u;
}

function attachCapture(page, rec) {
  page.on('console', m => {
    if (rec.console.length < MAX_CONSOLE_ENTRIES) {
      rec.console.push({ type: m.type(), text: truncate(m.text()) });
    }
  });
  page.on('pageerror', e => {
    rec.pageerrors.push({
      message: truncate((e && e.message) || String(e)),
      stack: truncate((e && e.stack) || ''),
    });
  });
  page.on('requestfailed', r => {
    rec.failedRequests.push({ url: r.url(), failure: (r.failure() && r.failure().errorText) || 'failed' });
  });
  page.on('response', r => {
    if (r.status() >= 400) rec.failedRequests.push({ url: r.url(), status: r.status() });
  });
  page.on('crash', () => rec.pageerrors.push({ message: 'PAGE CRASHED', stack: '' }));
}

async function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, rej) => {
    timer = setTimeout(() => rej(Object.assign(new Error(`${label} timed out after ${ms}ms`), { isTimeout: true })), ms);
  });
  try { return await Promise.race([promise, guard]); }
  finally { clearTimeout(timer); }
}

function bootTimeoutError(rec, extra) {
  const tail = rec.console.slice(-12).map(c => `  [${c.type}] ${c.text}`).join('\n');
  const msg = `BOOT TIMEOUT: ${extra || `window.__NR.ready not seen within ${BOOT_TIMEOUT_MS / 1000}s`}` +
              `\nlast console lines:\n${tail || '  (none captured)'}`;
  return new Error(msg);
}

// Resolves only once __NR exists, __NR.ready is present AND the ready promise settles.
async function waitReady(page, rec) {
  let present = true;
  try {
    await page.waitForFunction(() => !!(window.__NR && window.__NR.ready), null,
                               { polling: 100, timeout: BOOT_TIMEOUT_MS });
  } catch { present = false; }
  if (!present) throw bootTimeoutError(rec);
  const res = await withTimeout(page.evaluate(cap => new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) resolve(`ready promise did not settle in ${cap / 1000}s`); }, cap);
    Promise.resolve(window.__NR.ready).then(
      () => { done = true; clearTimeout(t); resolve(null); },
      e => { done = true; clearTimeout(t); resolve('ready promise rejected: ' + ((e && e.message) || e)); },
    );
  }), READY_PROMISE_CAP_MS), READY_PROMISE_CAP_MS + 5000, 'ready wait');
  if (res) throw bootTimeoutError(rec, res);
}

// Waits exactly n requestAnimationFrame callbacks (frame-based, not wall-clock).
async function waitRafs(page, n) {
  await page.evaluate(cnt => new Promise(resolve => {
    let i = 0;
    const tick = () => { if (++i >= cnt) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), n);
}

// Executes one scenario step. Returns {ok} | {skipped:reason} | {error:reason}.
async function runStep(page, step) {
  const [kind, ...args] = step;
  try {
    return await withTimeout(page.evaluate(({ kind, args }) => {
      const nr = window.__NR || {};
      if (kind === 'ui') {
        const tries = [];
        const candidates = [
          ['__NR.ui.show', nr.ui && typeof nr.ui.show === 'function' ? () => nr.ui.show(args[0]) : null],
          ['__NR.game.ui.show', nr.game && nr.game.ui && typeof nr.game.ui.show === 'function' ? () => nr.game.ui.show(args[0]) : null],
        ];
        for (const [name, fn] of candidates) {
          if (!fn) continue;
          try { fn(); return { ok: true, via: name }; }
          catch (e) { tries.push(`${name}: ${e && e.message}`); }
        }
        const bus = window.bus || nr.bus;
        if (bus && typeof bus.emit === 'function') {
          try { bus.emit('ui:screen', args[0]); return { ok: true, via: "bus.emit('ui:screen')" }; }
          catch (e) { tries.push(`bus.emit: ${e && e.message}`); }
        }
        return tries.length ? { error: 'ui step failed — ' + tries.join('; ') }
                            : { skipped: 'no __NR.ui.show / __NR.game.ui.show / bus (ui screen: ' + args[0] + ')' };
      }
      if (kind === 'emit') {
        const bus = window.bus || nr.bus;
        if (!bus || typeof bus.emit !== 'function') return { skipped: 'no bus (window.bus / __NR.bus)' };
        try { bus.emit(args[0], args[1]); return { ok: true }; }
        catch (e) { return { error: `bus.emit(${args[0]}) threw: ${e && e.stack}` }; }
      }
      if (!['forceState', 'forcePhase', 'warp', 'teleport'].includes(kind)) return { error: `unknown step kind '${kind}'` };
      if (!nr || typeof nr[kind] !== 'function') return { skipped: `no __NR.${kind}` };
      try { nr[kind](...args); return { ok: true }; }
      catch (e) { return { error: `__NR.${kind} threw: ${e && e.stack}` }; }
    }, { kind, args }), STEP_TIMEOUT_MS, `__NR.${kind}`);
  } catch (e) {
    return { error: e.isTimeout ? e.message : `page.evaluate failed: ${(e && e.message || e).toString().split('\n')[0]}` };
  }
}

async function runScenario(browser, name, cfg, opts) {
  const rec = {
    name, status: 'ok', reason: '', ms: 0, consoleErrors: 0,
    url: '', shot: '', console: [], pageerrors: [], failedRequests: [],
  };
  const t0 = Date.now();
  let context = null;
  try {
    context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    attachCapture(page, rec);
    rec.url = buildUrl(name, cfg, opts);
    try {
      await page.goto(rec.url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    } catch (e) {
      throw new Error(`navigation failed: ${((e && e.message) || e).toString().split('\n')[0]}`);
    }
    await waitReady(page, rec);

    for (const step of cfg.steps) {
      const r = await runStep(page, step);
      if (r && r.skipped) { rec.status = 'skipped'; rec.reason = r.skipped; break; }
      if (r && r.error) { rec.status = 'error'; rec.reason = r.error.split('\n')[0]; break; }
    }

    await waitRafs(page, RENDER_RAFS);
    rec.shot = path.join(opts.out, `${name}.png`);
    await page.screenshot({ path: rec.shot });
  } catch (e) {
    if (rec.status === 'ok') rec.status = 'error';
    if (!rec.reason) rec.reason = ((e && e.message) || String(e));
    console.error(`[${name}] ${rec.status.toUpperCase()}: ${rec.reason}`);
  } finally {
    rec.ms = Date.now() - t0;
    rec.consoleErrors = rec.console.filter(c => c.type === 'error').length;
    // A hard harness failure with no captured page error still counts as an error
    // for the exit code: record it as a synthetic console entry.
    if (rec.status === 'error' && rec.consoleErrors === 0 && rec.pageerrors.length === 0) {
      rec.console.push({ type: 'error', text: `[harness] ${rec.name}: ${rec.reason}` });
      rec.consoleErrors = 1;
    }
    try {
      await fsp.writeFile(path.join(opts.out, `${name}.console.json`), JSON.stringify({
        scenario: rec.name, url: rec.url, status: rec.status, reason: rec.reason,
        ms: rec.ms, console: rec.console, pageerrors: rec.pageerrors,
        failedRequests: rec.failedRequests,
      }, null, 2));
    } catch { /* out dir unwritable — table still printed below */ }
    if (context) await context.close().catch(() => {});
  }
  return rec;
}

function printReport(results, out) {
  console.log(`\nSCENARIO         STATUS     MS      CERR PERR  NOTE`);
  for (const r of results) {
    const note = r.reason ? r.reason.split('\n')[0] : '';
    console.log(`${pad(r.name, 17)}${pad(r.status, 11)}${pad(r.ms, 8)}${pad(r.consoleErrors, 5)}${pad(r.pageerrors.length, 6)}${note}`);
  }
  const ok = results.filter(r => r.status === 'ok').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'error').length;
  const errs = results.reduce((a, r) => a + r.consoleErrors + r.pageerrors.length, 0);
  console.log(`\n${results.length} scenario(s): ${ok} ok, ${skipped} skipped, ${failed} error — ` +
              `${errs} console error(s)/pageerror(s) total. Screenshots + *.console.json in ${out}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      set:    { type: 'string', default: 'menu,run,death' },
      out:    { type: 'string', default: '/tmp/shots' },
      width:  { type: 'string', default: '1600' },
      height: { type: 'string', default: '900' },
      port:   { type: 'string', default: '3050' },
      seed:   { type: 'string', default: '7' },
      extra:  { type: 'string', default: '' },
    },
  });
  const width = Number(values.width), height = Number(values.height), port = Number(values.port);
  if (!Number.isInteger(width) || width < 16 || !Number.isInteger(height) || height < 16) {
    console.error(`error: bad --width/--height: ${values.width}x${values.height}`); process.exit(2);
  }
  const names = values.set.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = names.filter(n => !Object.prototype.hasOwnProperty.call(SCENARIOS, n));
  if (!names.length || unknown.length) {
    console.error(`error: unknown scenario(s): ${unknown.join(', ') || '(empty --set)'}` +
                  `\navailable: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(2);
  }
  await probeServer(port);
  await fsp.mkdir(values.out, { recursive: true });

  const { chromium } = await loadPlaywright();
  const results = [];
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    for (const name of names) {
      results.push(await runScenario(browser, name, SCENARIOS[name],
        { width, height, port, seed: values.seed, extra: values.extra, out: values.out }));
    }
  } finally {
    if (browser) await browser.close().catch(() => {}); // never orphan the browser
  }

  printReport(results, values.out);
  const hardFail = results.some(r => r.status === 'error');
  const errs = results.reduce((a, r) => a + r.consoleErrors + r.pageerrors.length, 0);
  process.exitCode = (hardFail || errs > 0) ? 1 : 0;
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
