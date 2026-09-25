#!/usr/bin/env bun
/**
 * Lane-direction probe (post-slice control-mirror fix). Chase rigs face +z so
 * screen-right is world −x; the "left"/"right" actions are screen intents and
 * run.js maps them to the mirrored lane. Verifies through the REAL input layer
 * on the discrete lane integer with CONDITION waits (SwiftShader frame pacing
 * makes fixed timeouts flaky):
 *   KeyA / ArrowLeft / swipe left → lane +1 step; KeyD / ArrowRight / swipe
 *   right → lane −1 step; rails clamp. One retry per attempt: long SwiftShader
 *   sessions can hang the GPU process (qa report 4.1) — a crash is environment,
 *   not app; only a live-but-failing page counts as a real failure.
 * Usage: bun .qa/lane_direction_probe.mjs [base-url]
 */
import { chromium } from "playwright-core";

const base = process.argv[2] || "http://127.0.0.1:8123";

async function runOnce(browser, attempt) {
  const problems = [];
  let crashed = false;
  const check = (name, got, want) => {
    const ok = got === want;
    if (!ok) problems.push(`${name}: got ${got}, want ${want}`);
    console.log(`${ok ? "ok" : "FAIL"}  [${attempt}] ${name}: ${got}`);
  };

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("crash", () => { crashed = true; problems.push("page crash (SwiftShader class)"); });
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text()}`); });

  await page.goto(`${base}/?qa=1&mode=run&scene=game&seed=5`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__QA_RUN && window.__QA_RUN.player, null, { timeout: 30000 });
  const laneOf = () => page.evaluate(() => window.__QA_RUN.player.lane);
  const waitLane = (want) =>
    page.waitForFunction((w) => window.__QA_RUN.player.lane === w && window.__QA_RUN.player.laneT === 1,
      want, { timeout: 8000 }).then(() => true, () => false);
  const press = async (key, want) => {
    if (crashed) return;
    await page.keyboard.press(key);
    const arrived = await waitLane(want);
    check(`${key} → lane ${want}`, arrived ? want : await laneOf(), want);
  };
  const swipe = async (dx, want) => {
    if (crashed) return;
    await page.evaluate((d) => {
      const t = (type, x) => window.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true,
        clientX: x, clientY: 360, buttons: 1,
      }));
      t("pointerdown", 400); t("pointerup", 400 + d);
    }, dx);
    const arrived = await waitLane(want);
    check(`swipe ${dx > 0 ? "right" : "left"} → lane ${want}`, arrived ? want : await laneOf(), want);
  };

  await press("a", 1);
  await press("a", 1); // rail clamp: lane must hold +1
  await press("d", 0);
  await press("ArrowRight", -1);
  await press("ArrowLeft", 0);
  await swipe(160, -1);
  await swipe(-160, 0);

  if (!crashed) {
    const z0 = await page.evaluate(() => window.__QA_SHELL.dolly().z);
    await page.waitForTimeout(600);
    const z1 = await page.evaluate(() => window.__QA_SHELL.dolly().z);
    check("sim advancing (no frozen false-pass)", z1 > z0 ? 1 : 0, 1);
  }
  await page.close();
  return { problems, crashed };
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--hide-scrollbars", "--mute-audio", "--force-device-scale-factor=1"],
});
let out = await runOnce(browser, 1);
if (out.problems.length > 0) {
  console.log("retrying once (SwiftShader session-hang class)…");
  out = await runOnce(browser, 2);
}
await browser.close();
console.log(JSON.stringify({ ok: out.problems.length === 0, crashed: out.crashed, problems: out.problems }, null, 2));
process.exit(out.problems.length === 0 ? 0 : 1);
