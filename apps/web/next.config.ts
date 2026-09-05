import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

export const WEB_APP_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)));
export const WEB_REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

const webAppRequire = createRequire(import.meta.url);
const nextRuntimeProvenance = webAppRequire(
  "@workbench/host-artifact-policy/web-next-runtime-exception",
) as {
  readonly resolveWebArtifactNextWebpackRuntime: (options: {
    readonly artifactRoot: string;
    readonly nextAlias?: string;
  }) => {
    readonly resources: readonly { readonly nextPackageRelativePath: string }[];
  };
};

export const WEB_OUTPUT_FILE_TRACING_INCLUDES = Object.freeze(
  nextRuntimeProvenance
    .resolveWebArtifactNextWebpackRuntime({
      artifactRoot: WEB_REPOSITORY_ROOT,
      nextAlias: path.join(WEB_APP_ROOT, "node_modules", "next"),
    })
    .resources.map(({ nextPackageRelativePath }) => `node_modules/next/${nextPackageRelativePath}`),
);

export const WEB_OUTPUT_FILE_TRACING_EXCLUDES = Object.freeze([
  "../../.codex/**/*",
  "../../.desktop-build/**/*",
  "../../.electron-build/**/*",
  "../../.pi/**/*",
  "../../dist-electron/**/*",
  "../desktop-electron/**/*",
  "../../scripts/**/*",
  "../runtime-node/**/*",
  "src/app/**/*",
  "src/components/**/*",
  "src/i18n/**/*",
  "src/server/**/*",
  "src/workbench/**/*",
  "tsconfig.json",
]);

export const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Electron stages this traced output as the base of its production runtime. The custom
  // Workbench server is compiled and traced separately, then merged into the same directory.
  output: "standalone",
  outputFileTracingRoot: WEB_REPOSITORY_ROOT,
  turbopack: {
    root: WEB_REPOSITORY_ROOT,
    // ponytail: valid CSS; remove once bundled Lightning CSS fixes github.com/parcel-bundler/lightningcss/issues/1300.
    ignoreIssue: [
      {
        path: "**/agent-configuration/prompt-placeholder-highlight.module.css",
        title: "Parsing CSS source code failed",
        description: /'highlight' is not recognized as a valid pseudo-element/,
      },
    ],
  },
  // Desktop assets are local and versioned with the application. Avoid shipping the server-side
  // image optimizer (and sharp/libvips) for icons that never need runtime transformation.
  images: {
    unoptimized: true,
  },
  // Built chunks already contain app code. Patterns are intentionally relative to this app root;
  // shared packages remain traceable and the separately built Runtime app is never Web payload.
  outputFileTracingExcludes: {
    "/*": [...WEB_OUTPUT_FILE_TRACING_EXCLUDES],
  },
  // Next's own config-utils intentionally hides this dynamic require.resolve table from NFT.
  // Derive its exact current alias/dependency closure from the installed Next package instead of
  // copying the broad compiled/webpack directory.
  outputFileTracingIncludes: {
    "/*": [...WEB_OUTPUT_FILE_TRACING_INCLUDES],
  },
};
export default nextConfig;
