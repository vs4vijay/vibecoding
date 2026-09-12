import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5199 },
  preview: { port: 5199 },
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    // three.js goes into its own vendor chunk; raise the warning limit to just
    // above it (GAMES.md "three.js bundle size").
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
});
