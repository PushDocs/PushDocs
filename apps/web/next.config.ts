import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  poweredByHeader: false,
  async rewrites() {
    return process.env.PUSHDOCS_REALTIME_ORIGIN
      ? [{ source: "/events", destination: `${process.env.PUSHDOCS_REALTIME_ORIGIN}/events` }]
      : [];
  },
  serverExternalPackages: ["argon2", "pg"],
  transpilePackages: [
    "@pushdocs/content",
    "@pushdocs/contracts",
    "@pushdocs/core",
    "@pushdocs/db",
    "@pushdocs/domain",
    "@pushdocs/providers",
    "@pushdocs/ui",
  ],
};

export default nextConfig;
