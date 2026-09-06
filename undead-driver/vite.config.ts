/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "./",
  build: {
    // three.js is a single unavoidable vendor chunk for this single-screen game;
    // keep the warning limit above its bundled size (~570 kB) so the build stays clean.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "three", test: /node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
