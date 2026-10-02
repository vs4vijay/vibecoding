// Reusable browser QA capture helper (main agent only).
// Usage from mcp__node_repl__js:
//   const { setup, capture } = await import("file:///workspace/subway-surfers/.qa/capture.mjs");
//   const browser = await setup();
//   await capture(browser, "http://127.0.0.1:8899/index.html?qa=1", "/workspace/subway-surfers/.qa/screenshots/x.png");
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PLUGIN_ROOT = process.env.ZCODE_PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT;
const SHOT_DIR = "/workspace/subway-surfers/.qa/screenshots";

export async function setup() {
  const { setupBrowserRuntime } = await import(
    pathToFileURL(join(PLUGIN_ROOT, "scripts", "browser-client.mjs")).href
  );
  await setupBrowserRuntime({ globals: globalThis });
  const browser = await agent.browsers.getForUrl("http://127.0.0.1:8899/");
  return browser;
}

/** Close all controlled tabs (frees WebGL contexts). */
export async function closeAll(browser) {
  const tabs = await browser.tabs.list();
  for (const t of tabs) {
    const tab = await browser.tabs.get(t.id);
    await tab.close().catch(() => {});
  }
}

/**
 * Navigate a (new or existing) tab to url, wait for the engine, save a PNG.
 * opts: { waitMs, freshTab, viewport, emit }
 */
export async function capture(browser, url, outPath, opts = {}) {
  const { waitMs = 4500, freshTab = true, viewport = { width: 1600, height: 900 }, emit = false } = opts;
  let tab;
  if (freshTab) {
    await closeAll(browser);
    tab = await browser.tabs.new();
  } else {
    const tabs = await browser.tabs.list();
    tab = tabs.length ? await browser.tabs.get(tabs[0].id) : await browser.tabs.new();
  }
  await tab.setViewportSize(viewport);
  await tab.goto(url);
  await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
  await tab.playwright.waitForTimeout(waitMs);
  const state = await tab.playwright
    .evaluate(
      `(() => ({
        engine: !!window.__ENGINE,
        perf: window.__PERF ? { fps: Math.round(window.__PERF.fps), tier: window.__PERF.tier } : null,
        world: window.__WORLD || null,
        err: window.__QA_BOOT_ERROR || null,
      }))()`,
      null,
      { timeoutMs: 3000 }
    )
    .catch((e) => ({ evalErr: e.message }));
  if (state && state.engine === false && !state.evalErr) {
    // surface boot error if any
    const bootErr = await tab.playwright
      .evaluate(
        `import('/js/game.js').then(() => 'ok', e => 'BOOTERR: ' + e.message)`
      , null, { timeoutMs: 3000 })
      .catch((e) => "evalerr: " + e.message);
    state.bootErr = bootErr;
  }
  const png = await tab.screenshot();
  if (outPath) {
    await mkdir(SHOT_DIR, { recursive: true }).catch(() => {});
    const p = outPath.startsWith("/") ? outPath : join(SHOT_DIR, outPath);
    await writeFile(p, png);
  }
  if (emit) nodeRepl.emitImage(png);
  return state;
}
