#!/usr/bin/env bun
/**
 * Interactive UI-UX live shots for the ui-ux-pass shell (main-agent tool).
 * Drives a real run: powerup chip, resume grace overlay, touch-scheme hints,
 * how-to-play panel. Saves PNGs to .qa/uiux-freeze/ and prints a JSON report.
 */
import { chromium } from "playwright-core";

const BASE = "http://127.0.0.1:8899/index.html";
const OUT = new URL("./uiux-freeze/", import.meta.url).pathname;
const step = (m) => console.error("step:", m);

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
    "--mute-audio",
    "--force-device-scale-factor=1",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e?.message || e)));
const shot = (name) => page.screenshot({ path: `${OUT}${name}.png`, timeout: 30000 });
// NOTE: page.waitForFunction does not rebind across page.goto in this
// playwright-core build (it keeps polling the destroyed context and times
// out even when the predicate is true) — poll via fresh evaluate() calls.
const poll = async (label, fn, arg, timeout = 8000) => {
  step(`wait ${label} …`);
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timeout: ${label}`);
    await page.waitForTimeout(120);
  }
};
const overlayShown = (id) => poll(`${id} shown`, (id) => !document.getElementById(id).classList.contains("hidden"), id).then(() => step(`ok ${id} shown`));
const overlayHidden = (id) => poll(`${id} hidden`, (id) => document.getElementById(id).classList.contains("hidden"), id).then(() => step(`ok ${id} hidden`));

// --- live run: HUD + powerup chip + grace overlay -------------------------
await page.goto(`${BASE}?qa=1&seed=7`, { waitUntil: "domcontentloaded" });
step("boot");
await poll("engine running", () => window.__ENGINE && window.__ENGINE.run.phase === "running", null, 20000);
await page.waitForTimeout(1200);
await shot("live-run");

step("collect magnet");
await page.evaluate(() => window.__ENGINE.run.collectPowerup("magnet", 10));
await page.waitForTimeout(400);
await shot("live-magnet-chip");

step("pause via Escape");
await page.keyboard.press("Escape");
await overlayShown("pause-overlay");
await shot("live-pause-live");

step("resume -> grace countdown");
await page.click("#resume-btn");
await overlayHidden("pause-overlay");
await page.waitForTimeout(350);
const graceVisible = await page.evaluate(() => {
  const el = document.getElementById("resume-grace");
  return !el.classList.contains("hidden") && el.textContent.trim().length > 0;
});
await shot("live-grace");

step("skip grace (if still counting), then pause and quit to menu");
// The 1.2 s grace may have elapsed naturally while the screenshot saved —
// only send the skip key if the countdown is still live, else this Escape
// would pause and the next one would unpause.
const graceStill = await page.evaluate(() => !document.getElementById("resume-grace").classList.contains("hidden"));
if (graceStill) await page.keyboard.press("Escape"); // resume-affirming input: skips the countdown
await overlayHidden("resume-grace");
const resumedLive = await page.evaluate(() => window.__ENGINE.state);
await page.keyboard.press("Escape");
await overlayShown("pause-overlay");
await page.click("#pause-menu-btn");
await overlayShown("menu-screen");
await overlayHidden("pause-overlay");

step("touch scheme latch + hint swap");
await page.evaluate(() => window.dispatchEvent(new TouchEvent("touchstart", { bubbles: true })));
await poll("scheme touch", () => document.documentElement.dataset.scheme === "touch", null, 8000);
await page.waitForTimeout(300);
const scheme = await page.evaluate(() => ({
  attr: document.documentElement.dataset.scheme,
  hint: document.querySelector(".swipe-text").textContent,
  arrowsShown: getComputedStyle(document.querySelector(".swipe-arrows")).display !== "none",
}));
await shot("live-menu-touch");

step("how-to-play panel");
await page.click("#howto-btn");
await overlayShown("howto-panel");
await page.waitForTimeout(400);
const howtoState = await page.evaluate(() => window.__ENGINE.state);
await shot("live-howto");
await page.click("#howto-close-btn");
await overlayHidden("howto-panel");
const howtoClosed = await page.evaluate(() => document.getElementById("howto-panel").classList.contains("hidden"));

// --- grace overlay needs a NON-qa run: ?qa=1 never arms it by design ------
step("fresh mortal run for the grace overlay");
await page.goto(`${BASE}?seed=7`, { waitUntil: "domcontentloaded" });
try {
  await overlayShown("menu-screen");
} catch {
  console.error("DUMP:", JSON.stringify(await page.evaluate(() => ({
    url: location.href,
    menu: document.getElementById("menu-screen")?.className,
    menuEl: !!document.getElementById("menu-screen"),
    loading: document.getElementById("loading-screen")?.className,
    engine: !!window.__ENGINE,
    state: window.__ENGINE?.state,
    scheme: document.documentElement.dataset.scheme,
  }))));
  throw new Error("menu-screen never shown");
}
await overlayHidden("loading-screen"); // else it eats the play click
await page.click("#play-btn", { force: true }); // play-float keeps the button "unstable" for actionability checks
await poll("state playing", () => window.__ENGINE && window.__ENGINE.state === "playing", null, 20000);
// Pause IMMEDIATELY — a mortal idle runner dies to the first hazard within
// a couple of seconds, and the pause must land while state is PLAYING.
await page.keyboard.press("Escape");
await overlayShown("pause-overlay");
await page.click("#resume-btn");
await overlayHidden("pause-overlay");
await page.waitForTimeout(350);
const grace = await page.evaluate(() => {
  const el = document.getElementById("resume-grace");
  return {
    visible: !el.classList.contains("hidden"),
    numeral: el.querySelector(".grace-numeral") ? el.querySelector(".grace-numeral").textContent : el.textContent.trim(),
  };
});
await shot("live-grace");
await browser.close();
console.log(JSON.stringify({ grace, scheme, howtoState, howtoClosed, consoleErrors, pageErrors }, null, 2));
