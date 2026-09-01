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
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
