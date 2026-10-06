import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the root to this project so a lockfile in a parent directory can't hijack module resolution.
  turbopack: { root: __dirname },
};

export default nextConfig;
