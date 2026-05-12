#!/usr/bin/env bun
/**
 * Build standalone executables via `bun build --compile`.
 *
 * Usage:
 *   bun run build                 → all entry points, current platform
 *   bun run build tui             → just the TUI binary
 *   bun run build --target=...    → cross-compile (see `bun build --help`)
 *
 * Why a custom script instead of plain `bun build --compile`:
 *   - Ink dynamically imports `react-devtools-core` behind a `DEV=true` flag.
 *     Bun's bundler follows that dynamic import and tries to bundle the
 *     devtools package; we stub it out with an empty module so the binary
 *     doesn't pull in the entire React devtools tree.
 *
 * Note: tesseract.js still downloads its WASM core + traineddata on first
 * run from a CDN — that's a runtime requirement, not a build-time one.
 */
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

type Entry = {
  name: string;
  src: string;
  out: string;
  /** Default: the TUI. CLIs are skipped unless explicitly requested. */
  defaultBuild: boolean;
};

const ENTRIES: Entry[] = [
  { name: "tui", src: "src/index.ts", out: "mediassist-tui", defaultBuild: true },
  { name: "cli", src: "src/cli.ts", out: "mediassist-cli", defaultBuild: false },
  { name: "ocr", src: "src/ocr.ts", out: "mediassist-ocr", defaultBuild: false },
];

// Bun targets — see `bun build --target` for the canonical list.
const VALID_TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-linux-x64-musl",
  "bun-linux-arm64-musl",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
] as const;
type Target = (typeof VALID_TARGETS)[number];

const args = process.argv.slice(2);
const wanted = args.filter((a) => !a.startsWith("--"));
const targetArg = args.find((a) => a.startsWith("--target="))?.split("=")[1];
const minify = !args.includes("--no-minify");
const bytecode = args.includes("--bytecode");

const target: Target | undefined = targetArg as Target | undefined;
if (target && !VALID_TARGETS.includes(target)) {
  console.error(`Unknown --target=${target}. Valid: ${VALID_TARGETS.join(", ")}`);
  process.exit(1);
}

const targetSuffix = target ?? "current";
const distDir = join("dist", targetSuffix);
const isWindows =
  target === "bun-windows-x64" ||
  (!target && process.platform === "win32");
const ext = isWindows ? ".exe" : "";

const entries = wanted.length > 0
  ? ENTRIES.filter((e) => wanted.includes(e.name))
  : ENTRIES.filter((e) => e.defaultBuild);

if (entries.length === 0) {
  console.error(`No entries to build. Available: ${ENTRIES.map((e) => e.name).join(", ")}`);
  process.exit(1);
}

/**
 * Bun plugin that maps `react-devtools-core` to a no-op module. Ink imports
 * devtools behind a `process.env.DEV === 'true'` guard which is never true
 * in the compiled binary, but the bundler still follows the dynamic import.
 */
const stubDevtools: import("bun").BunPlugin = {
  name: "stub-react-devtools",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, (args) => ({
      path: args.path,
      namespace: "stub-devtools",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub-devtools" }, () => ({
      contents:
        "export default { connectToDevTools() {} };",
      loader: "js",
    }));
  },
};

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

console.log(`Building for target: ${targetSuffix}`);
console.log(`Entries: ${entries.map((e) => e.name).join(", ")}`);

for (const e of entries) {
  const outPath = join(distDir, e.out + ext);
  console.log(`\n→ ${e.name}: ${e.src} → ${outPath}`);
  const t0 = performance.now();
  const result = await Bun.build({
    entrypoints: [e.src],
    target: "bun",
    compile: target
      ? { target: target as never, outfile: outPath }
      : { outfile: outPath },
    minify,
    sourcemap: "none",
    bytecode,
    plugins: [stubDevtools],
  });
  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  const stats = await stat(outPath);
  console.log(`  ✓ ${(stats.size / 1024 / 1024).toFixed(1)} MB · ${Math.round(performance.now() - t0)} ms`);
}

console.log(`\nDone. Binaries in ${distDir}/`);
