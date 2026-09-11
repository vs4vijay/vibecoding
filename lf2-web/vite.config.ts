import { defineConfig, type Plugin } from "vite";
import { readFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * /assets-data/ serves src/data verbatim (spec §3.7 fetch base). The loader's
 * DATA_BASE is relative ("./assets-data/"), so it resolves against the document
 * URL — dev/preview mount it here and `vite build` copies the files into
 * dist/assets-data at closeBundle.
 */
function assetsData(): Plugin {
  const copyDir = (src: string, dest: string): void => {
    mkdirSync(dest);
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const s = join(src, entry.name);
      const d = join(dest, entry.name);
      if (entry.isDirectory()) copyDir(s, d);
      else copyFileSync(s, d);
    }
  };
  return {
    name: "assets-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0]!;
        if (!url.startsWith("/assets-data/")) return next();
        const rel = url.slice("/assets-data/".length);
        const file = join(ROOT, "src", "data", rel);
        if (!existsSync(file)) {
          res.statusCode = 404;
          return res.end("not found");
        }
        res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "text/plain");
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      const out = join("dist", "assets-data");
      copyDir(join(ROOT, "src", "data"), out);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [assetsData()],
  resolve: { alias: { "@sim": "/src/sim", "@render": "/src/render", "@content": "/src/content" } },
});
