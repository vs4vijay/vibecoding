#!/usr/bin/env bun
/**
 * PNG pixel A/B (main-agent tool; same methodology as the task 1.2 merge
 * A/B): loads two PNGs into canvases, prints mean abs channel diff (0-255)
 * and % of pixels with mean delta > 8. Usage:
 *   bun .qa/png_diff.mjs <a.png> <b.png>
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error("usage: bun .qa/png_diff.mjs <a.png> <b.png>");
  process.exit(2);
}
const b64 = async (p) => (await readFile(p)).toString("base64");

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const result = await page.evaluate(
  async ([a64, b64s]) => {
    const load = (src) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = `data:image/png;base64,${src}`;
      });
    const [a, b] = await Promise.all([load(a64), load(b64s)]);
    if (a.width !== b.width || a.height !== b.height) {
      return { error: `size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}` };
    }
    const cv = document.createElement("canvas");
    cv.width = a.width;
    cv.height = a.height;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(a, 0, 0);
    const da = ctx.getImageData(0, 0, a.width, a.height).data;
    ctx.clearRect(0, 0, a.width, a.height);
    ctx.drawImage(b, 0, 0);
    const db = ctx.getImageData(0, 0, b.width, b.height).data;
    let sum = 0;
    let over8 = 0;
    const px = a.width * a.height;
    for (let i = 0; i < da.length; i += 4) {
      const d =
        (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
      sum += d;
      if (d > 8) over8++;
    }
    return { meanAbs: sum / px, pctOver8: (100 * over8) / px, width: a.width, height: a.height };
  },
  [await b64(aPath), await b64(bPath)],
);
await browser.close();
console.log(JSON.stringify({ a: aPath, b: bPath, ...result }, null, 2));
