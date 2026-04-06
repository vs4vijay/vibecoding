/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable webpack5 for Cesium (Cesium uses webpack-specific features)
  webpack: (config, { isServer }) => {
    // Cesium requires web worker support
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });
    
    // Handle workers
    config.module.rules.push({
      test: /cesium\.worker\.(ts|js)$/,
      type: 'asset/resource',
    });

    // Don't treat Cesium as external in dev mode for hot reloading
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }

    return config;
  },
  // Transpile cesium package
  transpilePackages: ['cesium'],
};

export default nextConfig;
