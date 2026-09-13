import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

export const DESKTOP_RENDERER_APP_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)));
export const DESKTOP_RENDERER_REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);

export const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "export",
  turbopack: {
    root: DESKTOP_RENDERER_REPOSITORY_ROOT,
    // Valid Custom Highlight API CSS is emitted intact. Scope this upstream parser warning
    // to its current owner; remove after lightningcss#1300 is fixed in bundled Next.
    ignoreIssue: [
      {
        path: "**/pi-ui-settings/src/prompt-placeholder-highlight.module.css",
        title: "Parsing CSS source code failed",
        description: /'highlight' is not recognized as a valid pseudo-element/,
      },
    ],
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
