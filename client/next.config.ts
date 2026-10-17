import path from "node:path";
import type { NextConfig } from "next";

const API_URL = process.env.API_URL || "http://localhost:8080";

const nextConfig: NextConfig = {
  // self-contained server bundle for the Docker image (enabled by BUILD_STANDALONE=1)
  ...(process.env.BUILD_STANDALONE ? { output: "standalone" as const } : {}),
  turbopack: { root: path.resolve(__dirname) },
  agentRules: false,
  // The browser talks only to this origin; /api and /uploads are proxied to the Express API.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/uploads/:path*", destination: `${API_URL}/uploads/:path*` },
    ];
  },
  images: { unoptimized: true },
};

export default nextConfig;
