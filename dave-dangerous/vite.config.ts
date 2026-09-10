import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5199 },
  preview: { port: 5199 },
  base: "./",
  build: { target: "es2022", outDir: "dist" },
});
