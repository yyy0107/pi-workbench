import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Electron stages this traced output as the base of its production runtime. The custom
  // Workbench server is compiled and traced separately, then merged into the same directory.
  output: "standalone",
  // Desktop assets are local and versioned with the application. Avoid shipping the server-side
  // image optimizer (and sharp/libvips) for icons that never need runtime transformation.
  images: {
    unoptimized: true,
  },
  // File tracing can conservatively capture source trees because the Pi resource loader scans a
  // workspace dynamically. Built server chunks already contain application code; desktop user
  // resources live outside the installation and are discovered from their actual workspace.
  outputFileTracingExcludes: {
    "/*": [
      ".codex/**/*",
      ".pi/**/*",
      "app/**/*",
      "components/**/*",
      "dist-electron/**/*",
      "extensions/**/*",
      "platform/**/*",
      "runtime/**/*",
      "scripts/**/*",
      "components.json",
      "server.ts",
      "skills-lock.json",
      "tsconfig.json",
    ],
  },
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
