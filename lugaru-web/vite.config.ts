/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "./",
  build: {
    // Rapier + three.js are unavoidable vendor chunks (~800 kB total); keep
    // the warning limit just above their bundled size so the build stays
    // clean, and split them out so the main chunk stays small.
    // NOTE: this project is on Vite 7 (Rollup) — use rollupOptions.output.
    // manualChunks, NOT rolldownOptions (that's Vite 8).
    chunkSizeWarningLimit: 2400,
    rollupOptions: {
      output: {
        manualChunks: {
          rapier: ["@dimforge/rapier3d-compat"],
          three: ["three"],
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Playwright E2E suite (tests/playwright/) has its own runner/config;
    // keep it out of vitest's include so `bun run test` stays pure-logic.
    exclude: [
      "tests/playwright/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
    ],
  },
});