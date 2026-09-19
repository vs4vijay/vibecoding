import { defineConfig } from 'vite';

// base "./" keeps the build subpath-safe for GitHub Pages
// (served under /vibecoding/vulture-pass/).
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        // three is the bulk of the bundle — keep it its own cacheable chunk
        manualChunks: { three: ['three'] },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
