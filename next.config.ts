import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  poweredByHeader: false,
  // Native (prebuilt) module: load from node_modules at runtime, don't bundle.
  serverExternalPackages: ["@node-rs/argon2"],
};

export default nextConfig;
