import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const banned = [/Math\.random/, /Date\.now/, /performance\.now/, /node:/, /document\./, /window\./];
let bad = 0;
function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { scan(p); continue; }
    if (!entry.endsWith(".ts")) continue;
    const lines = readFileSync(p, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const re of banned) if (re.test(line)) { console.error(`${p}:${i + 1}: ${re} violated: ${line.trim()}`); bad++; }
    });
  }
}
scan(new URL("../src/sim", import.meta.url).pathname);
if (bad > 0) { console.error(`determinism guard: ${bad} violation(s)`); process.exit(1); }
console.log("determinism guard: clean");
