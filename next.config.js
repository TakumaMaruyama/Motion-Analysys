/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  output: 'export',  // ← 静的エクスポートに変更
  images: { unoptimized: true }, // 画像最適化を無効化（exportモード用）
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        buffer: require.resolve('buffer/')
      };
    }
    return config;
  }
};

module.exports = nextConfig;