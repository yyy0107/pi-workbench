import { createRequire } from "node:module";
import path from "node:path";

import workbenchPaths from "../../../scripts/workbench-paths.cjs";
import { syncStaticAssets } from "./sync-static-assets.mjs";

const require = createRequire(import.meta.url);
const { webPublicRoot } = workbenchPaths.defaultWorkbenchPaths;
const packageManifest = require("file-viewer-copy-assets/package.json");
const packageRoot = path.dirname(require.resolve("file-viewer-copy-assets/package.json"));
const sourceRoot = path.join(packageRoot, "viewer");
const targetRoot = path.join(webPublicRoot, "file-viewer");

if (
  path.basename(targetRoot) !== "file-viewer" ||
  path.basename(path.dirname(targetRoot)) !== "public"
) {
  throw new Error(`Refusing to replace unexpected file-viewer asset directory: ${targetRoot}`);
}

const officeAssetDirectories = [
  "vendor/docx",
  "vendor/hangul",
  "vendor/iwork",
  "vendor/pdf",
  "vendor/ppt",
  "vendor/pptx",
  "vendor/wordperfect",
  "vendor/xlsx",
];

await syncStaticAssets({
  targetRoot,
  fingerprint: JSON.stringify({
    package: `${packageManifest.name}@${packageManifest.version}`,
    assets: officeAssetDirectories,
  }),
  entries: officeAssetDirectories.map((relativePath) => ({
    source: path.join(sourceRoot, relativePath),
    target: relativePath,
  })),
});
