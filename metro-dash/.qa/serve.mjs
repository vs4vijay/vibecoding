#!/usr/bin/env bun
/**
 * Minimal static server for browser QA captures (main-agent tool).
 * Same role as `python3 -m http.server`, but sends the Service-Worker-Allowed
 * header pwa-register.js needs (it registers /js/sw.js with scope "/"), so
 * capture runs don't log a console error that shot.mjs would treat as a
 * failure.
 *
 * Usage: bun .qa/serve.mjs [port] [rootDir]
 */
const port = Number(process.argv[2] || "8899");
const root = process.argv[3] || new URL("../client", import.meta.url).pathname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file(root + path);
    const headers = {
      "Content-Type": MIME[path.slice(path.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-store",
    };
    if (await file.exists()) return new Response(file, { headers });
    return new Response("404", { status: 404, headers });
  },
});
console.log(`serving ${root} on http://127.0.0.1:${port}`);
