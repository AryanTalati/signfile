import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  poweredByHeader: false,
  // Load from node_modules at runtime instead of bundling: native modules
  // (argon2, canvas) and pdf.js, which loads its worker and polyfills dynamically.
  serverExternalPackages: ["@node-rs/argon2", "pdfjs-dist", "@napi-rs/canvas"],
  // Uploads go through a route handler (not a server action), but keep action bodies roomy for field saves.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // Signing links carry a secret token: never leak it via Referer, never index signing pages.
  async headers() {
    return [
      {
        source: "/sign/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
