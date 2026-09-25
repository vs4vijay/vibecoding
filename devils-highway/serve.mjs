// Minimal static server for dev/QA (no deps). Serves this folder on :8123.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8123);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT)) throw new Error("traversal");
    const s = await stat(file).catch(() => null);
    if (!s || s.isDirectory()) throw new Error("notfound");
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
      "cross-origin-opener-policy": "same-origin",
    });
    res.end(data);
  } catch {
    console.log(`[404] ${req.url}`);
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("404");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`endless dev server on http://127.0.0.1:${PORT}`));
