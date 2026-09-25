#!/usr/bin/env node
// NEON RUSH — tools/perf.mjs — headless perf probe (Playwright + SwiftShader).
//
// IMPORTANT: SwiftShader renders on CPU (~5-20 FPS for a real scene). Headless
// fps is NOT representative of real hardware. Treat drawCalls / triangles /
// programs / heap as the primary signals; fps here only tracks relative
// regressions of the same build.
//
// Usage:
//   node tools/perf.mjs [--seconds 12] [--scenario run] [--port 3050]
//                       [--seed 7] [--width 1280] [--height 720] [--leak]
//
// --leak: 10 minutes of simulated play (warp in 30 s chunks, periodic run
//         restarts), heap sampled every 30 s -> GROWING/STABLE verdict.

import fsp from 'node:fs/promises';
import { parseArgs } from 'node:util';

const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const SCEN_WARP = { menu: 0, run: 8, run30: 30, flight: 6, drift: 6, hopper: 6, stack: 6, orb: 6, death: 8 };

async function loadPlaywright() {
  try { return await import('playwright'); }
  catch (e) {
    console.error('ERROR: playwright not found — run `npm install` in /workspace/neon-rush (' + e.message + ')');
    process.exit(2);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      seconds:  { type: 'string', default: '12' },
      scenario: { type: 'string', default: 'run' },
      port:     { type: 'string', default: '3050' },
      seed:     { type: 'string', default: '7' },
      width:    { type: 'string', default: '1280' },
      height:   { type: 'string', default: '720' },
      leak:     { type: 'boolean', default: false },
    },
  });
  const seconds = Number(values.seconds), port = Number(values.port);
  const base = `http://127.0.0.1:${port}`;
  try { await fetch(base + '/', { signal: AbortSignal.timeout(3000) }); }
  catch { console.error(`ERROR: no server at ${base} — start: python3 tools/server.py ${port}`); process.exit(2); }

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  let exitCode = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: Number(values.width), height: Number(values.height) }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${base}/?photo=${values.scenario}&seed=${values.seed}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => !!(window.__NR && window.__NR.ready), null, { polling: 100, timeout: 45000 })
      .catch(() => {});
    await page.evaluate(at => window.__NR && window.__NR.warp && window.__NR.warp(at), SCEN_WARP[values.scenario] ?? 8);

    if (!values.leak) {
      // rAF-sampled fps over `seconds` of wall clock (SwiftShader — relative only)
      const sample = await page.evaluate(dur => new Promise(resolve => {
        const frames = []; let last = performance.now(); let n = 0;
        function tick(t) {
          frames.push(t - last); last = t; n++;
          if ((t - frames.t0) / 1000 >= dur) return resolve({ frames });
          if (!frames.t0) frames.t0 = t;
          requestAnimationFrame(tick);
        }
        frames.t0 = performance.now();
        requestAnimationFrame(tick);
      }), seconds);
      const ft = sample.frames.slice(1).sort((a, b) => a - b);
      const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
      const p1 = ft[Math.max(0, Math.floor(ft.length * 0.01))];
      const stats = await page.evaluate(() => window.__NR.stats());
      console.log('NEON RUSH perf probe (headless-software renderer — fps relative only)');
      console.log(`scenario=${values.scenario} seed=${values.seed} ${values.width}x${values.height} wall=${seconds}s`);
      console.log(`frames=${ft.length} avgFrame=${avg.toFixed(1)}ms fps≈${(1000 / avg).toFixed(1)} p99Frame=${p1.toFixed(0)}ms`);
      console.log(`drawCalls avg=${stats.drawCalls} triangles=${stats.triangles} programs=${stats.programs} geometries=${stats.geometries}`);
      if (stats.pools) console.log(`pools=${JSON.stringify(stats.pools)}`);
      console.log(`console/page errors during run: ${errors.length}${errors.length ? '\n  ' + errors.slice(0, 5).join('\n  ') : ''}`);
      exitCode = (stats.drawCalls > 150 || errors.length > 0) ? 1 : 0;
      if (stats.drawCalls > 150) console.log('VERDICT: FAIL — draw calls over 150 budget');
      else console.log('VERDICT: PASS');
    } else {
      // leak mode: ~10 min simulated play, heap trend
      console.log('NEON RUSH leak probe — 10 min simulated play (warp chunks + restarts)');
      const cdp = await context.newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      const samples = [];
      const t0 = Date.now();
      let i = 0;
      while (Date.now() - t0 < 10 * 60 * 1000) {
        await page.evaluate(() => window.__NR.warp(30)).catch(e => errors.push('warp: ' + e.message));
        i++;
        if (i % 4 === 0) { // every ~2 warps do a restart cycle to exercise pool reset
          await page.evaluate(() => { window.__NR.forceState('DEAD'); window.__NR.forceState('RUN'); }).catch(e => errors.push('restart: ' + e.message));
        }
        if (i % 6 === 0) {
          await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
          const m = await cdp.send('Performance.getMetrics').catch(() => null);
          const jsHeap = m && m.metrics.find(x => x.name === 'JSHeapUsedSize');
          const draw = await page.evaluate(() => window.__NR.stats().drawCalls).catch(() => -1);
          if (jsHeap) samples.push({ t: ((Date.now() - t0) / 60000).toFixed(1), mb: (jsHeap.value / 1048576).toFixed(1), draw });
          console.log(`  t=${((Date.now() - t0) / 60000).toFixed(1)}min heap=${samples.at(-1)?.mb ?? '?'}MB drawCalls=${draw}`);
        }
      }
      const first = Number(samples[0]?.mb), last = Number(samples.at(-1)?.mb);
      const verdict = (!isFinite(first) || !isFinite(last)) ? 'UNKNOWN'
        : (last > first * 1.2 ? 'GROWING' : 'STABLE');
      console.log(`heap ${first}MB -> ${last}MB over 10min: ${verdict}`);
      console.log(`errors: ${errors.length}${errors.length ? '\n  ' + errors.slice(0, 8).join('\n  ') : ''}`);
      exitCode = verdict === 'GROWING' || errors.length > 0 ? 1 : 0;
    }
    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }
  process.exitCode = exitCode;
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
