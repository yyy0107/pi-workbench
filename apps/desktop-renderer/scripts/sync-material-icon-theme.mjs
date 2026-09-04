import { createRequire } from "node:module";

import workbenchPaths from "../../../scripts/workbench-paths.cjs";
import { syncMaterialIconTheme } from "../../../scripts/sync-static-assets.mjs";

await syncMaterialIconTheme({
  publicRoot: workbenchPaths.defaultWorkbenchPaths.desktopRendererPublicRoot,
  require: createRequire(import.meta.url),
});
