import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const developmentEval =
      process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
    const contentSecurityPolicy = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${developmentEval}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "connect-src 'self'",
      "font-src 'self'",
      "manifest-src 'self'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=()" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/motion-analysis',
        destination: '/',
        permanent: true,
      },
      {
        source: '/dashboard',
        destination: '/',
        permanent: false,
      },
      {
        source: '/auth/:path*',
        destination: '/',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
