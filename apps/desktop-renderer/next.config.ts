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
    // ponytail: valid CSS; remove once bundled Lightning CSS fixes github.com/parcel-bundler/lightningcss/issues/1300.
    ignoreIssue: [
      {
        path: "**/agent-configuration/prompt-placeholder-highlight.module.css",
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
