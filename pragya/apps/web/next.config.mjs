/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  transpilePackages: ["@drishti/shared"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
