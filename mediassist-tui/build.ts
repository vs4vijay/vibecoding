#!/usr/bin/env bun
/**
 * Builds the `mediassist-tui` standalone binary via `bun build --compile`.
 *
 *   bun run build                          → current platform → bin/mediassist-tui[.exe]
 *   bun run build --target=bun-linux-x64   → bin/mediassist-tui-linux-x64
 *   bun run build --target=bun-windows-x64 → bin/mediassist-tui-windows-x64.exe
 *
 * Binaries land in a flat `bin/` directory; each cross-target gets a
 * descriptive suffix so files don't clash. The default (no --target) build
 * has no suffix.
 *
 * Build-time quirk: Ink dynamically imports `react-devtools-core` behind a
 * `process.env.DEV === 'true'` guard. Bun's bundler still walks the import
 * at build time, so we stub the package with an empty module to keep the
 * binary self-contained.
 */
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

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
const targetArg = args.find((a) => a.startsWith("--target="))?.split("=")[1];
const minify = !args.includes("--no-minify");
const bytecode = args.includes("--bytecode");

const target: Target | undefined = targetArg as Target | undefined;
if (target && !VALID_TARGETS.includes(target)) {
  console.error(`Unknown --target=${target}. Valid: ${VALID_TARGETS.join(", ")}`);
  process.exit(1);
}

const binDir = "bin";
const outName = buildOutName(target);
const outPath = join(binDir, outName);

const stubDevtools: import("bun").BunPlugin = {
  name: "stub-react-devtools",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, (a) => ({
      path: a.path,
      namespace: "stub-devtools",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub-devtools" }, () => ({
      contents: "export default { connectToDevTools() {} };",
      loader: "js",
    }));
  },
};

await mkdir(binDir, { recursive: true });

console.log(`Building → ${outPath}  (target: ${target ?? "current"})`);
const t0 = performance.now();

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  target: "bun",
  compile: target ? { target: target as never, outfile: outPath } : { outfile: outPath },
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
console.log(`✓ ${(stats.size / 1024 / 1024).toFixed(1)} MB · ${Math.round(performance.now() - t0)} ms`);

/**
 * Filename strategy: the default (no cross-target) build is just
 * `mediassist-tui[.exe]`. Cross-target builds get a platform suffix so they
 * coexist in the same `bin/` directory.
 */
function buildOutName(t: Target | undefined): string {
  if (!t) {
    return process.platform === "win32" ? "mediassist-tui.exe" : "mediassist-tui";
  }
  // bun-linux-x64 → linux-x64
  const suffix = t.replace(/^bun-/, "");
  const ext = suffix.startsWith("windows-") ? ".exe" : "";
  return `mediassist-tui-${suffix}${ext}`;
}
