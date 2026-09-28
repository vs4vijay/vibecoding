#!/usr/bin/env node
/**
 * Deterministic screenshot harness for "A Wild Bug".
 *
 * Usage:
 *   node tools/shoot.mjs --out shots/m1 --spec orbit --spec run --spec sunset [--dpr 1] [--url URL]
 *                         [--viewport desktop|phone]
 *
 * Contract (implemented by the game, src/game/debug/ShotDirector.ts):
 *   window.__wb.ready  -> boolean, true once the game has booted
 *   window.__wb.shot(name) -> Promise<ShotInfo>  — arranges the named scene,
 *                             settles it, and resolves when it can be captured.
 *                             DOM-shell scenes resolve ShotInfo with dom: true;
 *                             the whole page is screenshotted for those (the
 *                             shell is DOM — invisible to the canvas grab).
 *   window.__wb.info() -> object — diagnostics (fps, draw calls, triangles…)
 *
 * The script starts nothing itself: point --url at a running `vite preview`
 * (or `vite dev`) server. Exits non-zero on page errors or failed shots.
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
function argValues(flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag) out.push(args[++i]);
  return out;
}

const outDir = argValue("--out", "shots");
const url = argValue("--url", "http://127.0.0.1:41189/");
const specs = argValues("--spec");
const settleTimeout = Number(argValue("--settle-timeout", "45000"));

/**
 * Named viewports. The default must stay byte-identical to the old behavior
 * (1600x900 @dpr 1); "phone" is the portrait preset (390x844 @dpr 3). An
 * explicit --dpr still wins over the preset's.
 */
const VIEWPORTS = {
  desktop: { width: 1600, height: 900, dpr: 1 },
  phone: { width: 390, height: 844, dpr: 3 },
};
const viewportName = argValue("--viewport", "desktop");
const vp = VIEWPORTS[viewportName];
if (!vp) {
  console.error(
    `unknown --viewport "${viewportName}" (known: ${Object.keys(VIEWPORTS).join(", ")})`,
  );
  process.exit(2);
}
const dpr = Number(argValue("--dpr", String(vp.dpr)));

if (specs.length === 0) {
  console.error("no --spec given");
  process.exit(2);
}

const browser = await chromium.launch({
  args: [
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--no-sandbox",
  ],
});
const page = await browser.newPage({
  viewport: { width: vp.width, height: vp.height },
  deviceScaleFactor: dpr,
});

const problems = [];
const warnings = [];
page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
  else if (msg.type() === "warning") warnings.push(`console.warning: ${msg.text()}`);
});

console.log(`navigating to ${url}`);
await page.goto(url, { waitUntil: "load", timeout: 60000 });

// Wait for the game to boot and register its shot director.
try {
  await page.waitForFunction(() => window.__wb?.ready === true, null, {
    timeout: 60000,
  });
} catch {
  problems.push("window.__wb.ready never became true (game boot failed?)");
}

const gl = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const g = c.getContext("webgl2") || c.getContext("webgl");
  if (!g) return null;
  const dbg = g.getExtension("WEBGL_debug_renderer_info");
  return {
    version: g.getParameter(g.VERSION),
    renderer: dbg
      ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : "unknown",
  };
});
console.log("webgl:", JSON.stringify(gl));

await mkdir(outDir, { recursive: true });

const info = { webgl: gl, shots: {} };

/**
 * Guards against the SwiftShader present-vs-screenshot race: a corrupted
 * capture shows up as whole pure-black column bands at the canvas edges.
 * Throws (failing the shot) if any border column is entirely black.
 */
async function assertNotRaced(page, dataUrl) {
  const bad = await page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("capture failed to decode"));
      img.src = src;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    // Column-scoped getImageData readbacks: opt into the readback-optimized
    // path so Chrome does not emit a Canvas2D performance warning at dpr 3.
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const cols = [0, 1, 2, img.width - 3, img.width - 2, img.width - 1];
    for (const x of cols) {
      const d = ctx.getImageData(x, 0, 1, img.height).data;
      let black = true;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] || d[i + 1] || d[i + 2]) {
          black = false;
          break;
        }
      }
      if (black) return x;
    }
    return null;
  }, dataUrl);
  if (bad !== null) throw new Error(`raced capture: black column at x=${bad}`);
}

for (const spec of specs) {
  const file = path.join(outDir, `${spec}.png`);
  process.stdout.write(`shot ${spec} … `);
  try {
    const shotInfo = await page.evaluate(async (name) => {
      if (!window.__wb || typeof window.__wb.shot !== "function") {
        throw new Error("window.__wb.shot missing");
      }
      return window.__wb.shot(name);
    }, spec);
    // SwiftShader frames can take seconds; give the capture the same generous
    // budget as the settle wait. Prefer the race-free in-page readback: a
    // page.screenshot can race the WebGL frame present (seen as pure-black
    // column bands), while grab() renders + reads the canvas in one task.
    // DOM-shell scenes resolve {dom: true} and skip grab(): their subject is
    // page DOM, which a canvas composite would miss entirely — the game has
    // pinned + settled the shell, so the page screenshot is stable.
    const domCapture = !!shotInfo && typeof shotInfo === "object" && shotInfo.dom === true;
    let dataUrl = null;
    if (typeof shotInfo === "string" && shotInfo.startsWith("data:image/png")) {
      dataUrl = shotInfo; // the shot director composed its own artifact
    } else if (!domCapture) {
      dataUrl = await page.evaluate(() =>
        window.__wb && typeof window.__wb.grab === "function"
          ? window.__wb.grab()
          : null,
      );
    }
    if (dataUrl) {
      await assertNotRaced(page, dataUrl);
      await writeFile(
        file,
        Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"),
      );
    } else {
      await page.screenshot({ path: file, type: "png", timeout: settleTimeout });
    }
    info.shots[spec] =
      typeof shotInfo === "string" ? "<data url, decoded to file>" : (shotInfo ?? null);
    console.log(`ok -> ${file}`);
  } catch (err) {
    problems.push(`shot "${spec}" failed: ${err.message.split("\n")[0]}`);
    console.log("FAILED");
  }
}

try {
  info.diagnostics = await page.evaluate(() => window.__wb?.info?.() ?? null);
} catch {
  info.diagnostics = null;
}
await writeFile(
  path.join(outDir, "info.json"),
  JSON.stringify(info, null, 2),
);
console.log("diagnostics:", JSON.stringify(info.diagnostics));

await browser.close();

if (warnings.length) {
  console.error("\nWARNINGS:");
  for (const w of warnings) console.error(`  - ${w}`);
}
if (problems.length) {
  console.error("\nPROBLEMS:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
// Integration-sweep gate (task 9.1): `--strict-warnings` promotes console
// warnings to failures; the default keeps the historical errors-only exit.
// Known harness noise, NOT game output: the ANGLE/SwiftShader driver's
// one-shot "GPU stall due to ReadPixels" performance notice, triggered by the
// capture readback itself on every software-GL run.
const isHarnessNoise = (w) => /GPU stall due to ReadPixels/.test(w);
if (warnings.length && args.includes("--strict-warnings")) {
  if (warnings.some((w) => !isHarnessNoise(w))) process.exit(1);
}
console.log("\nall shots captured cleanly");
