import { defineConfig } from "vite";

export default defineConfig({
  // Relative base: dist/ deploys under any subpath — it ships at
  // /vibecoding/a-wild-bug/ on the shared GitHub Pages site (docs/GAMES.md).
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 41189, // a-wild-bug in leetspeak
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 41189,
    strictPort: true,
  },
  build: {
    // The dominant chunk is three.js itself; splitting it adds a round-trip
    // for zero benefit on a single-page game. Raise the limit instead of
    // warning on every build.
    chunkSizeWarningLimit: 900,
  },
});
