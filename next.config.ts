import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Pi keeps Node-only providers behind variable dynamic imports, and the Bash policy uses native
  // Tree-sitter bindings. Let Node resolve these packages instead of bundling them into routes.
  serverExternalPackages: [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "tree-sitter",
    "tree-sitter-bash",
  ],
};
export default nextConfig;
