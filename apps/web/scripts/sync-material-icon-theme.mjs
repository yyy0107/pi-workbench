import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import workbenchPaths from "../../../scripts/workbench-paths.cjs";
import { syncStaticAssets } from "./sync-static-assets.mjs";

const require = createRequire(import.meta.url);
const { webPublicRoot } = workbenchPaths.defaultWorkbenchPaths;
const packageManifest = require("material-icon-theme/package.json");
const packageRoot = dirname(require.resolve("material-icon-theme/package.json"));
const source = join(packageRoot, "icons");
const manifestSource = join(packageRoot, "dist", "material-icons.json");
const targetRoot = join(webPublicRoot, "vendor", "material-icon-theme");

await syncStaticAssets({
  targetRoot,
  fingerprint: JSON.stringify({
    package: `${packageManifest.name}@${packageManifest.version}`,
    assets: ["icons", "material-icons.json"],
  }),
  entries: [
    { source, target: "icons" },
    { source: manifestSource, target: "material-icons.json" },
  ],
});
