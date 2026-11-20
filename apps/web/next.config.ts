import path from "node:path";
import { branchConflictLimits } from "@pushdocs/contracts";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: branchConflictLimits.actionBytes } },
  async rewrites() {
    return process.env.PUSHDOCS_REALTIME_ORIGIN
      ? [{ source: "/events", destination: `${process.env.PUSHDOCS_REALTIME_ORIGIN}/events` }]
      : [];
  },
  serverExternalPackages: [
    "argon2",
    "pg",
    "yjs",
    "sharp",
    "dictionary-en",
    "dictionary-ru",
    "nspell",
  ],
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
