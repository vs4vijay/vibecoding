// Build gate: every `sprite` string anywhere under src/data must resolve in a
// public/assets/atlas/*.json frame list. Prevents shipping data that renders
// as magenta boxes.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const frames = new Set();
for (const f of readdirSync(join(ROOT, "public/assets/atlas"))) {
  if (!f.endsWith(".json")) continue;
  for (const fr of JSON.parse(readFileSync(join(ROOT, "public/assets/atlas", f), "utf8"))) frames.add(fr.name);
}
let missing = 0;
function walk(node, file) {
  if (Array.isArray(node)) { node.forEach((v) => walk(v, file)); return; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      const isRef = (k === "sprite" || k === "atlasKey") && typeof v === "string";
      if (isRef && !frames.has(v)) {
        console.error(`missing frame: "${v}" (referenced in ${file})`);
        missing++;
      } else walk(v, file);
    }
  }
}
for (const dir of ["characters", "stages"]) {
  const d = join(ROOT, "src/data", dir);
  for (const f of readdirSync(d)) walk(JSON.parse(readFileSync(join(d, f), "utf8")), `${dir}/${f}`);
}
for (const f of ["weapons.json", "items.json"]) {
  walk(JSON.parse(readFileSync(join(ROOT, "src/data", f), "utf8")), f);
}
if (missing > 0) { console.error(`sprite check: ${missing} missing frame(s)`); process.exit(1); }
console.log("sprite check: clean");
