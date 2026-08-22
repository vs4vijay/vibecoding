import { defineConfig } from "vite";

// Deploy-from-subpath support (Phase 11): set BASE_PATH to the public URL
// prefix when building, e.g.
//   BASE_PATH=/vibecoding/tank-racer/ bun run build
// Unset/empty → default root-relative hosting ("/").
const basePath = process.env.BASE_PATH || "/";

export default defineConfig({
  base: basePath,
});
