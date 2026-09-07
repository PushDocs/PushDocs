import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  poweredByHeader: false,
  serverExternalPackages: ["argon2", "pg"],
  transpilePackages: [
    "@pushdocs/contracts",
    "@pushdocs/core",
    "@pushdocs/db",
    "@pushdocs/domain",
    "@pushdocs/providers",
    "@pushdocs/ui",
  ],
};

export default nextConfig;
