import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude Bull from server-side bundling (it uses Node.js-specific modules)
  serverExternalPackages: ['bull', 'ioredis'],
  
  // Webpack config for Bull compatibility
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Exclude Bull's child process files from bundling
      config.externals = config.externals || [];
      config.externals.push({
        'bull/lib/process/master': 'commonjs bull/lib/process/master',
      });
      
      // Handle optional Magic SDK dependencies
      config.resolve.fallback = {
        ...config.resolve.fallback,
        encoding: false,
        bufferutil: false,
        'utf-8-validate': false,
      };
    }
    return config;
  },
  
  // Turbopack config (empty to silence warning - webpack config is needed for Bull)
  turbopack: {},
};

export default nextConfig;
