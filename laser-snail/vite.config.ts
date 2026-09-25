import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    port: 5411,
    strictPort: true,
  },
  build: {
    // The single 687 kB chunk is three.js itself (~85% of the bundle) plus the
    // game; code-splitting it would add a request round-trip for zero real
    // benefit on a single-page game. Raise the limit instead of warning on
    // every build — the gzip payload is ~180 kB.
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Perf.test.ts makes wall-clock assertions; sibling suites running in the
    // same process pool add CPU jitter that can trip its worst-step budget
    // (a 269 ms spike was observed under full parallel load). The suite is
    // small, so serial file execution is cheap and keeps the gate deterministic.
    fileParallelism: false,
  },
});
