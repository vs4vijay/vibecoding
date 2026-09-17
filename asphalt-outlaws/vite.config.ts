import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5212 },
  preview: { port: 5212 },
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
