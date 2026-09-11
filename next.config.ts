import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // native/stream-heavy packages must run from node_modules, not the bundle
  serverExternalPackages: ["ssh2", "better-sqlite3"],
  output: "standalone",
};

export default nextConfig;
